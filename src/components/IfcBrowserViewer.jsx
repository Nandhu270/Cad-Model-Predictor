import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export default function IfcBrowserViewer({
  fileUrl = null,
  wasmPath = "/web-ifc/",
  backgroundColor = 0xf6f9fc,
  autoFit = true,
  onModelLoaded = () => {},
  style = { width: "100%", height: "100%", minHeight: 520, background: "#eef2f6" },
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const mountedRef = useRef(true);


  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function init() {
      if (!containerRef.current) return;

      try {
        const mod = await import("web-ifc-viewer");
        if (cancelled) return;

        const IfcViewerAPI = mod.IfcViewerAPI;
        if (!IfcViewerAPI) {
          console.error("IfcViewerAPI not found in web-ifc-viewer import.");
          return;
        }

        const viewer = new IfcViewerAPI({
          container: containerRef.current,
          backgroundColor: new THREE.Color(backgroundColor),
        });

        viewerRef.current = viewer;
        try { window.ifcViewer = viewer; } catch (e) { /* ignore */ }

        try {
          if (viewer.IFC && typeof viewer.IFC.setWasmPath === "function") {
            viewer.IFC.setWasmPath(wasmPath);
          }
        } catch (e) {
          console.warn("Could not set web-ifc wasm path:", e);
        }

        try {
          viewer.axes?.setAxes?.();
          viewer.grid?.setGrid?.();
        } catch (e) { /* ignore */ }

      } catch (err) {
        console.error("IfcBrowserViewer init failed:", err);
      }
    }

    init();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [wasmPath, backgroundColor]);

  useEffect(() => {
    if (!fileUrl || !viewerRef.current) return;
    let mounted = true;

    async function doLoad() {
      const viewer = viewerRef.current;
      if (!viewer) return;

      try {
        try {
          if (viewer.IFC && typeof viewer.IFC.unloadIfcModel === "function") {
            const loaded = viewer.IFC?.models || viewer.IFC?.ifcManager?.models;
            if (loaded) {
              try {
                Object.values(loaded).forEach((m) => {
                  if (m && typeof m === "object" && m.modelID != null && typeof viewer.IFC.unloadIfcModel === "function") {
                    try { viewer.IFC.unloadIfcModel(m.modelID); } catch (_) {}
                  }
                });
              } catch (_) { /* ignore */ }
            }
          }
        } catch (_) {}

        let modelID = null;
        if (viewer.IFC && typeof viewer.IFC.loadIfcUrl === "function") {
          modelID = await viewer.IFC.loadIfcUrl(fileUrl);
        } else if (typeof viewer.loadIfcUrl === "function") {
          modelID = await viewer.loadIfcUrl(fileUrl);
        } else {
          console.error("No loadIfcUrl function found on viewer/IFC instance.");
        }

        await normalizeMaterials(viewer);
        await ensureCameraAndRender(viewer, autoFit);

        if (mounted) onModelLoaded();
      } catch (err) {
        console.error("Error loading IFC:", err);
      }
    }

    doLoad();

    return () => {
      mounted = false;
    };
  }, [fileUrl, autoFit, onModelLoaded]);

  useEffect(() => {
    function onResize() {
      try {
        const viewer = viewerRef.current;
        if (!viewer) return;
        const rwrap = viewer.context?.renderer;
        const threeRenderer = rwrap?.renderer || rwrap?.webGLRenderer || rwrap;
        const canvas = threeRenderer?.domElement;
        if (!canvas) return;

        const w = containerRef.current.clientWidth || window.innerWidth;
        const h = containerRef.current.clientHeight || window.innerHeight;

        if (typeof threeRenderer.setSize === "function") {
          threeRenderer.setSize(w, h, false);
          if (typeof threeRenderer.setPixelRatio === "function") {
            threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          }
        }
        try {
          const cam = viewer.context?.ifcCamera?.camera || viewer.context?.camera;
          if (cam && typeof threeRenderer.render === "function") {
            threeRenderer.render(viewer.context.scene?.scene || viewer.context.scene, cam);
          } else if (typeof viewer.context?.render === "function") {
            viewer.context.render();
          }
        } catch (e) {
          // non-fatal
        }
      } catch (e) {
        // ignore
      }
    }

    window.addEventListener("resize", onResize);
    setTimeout(onResize, 60);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      const viewer = viewerRef.current;
      try {
        if (viewer) {
          try {
            if (viewer.IFC && typeof viewer.IFC.unloadIfcModel === "function") {
              const loaded = viewer.IFC?.models || viewer.IFC?.ifcManager?.models;
              if (loaded) {
                Object.values(loaded).forEach((m) => {
                  try { if (m && m.modelID != null) viewer.IFC.unloadIfcModel(m.modelID); } catch (_) {}
                });
              }
            }
          } catch (_) {}

          try {
            const scene = viewer.context?.scene?.scene || viewer.context?.scene;
            if (scene && scene.traverse) {
              scene.traverse((obj) => {
                try {
                  if (obj.geometry) obj.geometry.dispose?.();
                  if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach((mat) => mat?.dispose?.());
                    else obj.material.dispose?.();
                  }
                } catch (_) {}
              });
            }
          } catch (_) {}

          try { viewer.dispose?.(); } catch (_) {}
        }
      } catch (_) {}
    };
  }, []);


  async function normalizeMaterials(viewer) {
    const scene = viewer.context?.scene?.scene || viewer.context?.scene;
    if (!scene) return;

    const bgHex = typeof backgroundColor === "number" ? backgroundColor : 0xf6f9fc;

    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.visible = true;

      const makeSafeMat = (old) => {
        let colorHex = 0x999999;
        try {
          if (old && old.color && typeof old.color.getHex === "function") colorHex = old.color.getHex();
          else if (old && typeof old.color === "number") colorHex = old.color;
        } catch (e) {}
        if (colorHex === bgHex) colorHex = 0xff8800;
        return new THREE.MeshStandardMaterial({
          color: colorHex,
          metalness: 0.05,
          roughness: 0.8,
          side: THREE.DoubleSide,
          transparent: false,
          opacity: 1,
        });
      };

      try {
        if (Array.isArray(obj.material)) {
          const suspicious = obj.material.some((m) => !m || m.transparent || (typeof m.opacity === "number" && m.opacity < 0.05) || m.visible === false);
          if (suspicious) {
            try { obj.material.forEach((m) => m?.dispose?.()); } catch (_){}
            obj.material = new Array(obj.material.length).fill(makeSafeMat(null));
          } else {
            obj.material.forEach((m) => {
              if (m && m.transparent && typeof m.opacity === 'number' && m.opacity < 1) {
                m.transparent = false; m.opacity = 1; m.needsUpdate = true;
              }
            });
          }
        } else {
          const m = obj.material;
          const suspicious = !m || m.transparent || (typeof m.opacity === "number" && m.opacity < 0.05) || m.visible === false;
          if (suspicious) {
            try { m?.dispose?.(); } catch (_){}
            obj.material = makeSafeMat(m);
          } else if (m && m.transparent && typeof m.opacity === "number" && m.opacity < 1) {
            m.transparent = false; m.opacity = 1; m.needsUpdate = true;
          }
        }
      } catch (e) {
      }
    });
  }

  
  async function ensureCameraAndRender(viewer, autoFitLocal = true) {
    const scene = viewer.context?.scene?.scene || viewer.context?.scene;
    if (!scene) return;

    const bbox = new THREE.Box3().setFromObject(scene);
    const center = bbox.getCenter(new THREE.Vector3());
    const sizeVec = bbox.getSize(new THREE.Vector3());
    const sizeLen = sizeVec.length() || 10;

    const zThickness = Math.abs(bbox.max.z - bbox.min.z);
    const flatThreshold = Math.max(1e-3, sizeLen * 0.005);
    if (zThickness <= flatThreshold) {
      try { scene.position.y += sizeLen * 0.15; } catch (_) {}
    }

    let cam = viewer.context?.ifcCamera?.camera || viewer.context?.camera || null;
    if (!cam) {
      cam = new THREE.PerspectiveCamera(
        60,
        containerRef.current.clientWidth / Math.max(1, containerRef.current.clientHeight),
        0.01,
        Math.max(sizeLen * 100, 1000)
      );
    }

    cam.position.set(center.x + sizeLen, center.y + sizeLen, center.z + sizeLen);
    if (typeof cam.lookAt === "function") cam.lookAt(center);
    cam.near = Math.min(cam.near ?? 0.01, 0.01);
    cam.far = Math.max(cam.far ?? 1000, sizeLen * 500);
    cam.updateProjectionMatrix?.();

    try {
      viewer.context = viewer.context || {};
      viewer.context.camera = cam;
      viewer.context.ifcCamera = viewer.context.ifcCamera || {};
      viewer.context.ifcCamera.camera = cam;
    } catch (_) {}

    const rwrap = viewer.context?.renderer;
    const threeRenderer = rwrap?.renderer || rwrap?.webGLRenderer || rwrap;

    if (threeRenderer && threeRenderer.domElement) {
      try {
        const canvas = threeRenderer.domElement;
        const w = containerRef.current.clientWidth || window.innerWidth;
        const h = containerRef.current.clientHeight || window.innerHeight;
        if (typeof threeRenderer.setSize === "function") threeRenderer.setSize(w, h, false);
        if (typeof threeRenderer.setPixelRatio === "function") threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        try { threeRenderer.render(scene, cam); }
        catch (e) { /* ignore */ }
        return;
      } catch (e) { /* fallthrough to other render attempts */ }
    }

    if (typeof viewer.context?.render === "function") {
      try { viewer.context.render(); return; } catch (e) {}
    }

    if (typeof viewer.render === "function") {
      try { viewer.render(scene, cam); return; } catch (e) {}
    }

    console.warn("ensureCameraAndRender: no render path succeeded");
  }

  return <div ref={containerRef} style={style} />;
}
