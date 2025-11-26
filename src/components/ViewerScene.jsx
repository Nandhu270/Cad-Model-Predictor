// import React from "react";
// import { useFrame } from "@react-three/fiber";
// import { Html } from "@react-three/drei";

// /**
//  * ViewerScene: renders a simple ground plane, placeholder pipes,
//  * and renders spheres for each instrument. Click spheres to select.
//  *
//  * NOTE: This is a 3D preview layer. For real IFC viewing, integrate xf/xeokit or IFC.js.
//  */

// function RotatingMarker({
//   position = [0, 1, 0],
//   label = "I",
//   color = "red",
//   onClick = () => {},
// }) {
//   const ref = React.useRef();
//   useFrame(() => {
//     if (ref.current) ref.current.rotation.y += 0.01;
//   });

//   return (
//     <group position={position}>
//       <mesh ref={ref} onClick={onClick}>
//         <sphereGeometry args={[0.35, 24, 24]} />
//         <meshStandardMaterial
//           emissive={color}
//           emissiveIntensity={0.8}
//           roughness={0.35}
//           metalness={0.2}
//         />
//       </mesh>
//       <Html position={[0, 0.9, 0]}>
//         <div
//           style={{
//             background: "rgba(255,255,255,0.95)",
//             padding: "6px 8px",
//             borderRadius: 6,
//             boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
//             fontSize: 12,
//           }}
//         >
//           {label}
//         </div>
//       </Html>
//     </group>
//   );
// }

// export default function ViewerScene({ instruments = [], onPick }) {
//   // If instruments have location arrays, use them; otherwise spread synthetic positions
//   return (
//     <group>
//       {/* ground */}
//       <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
//         <planeGeometry args={[200, 200]} />
//         <meshStandardMaterial color={"#f3f7fb"} />
//       </mesh>

//       {/* simple pipe preview - one main pipe */}
//       <mesh position={[0, 0.15, 0]}>
//         <boxGeometry args={[8, 0.25, 0.6]} />
//         <meshStandardMaterial color={"#cfe6ff"} />
//       </mesh>

//       {/* instrument markers */}
//       {instruments.map((ins, idx) => {
//         let pos = [-3 + idx * 1.2, 0.6, idx % 2 ? 0.6 : -0.6];
//         if (ins && Array.isArray(ins.location) && ins.location.length >= 3) {
//           // map world coords into viewer's coordinate system loosely
//           const [x, y, z] = ins.location;
//           pos = [x / 2, y, z / 2];
//         }
//         const fail = !(
//           ins.pass_fail?.upstream &&
//           ins.pass_fail?.downstream &&
//           ins.orientation?.vertical_pass
//         );

//         return (
//           <RotatingMarker
//             key={ins.tag ?? idx}
//             position={pos}
//             label={ins.tag ?? ins.type ?? `I${idx + 1}`}
//             color={fail ? "salmon" : "limegreen"}
//             onClick={() => onPick(ins)}
//           />
//         );
//       })}
//     </group>
//   );
// }


// ViewerScene.js (robust, defensive)
// Paste this into src/components/ViewerScene.js and import it where you used the old ViewerScene.

import React, { useEffect } from "react";
import { Html } from "@react-three/drei";

/**
 * ViewerScene: Defensive viewer that accepts `instruments` as prop.
 * It will:
 *  - console.log the instruments (for debugging)
 *  - normalize several backend shapes to a predictable object
 *  - compute safe positions if location missing or invalid
 *  - render clickable markers and labels
 *
 * Props:
 *  - instruments: array (may be undefined)
 *  - onPick: function(instrument) called when user clicks marker
 */

function isValidNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function safeLocation(loc) {
  if (!Array.isArray(loc) || loc.length < 3) return false;
  return loc.every(isValidNumber);
}

