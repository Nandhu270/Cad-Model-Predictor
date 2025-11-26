// // src/components/IfcBrowserViewer.jsx
// import React, { useEffect, useRef } from "react";
// import * as THREE from "three";

// /**
//  * Robust IFC viewer that:
//  *  - loads via web-ifc-viewer IfcViewerAPI
//  *  - fixes/normalizes problematic materials on load
//  *  - creates/attaches a camera if missing
//  *  - uses the viewer's internal WebGLRenderer and forces a render + resize
//  *
//  * Requirements:
//  *  - public/web-ifc/* contains web-ifc.wasm (and other wasm files)
//  */

// export default function IfcBrowserViewer({ fileUrl = null, onModelLoaded = () => {} }) {
//   const containerRef = useRef(null);
//   const viewerRef = useRef(null);

//   useEffect(() => {
//     let mounted = true;

//     async function init() {
//       try {
//         const { IfcViewerAPI } = await import("web-ifc-viewer");

//         if (!containerRef.current) return;

//         const viewer = new IfcViewerAPI({
//           container: containerRef.current,
//           backgroundColor: new THREE.Color(0xf6f9fc),
//         });

//         viewerRef.current = viewer;

//         // helpers (non-fatal)
//         try {
//           viewer.axes.setAxes();
//           viewer.grid.setGrid();
//         } catch (_) {}

//         // set wasm path (non-fatal if missing)
//         try {
//           // web-ifc-viewer expects a directory path where wasm files live
//           viewer.IFC.setWasmPath("/web-ifc/");
//         } catch (_) {}

//         // expose for debug
//         try { window.ifcViewer = viewer; } catch (_) {}

//         // auto-load initial file if present
//         if (mounted && fileUrl) {
//           await loadModel(fileUrl);
//         }
//       } catch (err) {
//         console.error("IfcBrowserViewer init error:", err);
//       }
//     }

//     init();

//     return () => {
//       mounted = false;
//       // cleanup attempt
//       try {
//         const v = viewerRef.current;
//         if (v && v.scene && v.scene.traverse) {
//           v.scene.traverse((obj) => {
//             if (obj.geometry) obj.geometry.dispose?.();
//             if (obj.material) {
//               if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
//               else obj.material.dispose?.();
//             }
//           });
//         }
//       } catch (e) {
//         // ignore
//       }
//     };
//   }, []); // run once

//   // reload when fileUrl changes
//   useEffect(() => {
//     if (!viewerRef.current || !fileUrl) return;
//     loadModel(fileUrl);
//   }, [fileUrl]);

//   // -------------------------
//   // load model and run fixes
//   // -------------------------
//   async function loadModel(url) {
//     const viewer = viewerRef.current;
//     if (!viewer) return;

//     try {
//       // try unloading previous model (non-fatal)
//       try { if (viewer.IFC && typeof viewer.IFC.unloadIfcModel === "function") viewer.IFC.unloadIfcModel(); } catch {}

//       console.log("[IFC] loading model from:", url);
//       const modelID = await viewer.IFC.loadIfcUrl(url);

//       // after model is parsed, normalize materials, ensure camera, and render
//       try {
//         await normalizeMaterials(viewer);
//       } catch (e) {
//         console.warn("normalizeMaterials failed:", e);
//       }

//       try {
//         await ensureCameraAndRender(viewer);
//       } catch (e) {
//         console.warn("ensureCameraAndRender failed:", e);
//       }

//       onModelLoaded();
//     } catch (err) {
//       console.error("Error loading IFC:", err);
//     }
//   }

//   // -------------------------
//   // Material normalization
//   // Replace obviously broken/transparent materials with safe standard material
//   // -------------------------
//   async function normalizeMaterials(viewer) {
//     const scene = viewer.context?.scene?.scene || viewer.context?.scene;
//     if (!scene) {
//       console.warn("normalizeMaterials: no scene found");
//       return;
//     }

//     // background color heuristic to avoid creating a material with same color
//     const bgColor = (viewer.backgroundColor && viewer.backgroundColor.getHex) ? viewer.backgroundColor.getHex() : 0xf6f9fc;

//     scene.traverse((obj) => {
//       if (!obj.isMesh) return;

//       // ensure visible
//       obj.visible = true;

//       // helper to create safe replacement material given an old mat
//       const makeSafeMat = (old) => {
//         // try to preserve color if available
//         let color = 0x999999;
//         try {
//           if (old && old.color && typeof old.color.getHex === "function") color = old.color.getHex();
//           else if (old && typeof old.color === "number") color = old.color;
//         } catch (e) {}

