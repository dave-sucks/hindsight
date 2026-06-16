import { Card } from "@/components/ui/card";
import { PriceGauge } from "@/components/ui/gauge";

export function PriceTargetsBlock({
  entry,
  target,
  stop,
  current,
  direction,
}: {
  entry: number;
  target: number | null;
  stop: number | null;
  /** Live current price from /quote. Null while in-flight or on failure. */
  current: number | null;
  /** Drives P&L tinting on the gauge. */
  direction: "LONG" | "SHORT";
}) {
  // 2026-05-31: Per P1-3 fix (PRICE_LEVEL_SEMANTICS plan), the gauge now
  // consistently shows 4 markers — Stop / Entry / Current / Target —
  // regardless of status. Same labels, same field meanings, every state.
  // Entry = where you'd buy (WATCHING) or where you bought (ACTIVE, set
  // by place_trade fill). Target = where you'd take profit. Stop = where
  // the thesis breaks. No status-conditional labeling.
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
          target={target}
          stop={stop}
          current={current}
          direction={direction}
        />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{stop != null ? `Stop $${stop.toFixed(2)}` : "Stop —"}</span>
          <span>{target != null ? `Target $${target.toFixed(2)}` : "Target —"}</span>
        </div>
      </div>
    </Card>
  );
}
