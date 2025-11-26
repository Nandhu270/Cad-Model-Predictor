// ViewerTestSimple.js
import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

export default function ViewerTestSimple({ onPick }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.rotation.y += 0.01;
  });

  return (
    <group>
      {/* ground plane */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.5, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#f0f6ff" />
      </mesh>

      {/* spinning cube */}
      <mesh
        ref={ref}
        position={[0, 0.6, 0]}
        onClick={() => onPick && onPick({ tag: "test-cube" })}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={"#1f6feb"} />
      </mesh>

      {/* marker sphere */}
      <mesh
        position={[2, 0.6, 0]}
        onClick={() => onPick && onPick({ tag: "sphere" })}
      >
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshStandardMaterial color={"#10b981"} />
      </mesh>

      <ambientLight intensity={0.9} />
      <directionalLight position={[5, 10, 5]} intensity={0.6} />
      <OrbitControls makeDefault />
    </group>
  );
}