//         // avoid background-colored materials by bumping color
//         if (color === bgColor) color = 0xff8800;

//         return new THREE.MeshStandardMaterial({
//           color,
//           metalness: 0.05,
//           roughness: 0.85,
//           side: THREE.DoubleSide,
//           transparent: false,
//           opacity: 1.0,
//         });
//       };

//       // If material is an array, inspect entries and replace only suspicious ones
//       if (Array.isArray(obj.material)) {
//         const newMaterials = obj.material.map((m) => {
//           // treat suspicious if transparent, nearly zero opacity, or has undefined shader flags
//           const suspicious = (m == null) ||
//             !!m.transparent ||
//             (typeof m.opacity === "number" && m.opacity < 0.05) ||
//             (m.visible === false);

//           return suspicious ? makeSafeMat(m) : m;
//         });
//         // replace only if any suspicious
//         if (newMaterials.some((nm, idx) => nm !== obj.material[idx])) {
//           // dispose old materials safely
//           try {
//             obj.material.forEach((m) => { try { m.dispose?.(); } catch (e) {} });
//           } catch (_) {}
//           obj.material = newMaterials;
//         }
//       } else {
//         const m = obj.material;
//         const suspicious = (m == null) ||
//           !!m.transparent ||
//           (typeof m.opacity === "number" && m.opacity < 0.05) ||
//           (m.visible === false);

//         if (suspicious) {
//           try { m.dispose?.(); } catch (_) {}
//           obj.material = makeSafeMat(m);
//         } else {
//           // also force material to be non-transparent and fully opaque if edge-case opacity is tiny
//           if (m.transparent && typeof m.opacity === "number" && m.opacity < 1) {
//             m.transparent = false;
//             m.opacity = 1;
//             if (m.needsUpdate) m.needsUpdate = true;
//           }
//         }
//       }
//     });
//   }

//   // -------------------------
//   // Ensure camera exists and render with the viewer's inner WebGLRenderer
//   // -------------------------
//   async function ensureCameraAndRender(viewer) {
//     const scene = viewer.context?.scene?.scene || viewer.context?.scene;
//     if (!scene) {
//       console.warn("ensureCameraAndRender: no scene found");
//       return;
//     }

//     // compute bbox
//     const bbox = new THREE.Box3().setFromObject(scene);
//     const center = bbox.getCenter(new THREE.Vector3());
//     const size = bbox.getSize(new THREE.Vector3()).length() || 10;
//     const offset = Math.max(size * 1.2, 10);

//     // get existing camera or create one
//     let cam = viewer.context?.ifcCamera?.camera || viewer.context?.camera || null;
//     if (!cam) {
//       cam = new THREE.PerspectiveCamera(60, containerRef.current.clientWidth / Math.max(containerRef.current.clientHeight, 1), 0.01, Math.max(size * 100, 1000));
//     }

//     // place camera
//     cam.position.set(center.x + offset, center.y + offset, center.z + offset);
//     if (typeof cam.lookAt === "function") cam.lookAt(center);
//     cam.near = Math.min(cam.near ?? 0.01, 0.01);
//     cam.far = Math.max(cam.far ?? 1000, size * 500);
//     cam.updateProjectionMatrix?.();

//     // attach camera references to viewer context (so internal controls pick it up)
//     try {
//       viewer.context = viewer.context || {};
//       viewer.context.camera = cam;
//       viewer.context.ifcCamera = viewer.context.ifcCamera || {};
//       viewer.context.ifcCamera.camera = cam;
//     } catch (e) {
//       console.warn("attach camera to viewer failed", e);
//     }

//     // find the internal WebGLRenderer (viewer.context.renderer.renderer is typical)
//     const rwrap = viewer.context?.renderer;
//     const threeRenderer = (rwrap && rwrap.renderer) ? rwrap.renderer : (rwrap?.webGLRenderer || null);

//     // If we have the inner WebGLRenderer, resize it to container and render
//     if (threeRenderer && threeRenderer.domElement) {
//       try {
//         const canvas = threeRenderer.domElement;
//         const w = containerRef.current.clientWidth || window.innerWidth;
//         const h = containerRef.current.clientHeight || window.innerHeight;
//         threeRenderer.setSize(w, h, false);
//         // set pixel ratio conservatively
//         threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
//         threeRenderer.render(scene, cam);
//         return;
//       } catch (e) {
//         console.warn("threeRenderer.render failed:", e);
//       }
//     }

//     // fallback: call viewer.context.render() if present
//     if (typeof viewer.context?.render === "function") {
//       try {
//         viewer.context.render();
//         return;
//       } catch (e) {
//         console.warn("viewer.context.render() failed:", e);
//       }
//     }

