"use client";

import { cn } from "@/lib/utils";

/**
 * Aceternity UI — AuroraBackground
 * Layered repeating-linear-gradient with mix-blend-difference
 * and a 60s aurora keyframe for northern-lights shimmer.
 *
 * Uses hardcoded color values instead of Tailwind CSS variables
 * to ensure compatibility regardless of theme config.
 *
 * @see https://ui.aceternity.com/components/aurora-background
 */

interface AuroraBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  showRadialGradient?: boolean;
}

export function AuroraBackground({
  children,
  className,
  showRadialGradient = true,
}: AuroraBackgroundProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center bg-zinc-950 text-slate-200 transition-colors overflow-hidden",
        className
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          style={{
            // Define CSS vars inline so they always exist
            "--white-gradient":
              "repeating-linear-gradient(100deg, #fff 0%, #fff 7%, transparent 10%, transparent 12%, #fff 16%)",
            "--dark-gradient":
              "repeating-linear-gradient(100deg, #000 0%, #000 7%, transparent 10%, transparent 12%, #000 16%)",
            "--aurora":
              "repeating-linear-gradient(100deg, #3b82f6 10%, #a5b4fc 15%, #93c5fd 20%, #ddd6fe 25%, #60a5fa 30%)",
          } as React.CSSProperties}
          className={cn(
            `pointer-events-none absolute -inset-[10px] opacity-50 will-change-transform
            [background-image:var(--dark-gradient),var(--aurora)]
            [background-size:300%,_200%]
            [background-position:50%_50%,50%_50%]
            blur-[10px] invert
            after:content-[""] after:absolute after:inset-0
            after:[background-image:var(--dark-gradient),var(--aurora)]
            after:[background-size:200%,_100%]
            after:[background-attachment:fixed] after:mix-blend-difference
            after:animate-[aurora_60s_linear_infinite]`,
            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,transparent_70%)]`
          )}
        />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