function normalizeInstrument(raw, idx) {
  // Accept multiple possible field names, produce consistent fields
  const tag = raw.tag || raw.Tag || raw.name || raw.Name || `INST-${idx+1}`;
  const type = raw.type || raw.Type || raw.instrument_type || raw.name || "instrument";

  // location may be at raw.location, raw.Location, raw.coords, raw.position, or missing
  let location = null;
  if (safeLocation(raw.location)) location = raw.location;
  else if (safeLocation(raw.Location)) location = raw.Location;
  else if (safeLocation(raw.coords)) location = raw.coords;
  else if (safeLocation(raw.position)) location = raw.position;
  else if (safeLocation(raw.pos)) location = raw.pos;

  // pass/fail: backend might return nested pass_fail or top-level booleans
  let passFail = raw.pass_fail || raw.passFail || {};
  // top-level booleans as fallback
  if (typeof raw.upstream_pass !== "undefined" || typeof raw.downstream_pass !== "undefined") {
    passFail = {
      upstream: raw.upstream_pass === true,
      downstream: raw.downstream_pass === true,
    };
  }
  // orientation
  let orientation = raw.orientation || raw.Orientation || { tilt_deg: raw.tilt_deg ?? 0, vertical_pass: raw.orientation?.vertical_pass ?? (raw.tilt_deg ? Math.abs(raw.tilt_deg) <= 3 : true) };

  // measured lengths
  let measured = raw.measured || raw.Measured || { upstream_m: raw.upstream_length_m || raw.upstream_m || null, downstream_m: raw.downstream_length_m || raw.downstream_m || null };

  return {
    raw,
    tag,
    type,
    location,         // null if not valid
    measured,
    passFail,
    orientation
  };
}

export default function ViewerScene({ instruments = [], onPick = () => {} }) {
  useEffect(() => {
    // console.log("ViewerScene instruments (raw):", instruments);
  }, [instruments]);

  // normalize instrument list
  const normalized = (Array.isArray(instruments) ? instruments : []).map((ins, i) => normalizeInstrument(ins, i));

  // If many instruments have no location, synthesize spread-out positions
  // Count how many have valid location
  const validCount = normalized.reduce((c, v) => c + (v.location ? 1 : 0), 0);

  return (
    <group >
      {/* ground plane */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={"#f3f7fb"} />
      </mesh>

      {/* simple pipe preview */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[8, 0.25, 0.6]} />
        <meshStandardMaterial color={"#cfe6ff"} />
      </mesh>

      {normalized.map((ins, idx) => {
        // compute position: if location present, map to viewer coords
        // Note: many IFCS use X,Y,Z. Viewer uses [x,y,z]. If your world coord system differs,
        // adjust the scale/axis mapping here.
        let pos;
        if (ins.location) {
          // Allow small scale down so large-world models sit in view
          pos = [
            ins.location[0] / 1.0,
            ins.location[1] / 1.0,
            ins.location[2] / 1.0,
          ];
        } else {
          // no location: spread along pipe preview
          const spacing = 1.2;
          pos = [-3 + idx * spacing, 0.6, idx % 2 ? 0.6 : -0.6];
        }

        // defensive: ensure numbers
        pos = pos.map((v) => (isValidNumber(v) ? v : 0));

        // determine color from pass/fail heuristics
        const upOk = ins.passFail?.upstream ?? true;
        const dnOk = ins.passFail?.downstream ?? true;
        const orientOk = ins.orientation?.vertical_pass ?? true;
        const allOk = !!(upOk && dnOk && orientOk);
        const color = allOk ? "limegreen" : "salmon";

        // label for HTML overlay
        const label = ins.tag || ins.type || `I${idx + 1}`;

        return (
          <group key={ins.tag ?? idx} position={pos}>
            <mesh onClick={() => onPick(ins.raw)} castShadow>
              <sphereGeometry args={[0.35, 24, 24]} />
              <meshStandardMaterial
                color={color}
                roughness={0.3}
                metalness={0.1}
              />
            </mesh>

            {/* label above marker */}
            <Html position={[0, 0.9, 0]} center>
              <div
                style={{
                  background: "rgba(255,255,255,0.95)",
                  padding: "6px 8px",
                  borderRadius: 6,
                  boxShadow: "0 6px 18px rgba(2,6,23,0.08)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {label}
                <div
                  style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}
                >
                  {allOk ? "OK" : "Issue"}
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
