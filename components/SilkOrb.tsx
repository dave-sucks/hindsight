"use client";

import dynamic from "next/dynamic";
import type { SilkProps } from "@/components/Silk";

const Silk = dynamic(() => import("@/components/Silk"), { ssr: false });

interface SilkOrbProps extends SilkProps {
  size?: number;
  className?: string;
}

/**
 * Circular animated Silk avatar — clips the WebGL shader to a circle.
 */
export function SilkOrb({
  size = 48,
  className,
  speed = 10,
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
