"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Aceternity UI — AuroraBackground
 * Pure CSS animated aurora effect using layered radial gradients.
 * Zero performance cost — GPU-accelerated transforms only.
 * @see https://ui.aceternity.com/components/aurora-background
 */
export function AuroraBackground({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden", className)} {...props}>
      {/* Aurora layers */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Layer 1 — violet accent */}
        <div
          className="
            absolute -top-1/3 -left-1/4 w-[120%] h-[120%]
            bg-[radial-gradient(circle_at_30%_30%,rgba(124,58,237,0.3),transparent_60%)]
            blur-3xl animate-[auroraFloat_18s_ease-in-out_infinite]
          "
        />

        {/* Layer 2 — purple wash */}
        <div
          className="
            absolute -bottom-1/3 -right-1/4 w-[120%] h-[120%]
            bg-[radial-gradient(circle_at_70%_80%,rgba(168,85,247,0.15),transparent_60%)]
            blur-3xl animate-[auroraShift_22s_ease-in-out_infinite]
          "
        />

        {/* Layer 3 — subtle cool tone */}
        <div
          className="
            absolute top-1/4 left-1/3 w-[100%] h-[100%]
            bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.1),transparent_60%)]
            blur-[100px] animate-[auroraFloat_28s_ease-in-out_infinite]
          "
        />

        <style>
          {`
            @keyframes auroraFloat {
              0% { transform: translate3d(-10%, 0, 0) scale(1); }
              50% { transform: translate3d(10%, -6%, 0) scale(1.05); }
              100% { transform: translate3d(-10%, 0, 0) scale(1); }
            }
            @keyframes auroraShift {
              0% { transform: translate3d(0,0,0) scale(1); }
              50% { transform: translate3d(0,-4%,0) scale(1.08); }
              100% { transform: translate3d(0,0,0) scale(1); }
            }
          `}
        </style>
      </div>

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