//     // final fallback: call viewer.render(scene, cam) if available
//     if (typeof viewer.render === "function") {
//       try {
//         viewer.render(scene, cam);
//         return;
//       } catch (e) {
//         console.warn("viewer.render(scene,cam) failed:", e);
//       }
//     }

//     console.warn("ensureCameraAndRender: no render path succeeded");
//   }

//   return (
//     <div
//       ref={containerRef}
//       style={{
//         width: "100%",
//         height: "100%",
//         minHeight: 520,
//         background: "#eef2f6",
//       }}
//     />
//   );
// }


// src/components/IfcBrowserViewer.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Robust IFC viewer component (IfcViewerAPI wrapper)
 * - Loads web-ifc-viewer
 * - Ensures wasm path points to public/web-ifc/
 * - Normalizes/repairs suspicious materials (auto-replace very-transparent materials)
 * - Ensures a usable camera and inner WebGLRenderer are present
 * - Auto-fits the camera and applies a small lift/rotation if the model is effectively flat
 *
 * Usage:
 *  <IfcBrowserViewer fileUrl={uploadedObjectUrl} onModelLoaded={() => {}} />
 *
 * Requirements:
 *  - Put web-ifc wasm files under public/web-ifc/ (e.g. public/web-ifc/web-ifc.wasm)
 */

