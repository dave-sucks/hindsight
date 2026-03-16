"use client";

import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceGaugeProps {
  entry: number;
  target?: number | null;
  stop?: number | null;
  direction?: "LONG" | "SHORT";
  /** Optional className for the outer wrapper */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(from: number, to: number): string {
  const pct = ((to - from) / from) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

// ─── PriceGauge ───────────────────────────────────────────────────────────────

/**
 * Horizontal bar showing stop loss ← entry → target visually.
 * For LONG: stop < entry < target (risk left, reward right)
 * For SHORT: target < entry < stop (reward left, risk right)
 *
 * Renders nothing if neither target nor stop is provided.
 */
export function PriceGauge({
  entry,
  target,
  stop,
  direction = "LONG",
  className,
}: PriceGaugeProps) {
  if (target == null && stop == null) return null;

  const isLong = direction === "LONG";

  // For LONG: low = stop, high = target
  // For SHORT: low = target, high = stop
  const lowPrice = isLong ? (stop ?? entry) : (target ?? entry);
  const highPrice = isLong ? (target ?? entry) : (stop ?? entry);

  // Add 5% padding on each side for visual breathing room
  const range = highPrice - lowPrice;
  const padding = range * 0.08;
  const min = lowPrice - padding;
  const max = highPrice + padding;
  const totalRange = max - min;

  // Calculate positions as percentages
  const entryPct = totalRange > 0 ? ((entry - min) / totalRange) * 100 : 50;
  const stopPct =
    stop != null && totalRange > 0
      ? ((stop - min) / totalRange) * 100
      : null;
  const targetPct =
    target != null && totalRange > 0
      ? ((target - min) / totalRange) * 100
      : null;

  // For LONG: left of entry = risk (red), right of entry = reward (green)
  // For SHORT: left of entry = reward (green), right of entry = risk (red)
  const riskColor = "bg-negative/30";
  const rewardColor = "bg-positive/30";
  const leftColor = isLong ? riskColor : rewardColor;
  const rightColor = isLong ? rewardColor : riskColor;

  return (
    <div className={cn("space-y-2", className)}>
      {/* ── Price labels row ─────────────────────────────────── */}
      <div className="relative h-5">
        {stopPct != null && stop != null && (
          <div
            className="absolute -translate-x-1/2 text-center"
            style={{ left: `${stopPct}%` }}
          >
            <span className="text-[10px] tabular-nums font-medium text-negative">
              {fmtPrice(stop)}
            </span>
          </div>
        )}
        <div
          className="absolute -translate-x-1/2 text-center"
          style={{ left: `${entryPct}%` }}
        >
          <span className="text-[10px] tabular-nums font-semibold text-foreground">
            {fmtPrice(entry)}
          </span>
        </div>
        {targetPct != null && target != null && (
          <div
            className="absolute -translate-x-1/2 text-center"
            style={{ left: `${targetPct}%` }}
          >
            <span className="text-[10px] tabular-nums font-medium text-positive">
              {fmtPrice(target)}
            </span>
          </div>
        )}
      </div>

      {/* ── Track ────────────────────────────────────────────── */}
      <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
        {/* Left segment (stop → entry for LONG) */}
        <div
          className={cn("absolute inset-y-0 rounded-l-full", leftColor)}
          style={{
            left: `${stopPct ?? 0}%`,
            width: `${entryPct - (stopPct ?? 0)}%`,
          }}
        />
        {/* Right segment (entry → target for LONG) */}
        <div
          className={cn("absolute inset-y-0 rounded-r-full", rightColor)}
          style={{
            left: `${entryPct}%`,
            width: `${(targetPct ?? 100) - entryPct}%`,
          }}
        />
        {/* Entry marker */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${entryPct}%` }}
        />
        {/* Stop marker */}
        {stopPct != null && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-negative"
            style={{ left: `${stopPct}%` }}
          />
        )}
        {/* Target marker */}
        {targetPct != null && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-positive"
            style={{ left: `${targetPct}%` }}
          />
        )}
      </div>

      {/* ── Percentage labels ────────────────────────────────── */}
      <div className="flex items-center justify-between">
        {stop != null ? (
          <span className="text-[10px] tabular-nums text-negative/70">
            {fmtPct(entry, stop)}
          </span>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-muted-foreground font-medium">
          Entry
        </span>
        {target != null ? (
          <span className="text-[10px] tabular-nums text-positive/70">
            {fmtPct(entry, target)}
          </span>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
