"use client";

/**
 * Gauge — Polymarket-style tick-bar primitives.
 *
 * <TickBar />     low-level: a row of evenly-spaced 2px vertical strokes
 *                 driven by an array of Tick configs.
 *
 * <PriceGauge />  high-level: stop/entry/target levels (and an optional
 *                 current price) plotted on a TickBar with the segment
 *                 between entry and current tinted by P&L.
 *
 * Reuse anywhere we need to visualize a price range — thesis sheets,
 * trade row mini-charts, the trade detail page, etc.
 */

import { cn } from "@/lib/utils";

// ── TickBar ────────────────────────────────────────────────────────────────

export type Tick = {
  /** Tailwind background class for this stroke */
  color: string;
  /** Render this stroke at full bar height instead of the shorter base height */
  tall?: boolean;
  /**
   * Per-tick height override in px. When set, takes precedence over `tall`.
   * Use to emphasize boundary markers (e.g. the leftmost-bear / rightmost-bull
   * ticks on the consensus distribution bar). Slightly taller than the bar
   * itself is fine — the container uses items-center so overflow renders
   * symmetrically above + below.
   */
  heightPx?: number;
};

export function TickBar({
  ticks,
  height = 16,
  className,
}: {
  ticks: Tick[];
  /** Total bar height in px */
  height?: number;
  className?: string;
}) {
  const baseHeight = Math.round(height * 0.7);
  // Bump the container's reserved vertical space to fit the tallest tick.
  // Without this, a 22px boundary tick inside a 16px container visibly
  // overflows the surrounding row's line-box and pushes adjacent labels.
  const maxTickHeight = ticks.reduce(
    (m, t) => Math.max(m, t.heightPx ?? (t.tall ? height : baseHeight)),
    height,
  );
  return (
    <div
      className={cn("relative w-full flex items-center justify-between", className)}
      style={{ height: maxTickHeight }}
    >
      {ticks.map((t, i) => (
        <span
          key={i}
          className={cn("w-0.5 rounded-full", t.color)}
          style={{ height: t.heightPx ?? (t.tall ? height : baseHeight) }}
        />
      ))}
    </div>
  );
}

// ── PriceGauge ─────────────────────────────────────────────────────────────

export type PriceGaugeProps = {
  /** Position entry (always required) */
  entry: number;
  /** Take-profit price */
  target?: number | null;
  /** Stop-loss price */
  stop?: number | null;
  /**
   * Optional current market price. When provided the gauge shows a
   * "current" marker and tints the strip between entry and current with a
   * P&L color (green when in profit, red when underwater). LONG = current
   * above entry is profit; SHORT = current below entry is profit.
   */
  current?: number | null;
  direction?: "LONG" | "SHORT";
  /** Total ticks across the bar. Default 60. */
  count?: number;
  /** Empty ticks of breathing room on each edge. Default 3. */
  edgePad?: number;
  /** Bar height in px. Default 16. */
  height?: number;
  className?: string;
};

export function PriceGauge({
  entry,
  target,
  stop,
  current,
  direction = "LONG",
  count = 60,
  edgePad = 3,
  height = 16,
  className,
}: PriceGaugeProps) {
  // Bar bounds — left edge sits at the lowest of stop/entry/current,
  // right edge at the highest of target/entry/current. Falling back to
  // entry ± 5% when only entry is provided.
  const lo = Math.min(
    stop ?? Number.POSITIVE_INFINITY,
    entry,
    current ?? Number.POSITIVE_INFINITY,
    target ?? Number.POSITIVE_INFINITY,
  );
  const hi = Math.max(
    stop ?? Number.NEGATIVE_INFINITY,
    entry,
    current ?? Number.NEGATIVE_INFINITY,
    target ?? Number.NEGATIVE_INFINITY,
  );
  const safeLo = Number.isFinite(lo) ? lo : entry * 0.95;
  const safeHi = Number.isFinite(hi) ? hi : entry * 1.05;
  const span = safeHi - safeLo || entry * 0.1;

  // Map a price → tick index. The first/last `edgePad` ticks are always
  // empty so the highlighted markers never sit at the absolute edge of
  // the bar.
  const usable = count - edgePad * 2 - 1;
  const idxFor = (p: number) =>
    Math.round(edgePad + ((p - safeLo) / span) * usable);

  const stopIdx = stop != null ? idxFor(stop) : -1;
  const targetIdx = target != null ? idxFor(target) : -1;
  const entryIdx = idxFor(entry);
  const currentIdx = current != null ? idxFor(current) : -1;

  // Profit direction
  const profitable =
    current == null
      ? null
      : direction === "LONG"
        ? current >= entry
        : current <= entry;
  const fillCls = profitable === null
    ? null
    : profitable
      ? "bg-positive/40"
      : "bg-negative/40";

  // Overshoot — current has pushed PAST the target (LONG: above; SHORT:
  // below). The stretch between target and current is the "we beat the
  // target" zone, the whole point of the gauge. Paint it full-strength
  // green so it reads as a win at a glance, distinct from the muted
  // entry→current profit tint.
  const beyondTarget =
    current != null && target != null
      ? direction === "LONG"
        ? current > target
        : current < target
      : false;
  const overshootLo = beyondTarget ? Math.min(targetIdx, currentIdx) : -1;
  const overshootHi = beyondTarget ? Math.max(targetIdx, currentIdx) : -1;

  const ticks: Tick[] = Array.from({ length: count }, (_, i) => {
    // Ordered by visual priority — current > entry > stop > target
    if (i === currentIdx) return { color: "bg-foreground", tall: true };
    if (i === entryIdx) {
      return {
        color: current != null ? "bg-muted-foreground" : "bg-foreground",
        tall: true,
      };
    }
    if (i === stopIdx) return { color: "bg-negative", tall: true };
    if (i === targetIdx) return { color: "bg-positive", tall: true };

    // Above-target overshoot — strong green between target and current.
    if (overshootLo >= 0 && i > overshootLo && i < overshootHi) {
      return { color: "bg-positive" };
    }

    // Tinted fill between entry and current when active
    if (fillCls && currentIdx >= 0) {
      const minIdx = Math.min(entryIdx, currentIdx);
      const maxIdx = Math.max(entryIdx, currentIdx);
      if (i > minIdx && i < maxIdx) return { color: fillCls };
    }

    return { color: "bg-muted-foreground/25" };
  });

  return <TickBar ticks={ticks} height={height} className={className} />;
}
