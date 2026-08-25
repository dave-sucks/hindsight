import { Card } from "@/components/ui/card";
import { PriceGauge } from "@/components/ui/gauge";
import { levelLabelState } from "@/lib/agent/triggers/price-levels";

/**
 * A price level read off the thesis's trigger list — the serialized shape of
 * `PriceLevel` from lib/agent/triggers/price-levels.
 */
export interface CardLevel {
  price: number;
  /** True when the price moves (a trail off the high, a gain off entry). */
  projected: boolean;
  predicateKind: string;
}

/**
 * Price Targets — the levels that actually fire.
 *
 * Reads the resolved trigger list, not `Thesis.entryPrice/targetPrice/
 * stopLoss`. Those columns are a cache, and until the L6 backfill runs they
 * can still name a price nothing enforces — SNOW showed "$256" on a live
 * position whose only real exit was a give-back off the high. When a column
 * has no trigger behind it, the number is shown struck through and labelled
 * so the card stops asserting protection that doesn't exist.
 *
 * See docs/plans/LEVELS_AS_TRIGGERS.md.
 */
export function PriceTargetsBlock({
  entry,
  target,
  stop,
  storedTarget,
  storedStop,
  current,
  direction,
}: {
  /** Entry: the ENTER trigger while watching, the fill price once held. */
  entry: number;
  /** The furthest opportunity level, or null when none is set. */
  target: CardLevel | null;
  /** The protective level that fires FIRST — may be a moving trail. */
  stop: CardLevel | null;
  /**
   * The cached column values. Only used to detect the gap: a number here
   * with nothing in `target` / `stop` means the level is decoration.
   */
  storedTarget?: number | null;
  storedStop?: number | null;
  /** Live current price from /quote. Null while in-flight or on failure. */
  current: number | null;
  /** Drives P&L tinting on the gauge. */
  direction: "LONG" | "SHORT";
}) {
  // 2026-05-31: the gauge shows 4 markers — Stop / Entry / Current / Target —
  // regardless of status. Same labels, same field meanings, every state.
  // 2026-08-25: the numbers now come from the triggers rather than the
  // columns, so a marker on this bar is something that fires.
  const stopPrice = stop?.price ?? null;
  const targetPrice = target?.price ?? null;

  const lo = Math.min(
    stopPrice ?? Number.POSITIVE_INFINITY,
    entry,
    current ?? Number.POSITIVE_INFINITY,
    targetPrice ?? Number.POSITIVE_INFINITY,
  );
  const hi = Math.max(
    stopPrice ?? Number.NEGATIVE_INFINITY,
    entry,
    current ?? Number.NEGATIVE_INFINITY,
    targetPrice ?? Number.NEGATIVE_INFINITY,
  );
  const safeLo = Number.isFinite(lo) ? lo : entry * 0.95;
  const safeHi = Number.isFinite(hi) ? hi : entry * 1.05;
  const span = safeHi - safeLo || entry * 0.1;
  const COUNT = 60;
  const EDGE_PAD = 3;
  const usable = COUNT - EDGE_PAD * 2 - 1;
  // Position a price on the bar as a clamped 0-100% so floating labels
  // never run off the card edge (matches the gauge's idxFor mapping).
  const pctFor = (p: number) => {
    const idx = Math.round(EDGE_PAD + ((p - safeLo) / span) * usable);
    const raw = (idx / (COUNT - 1)) * 100;
    return Math.min(94, Math.max(6, raw));
  };
  const entryPct = pctFor(entry);
  const currentPct = current != null ? pctFor(current) : null;

  return (
    <Card className="bg-muted/40 p-2 gap-3">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Price Targets
      </p>

      <div className="space-y-2">
        {/* Floating labels above their markers. Entry sits on the upper
            band (muted — the anchor), Current on the lower band right above
            the bar (foreground — the live price). Two bands so the two
            labels never collide horizontally when entry ≈ current. Stop and
            Target are fixed at the ends below. */}
        <div className="relative h-8 text-xs tabular-nums">
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-muted-foreground"
            style={{ left: `${entryPct}%` }}
          >
            Entry ${entry.toFixed(2)}
          </span>
          {current != null && currentPct != null ? (
            <span
              className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap font-medium"
              style={{ left: `${currentPct}%` }}
            >
              ${current.toFixed(2)}
            </span>
          ) : null}
        </div>

        <PriceGauge
          entry={entry}
          target={targetPrice}
          stop={stopPrice}
          current={current}
          direction={direction}
        />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <LevelLabel name="Stop" level={stop} stored={storedStop} />
          <LevelLabel name="Target" level={target} stored={storedTarget} />
        </div>
      </div>
    </Card>
  );
}

/**
 * One end-label. Three states, and the third is the point of this whole
 * project: a stored number with no trigger behind it is decoration, and
 * saying "Stop $256" for it is the lie SNOW told for months.
 */
function LevelLabel({
  name,
  level,
  stored,
}: {
  name: string;
  level: CardLevel | null;
  stored?: number | null;
}) {
  const state = levelLabelState(level, stored);
  if (state.kind === "live") {
    return (
      <span>
        {name} ${state.price.toFixed(2)}
        {state.moving ? (
          // A trail moves with the high — say so, or the number looks typed.
          <span className="ml-1 text-muted-foreground/70">trailing</span>
        ) : null}
      </span>
    );
  }
  if (state.kind === "decorative") {
    return (
      <span className="text-muted-foreground/70">
        {name} <span className="line-through">${state.price.toFixed(2)}</span>
        <span className="ml-1">not enforced</span>
      </span>
    );
  }
  return <span>{name} —</span>;
}
