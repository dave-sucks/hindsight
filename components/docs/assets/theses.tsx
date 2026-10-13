"use client";

import { useState, type ReactNode } from "react";
import { TickerBadge } from "@/components/ui/ticker-badge";
import { cn } from "@/lib/utils";
import { Stage } from "../primitives";
import { PillRow, type PillSpec } from "../trigger-bits";

type Part = "belief" | "wrong" | "plan";

const NOTES: readonly { part: Part; title: string; body: string; swatch: string }[] = [
  { part: "belief", title: "The belief", body: "One sentence we can be wrong about, with a price and a date.", swatch: "bg-chart-2/30" },
  { part: "wrong", title: "What would prove it wrong", body: "Written before the buy, so a bad day isn't mistaken for a broken story.", swatch: "bg-negative/25" },
  { part: "plan", title: "The plan, as triggers", body: "Each one a sentence the system checks for you, all day.", swatch: "bg-positive/25" },
];

const MARK: Record<Part, string> = { belief: "bg-chart-2/20", wrong: "bg-negative/15", plan: "bg-positive/10" };

const PLAN: readonly { action: PillSpec["action"]; specs: PillSpec[] }[] = [
  { action: "ADD", specs: [{ action: "ADD", when: { watch: "move", is: "above", value: 12, variable: "entry" }, why: "Press it once the drift is confirmed." }] },
  {
    action: "REVIEW",
    specs: [
      { action: "REVIEW", when: { watch: "price", is: "above", value: 480 }, why: "At the target: take it, or trail higher." },
      { action: "REVIEW", when: { watch: "repeat", value: 7 }, why: "A weekly look while the drift plays out." },
    ],
  },
  { action: "TRIM", specs: [{ action: "TRIM", when: { watch: "move", is: "above", value: 15, variable: "entry" }, why: "A partial at twice the risk." }] },
  { action: "EXIT", specs: [{ action: "EXIT", when: { watch: "price", is: "below", value: 384 }, why: "Under the gap-day low, the drift has failed." }] },
];

function Mark({ part, on, children }: { part: Part; on: Part | null; children: ReactNode }) {
  return <mark className={cn("rounded px-0.5 text-inherit transition-colors", !on || on === part ? MARK[part] : "bg-transparent")}>{children}</mark>;
}

/** A thesis with its three parts marked: hover a part to light it up. */
export function ThesisAnatomy() {
  const [on, setOn] = useState<Part | null>(null);
  return (
    <Stage label="Example">
      <div className="grid items-center gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)]">
        <div className="order-2 flex flex-col gap-3 md:order-1">
          {NOTES.map((n) => (
            <button
              key={n.part}
              type="button"
              onMouseEnter={() => setOn(n.part)}
              onMouseLeave={() => setOn(null)}
              onFocus={() => setOn(n.part)}
              onBlur={() => setOn(null)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border bg-background p-3.5 text-left shadow-sm transition",
                on === n.part && "translate-x-1 border-foreground/20",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className={cn("size-2.5 rounded-sm", n.swatch)} />
                {n.title}
              </span>
              <span className="text-sm text-muted-foreground">{n.body}</span>
            </button>
          ))}
        </div>
        <div className="order-1 overflow-hidden rounded-2xl border bg-background shadow-sm md:order-2">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <TickerBadge ticker="CRWD" />
            <span className="text-sm text-muted-foreground">CrowdStrike</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-positive" />
              Holding
            </span>
            <span className="rounded-full border px-2 py-px text-xs text-muted-foreground">High conviction</span>
            <span className="rounded-full border px-2 py-px text-xs text-muted-foreground">Post-earnings drift</span>
          </div>
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Belief</span>
              <p className="text-sm leading-relaxed text-foreground">
                <Mark part="belief" on={on}>
                  CRWD drifts from the $412 entry to $480 or more within 60 days
                </Mark>{" "}
                of its report, as estimates move up and institutions absorb the pullback.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Wrong if</span>
              <p className="text-sm leading-relaxed text-foreground">
                <Mark part="wrong" on={on}>
                  It closes below $384 on heavy volume
                </Mark>
                , or next quarter&apos;s new ARR misses the guide.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Plan</span>
              <div className={cn("flex flex-col gap-1.5 rounded-xl p-2.5 transition-colors", !on || on === "plan" ? MARK.plan : "bg-transparent")}>
                {PLAN.map((r) => (
                  <PillRow key={r.action} action={r.action} specs={r.specs} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}

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
