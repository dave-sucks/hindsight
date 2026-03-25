"use client";

import dynamic from "next/dynamic";
import type { SilkProps } from "./silk";

const Silk = dynamic(() => import("./silk"), { ssr: false });

interface SilkOrbProps extends SilkProps {
  size?: number;
  className?: string;
}

/**
 * Circular animated Silk avatar — Linear/Cursor style.
 * Renders the WebGL silk shader clipped to a circle.
 */
export function SilkOrb({
  size = 48,
  className,
  speed = 8,
  scale = 1,
  color = "#AEFD83",
  noiseIntensity = 1.5,
  rotation = 0,
}: SilkOrbProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <Silk
        speed={speed}
        scale={scale}
        color={color}
        noiseIntensity={noiseIntensity}
        rotation={rotation}
      />
    </div>
  );
}
