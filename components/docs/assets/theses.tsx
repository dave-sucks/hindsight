"use client";

import { cn } from "@/lib/utils";
import { Stage } from "../primitives";

/** Where a thesis can be: watching, holding, sold, passed, retired. */
export function ThesisLifecycle() {
  const box = "fill-background stroke-border";
  return (
    <Stage>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 700 230" className="block h-auto w-full min-w-[620px]" role="img" aria-label="Watching becomes Holding when we buy, then Sold when we sell. From Watching, a stock can be Passed after research, or Retired when it's dropped or its belief breaks.">
          <defs>
            <marker id="docs-life-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="fill-foreground/30" />
            </marker>
          </defs>
          <text x="10" y="34" className="fill-muted-foreground text-xs">Every stock is in exactly one of these places.</text>
          {[
            { x: 10, y: 70, w: 160, h: 62, t: "Watching", c: "On the watchlist, with a plan" },
            { x: 270, y: 70, w: 160, h: 62, t: "Holding", c: "Bought. Its triggers guard it", on: true },
            { x: 530, y: 70, w: 160, h: 62, t: "Sold", c: "Closed, then one look back" },
            { x: 10, y: 172, w: 160, h: 50, t: "Passed", c: "Researched and declined" },
            { x: 270, y: 172, w: 180, h: 50, t: "Retired", c: "Dropped, or the belief broke" },
          ].map((s) => (
            <g key={s.t}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={12} className={cn(box, s.on && "stroke-positive")} />
              <text x={s.x + 16} y={s.y + 26} className="fill-foreground text-sm font-medium">{s.t}</text>
              <text x={s.x + 16} y={s.y + (s.h > 55 ? 46 : 40)} className="fill-muted-foreground text-xs">{s.c}</text>
            </g>
          ))}
          <g className="fill-none stroke-foreground/30" strokeWidth={1.4}>
            <path d="M170 101 H266" markerEnd="url(#docs-life-arrow)" />
            <path d="M430 101 H526" markerEnd="url(#docs-life-arrow)" />
            <path d="M90 132 V168" markerEnd="url(#docs-life-arrow)" />
            <path d="M130 132 Q130 152 210 152 Q280 152 300 168" markerEnd="url(#docs-life-arrow)" />
          </g>
          <g className="fill-muted-foreground text-xs">
            <text x="206" y="93">buy</text>
            <text x="466" y="93">sell</text>
            <text x="97" y="156">pass</text>
            <text x="196" y="146">drop</text>
          </g>
        </svg>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">A passed stock is remembered, so the same idea isn&apos;t pitched twice. A sold stock gets one look back before it rests.</p>
    </Stage>
  );
}