export default function IfcBrowserViewer({ fileUrl = null, onModelLoaded = () => {} }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  // Initialize IfcViewerAPI once
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const { IfcViewerAPI } = await import("web-ifc-viewer");
        if (!containerRef.current) return;

        const viewer = new IfcViewerAPI({
          container: containerRef.current,
          backgroundColor: new THREE.Color(0xf6f9fc),
        });

        viewerRef.current = viewer;

        // non-fatal helpers
        try {
          viewer.axes.setAxes();
          viewer.grid.setGrid();
        } catch (e) {
          /* ignore */
        }

        // Prefer local public copy of wasm (directory path)
        try {
          // web-ifc-viewer expects a directory path for wasm files
          if (viewer.IFC && typeof viewer.IFC.setWasmPath === "function") {
            viewer.IFC.setWasmPath("/web-ifc/");
          }
        } catch (e) {
          console.warn("Could not set wasm path:", e);
        }

        // Expose viewer for debugging
        try { window.ifcViewer = viewer; } catch (e) { /* non-fatal */ }

        // Auto-load initial file if provided early
        if (mounted && fileUrl) {
          await loadModel(fileUrl);
        }
      } catch (err) {
        console.error("IfcBrowserViewer init error:", err);
      }
    }

    init();
    return () => { mounted = false; };
  }, []);

  // When fileUrl changes, load it
  useEffect(() => {
    if (!viewerRef.current || !fileUrl) return;
    loadModel(fileUrl);
  }, [fileUrl]);

  // Core: load model then normalize materials and fit camera
  async function loadModel(url) {
    const viewer = viewerRef.current;
    if (!viewer) return;

    try {
      try { if (viewer.IFC && typeof viewer.IFC.unloadIfcModel === "function") viewer.IFC.unloadIfcModel(); } catch (e) {}

      // console.log("[IFC] loading model from:", url);
      await viewer.IFC.loadIfcUrl(url);

      // Normalize materials and fix scene orientation/visibility
      await normalizeMaterials(viewer);
      await ensureCameraAndRender(viewer);

      onModelLoaded();
    } catch (err) {
      console.error("Error loading IFC:", err);
    }
  }

  // Replace obviously-problematic materials with a safe MeshStandardMaterial
  async function normalizeMaterials(viewer) {
    const scene = viewer.context?.scene?.scene || viewer.context?.scene;
    if (!scene) return;

    const bgHex = 0xf6f9fc;

    scene.traverse((obj) => {
      if (!obj.isMesh) return;

      // ensure visible
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
          // If material array exists, replace entries that are transparent / invisible
          const suspicious = obj.material.some((m) => !m || m.transparent || (typeof m.opacity === 'number' && m.opacity < 0.05) || m.visible === false);
          if (suspicious) {
            try { obj.material.forEach(m=>m?.dispose?.()); } catch(_){}
            obj.material = new Array(obj.material.length).fill(makeSafeMat(null));
          } else {
            // ensure none are tiny-opacity
            obj.material.forEach((m) => {
              if (m && m.transparent && typeof m.opacity === 'number' && m.opacity < 1) {
                m.transparent = false; m.opacity = 1; m.needsUpdate = true;
              }
            });
          }
        } else {
          const m = obj.material;
          const suspicious = !m || m.transparent || (typeof m.opacity === 'number' && m.opacity < 0.05) || m.visible === false;
          if (suspicious) {
            try { m?.dispose?.(); } catch(_){}
            obj.material = makeSafeMat(m);
          } else if (m && m.transparent && typeof m.opacity === 'number' && m.opacity < 1) {
            m.transparent = false; m.opacity = 1; m.needsUpdate = true;
          }
        }
      } catch (e) {
        console.warn('normalizeMaterials: material handling failed for obj', e);
      }
    });
  }

  // Ensure a camera exists and render the scene. If the model is extremely flat, lift/rotate it slightly.
  async function ensureCameraAndRender(viewer) {
    const scene = viewer.context?.scene?.scene || viewer.context?.scene;
    if (!scene) return;

    // // compute bounding box and basic metrics
    // const bbox = new THREE.Box3().setFromObject(scene);
    // const center = bbox.getCenter(new THREE.Vector3());
    // const sizeVec = bbox.getSize(new THREE.Vector3());
    // const sizeLen = sizeVec.length() || 10;

    // compute bounding box and basic metrics
    const bbox = new THREE.Box3().setFromObject(scene);
    const center = bbox.getCenter(new THREE.Vector3());
    const sizeVec = bbox.getSize(new THREE.Vector3());
    const sizeLen = sizeVec.length() || 10;

    // If the model is very flat in Z (thin), lift it a bit and rotate if needed
    // const zThickness = Math.abs(bbox.max.z - bbox.min.z);
    // const flatThreshold = Math.max(1e-3, sizeLen * 0.005); // heuristic
    const zThickness = Math.abs(bbox.max.z - bbox.min.z);
    const flatThreshold = Math.max(1e-3, sizeLen * 0.005);

    if (zThickness <= flatThreshold) {
      // lift the whole scene upward and try a small rotation so it becomes visible above the grid
      try {
        scene.position.y += sizeLen * 0.15; // lift
        // small rotation to present surface (try both directions if necessary)
        scene.rotation.x += (-Math.PI / 2) * 0.0; // keep default; we only lift by default
        console.info(
          "IfcBrowserViewer: model appears very flat (zThickness",
          zThickness,
          "), applied lift"
        );
      } catch (e) {
        console.warn("Failed to lift/rotate scene", e);
      }
    }

    // choose or create camera
    let cam =
      viewer.context?.ifcCamera?.camera || viewer.context?.camera || null;
    if (!cam) {
      cam = new THREE.PerspectiveCamera(
        60,
        containerRef.current.clientWidth /
          Math.max(1, containerRef.current.clientHeight),
        0.01,
        Math.max(sizeLen * 100, 1000)
      );
    }

    cam.position.set(
      center.x + sizeLen,
      center.y + sizeLen,
      center.z + sizeLen
    );
    if (typeof cam.lookAt === "function") cam.lookAt(center);
    cam.near = Math.min(cam.near ?? 0.01, 0.01);
    cam.far = Math.max(cam.far ?? 1000, sizeLen * 500);
    cam.updateProjectionMatrix?.();

    // attach to viewer context so internal controls use this camera
    try {
      viewer.context = viewer.context || {};
      viewer.context.camera = cam;
      viewer.context.ifcCamera = viewer.context.ifcCamera || {};
      viewer.context.ifcCamera.camera = cam;
    } catch (e) {
      console.warn("attach camera failed", e);
    }

    // pick inner renderer and resize to container
    const rwrap = viewer.context?.renderer;
    const threeRenderer =
      rwrap && rwrap.renderer ? rwrap.renderer : rwrap?.webGLRenderer || null;

    if (threeRenderer && threeRenderer.domElement) {
      try {
        const canvas = threeRenderer.domElement;
        const w = containerRef.current.clientWidth || window.innerWidth;
        const h = containerRef.current.clientHeight || window.innerHeight;
        threeRenderer.setSize(w, h, false);
        threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        threeRenderer.render(scene, cam);
        return;
      } catch (e) {
        console.warn("threeRenderer.render failed", e);
      }
    }

    // fallback render
    if (typeof viewer.context?.render === "function") {
      try {
        viewer.context.render();
        return;
      } catch (e) {
        console.warn("viewer.context.render failed", e);
      }
    }

    if (typeof viewer.render === "function") {
      try {
        viewer.render(scene, cam);
        return;
      } catch (e) {
        console.warn("viewer.render failed", e);
      }
    }

    console.warn("ensureCameraAndRender: no render path succeeded");
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 520, background: '#eef2f6' }}
    />
  );
}
