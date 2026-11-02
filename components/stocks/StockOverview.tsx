"use client";

/**
 * The stock page's Overview: the price with the chart's selected-range move
 * above the two columns, then the same live chart the thesis sheet and the
 * trade page draw, with whatever the page puts under it (the history) and
 * the sidebar beside it. 1D is the quote's own day change; every other range
 * is the chart's move over it, the same rule as the thesis body.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ThesisChart } from "@/components/domain/thesis-chart";
import { PriceChange } from "@/components/ui/price-change";
import type { RangeMove } from "@/components/stocks/StockPriceChart";
import type { StockCandle } from "@/lib/actions/finnhub.actions";
import { formatCurrency } from "@/lib/format";

export type StockOverviewProps = {
  ticker: string;
  candles: StockCandle[];
  price: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  /** The open position, for the entry marker and the average-cost line. */
  held: { avgCost: number; openedAt: string; direction: "LONG" | "SHORT" } | null;
};

export function StockOverview({
  ticker,
  candles,
  price,
  dayChange,
  dayChangePct,
  held,
  sidebar,
  children,
}: StockOverviewProps & { sidebar: ReactNode; children?: ReactNode }) {
  const [move, setMove] = useState<RangeMove | null>(null);
  // The chart mounts on the client, as it does on the sheet and the trade
  // page (where it follows a fetch). Rendered on the server it hydrated with
  // its responsive container unmeasured and drew nothing until a range click.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dayMove = dayChange != null ? { dollars: dayChange, pct: dayChangePct ?? 0 } : null;
  const shownMove =
    move == null || move.range === "1D"
      ? (dayMove ?? (move ? { dollars: move.dollars, pct: move.pct } : null))
      : { dollars: move.dollars, pct: move.pct };

  return (
    <div className="space-y-5">
      {price != null ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xl font-semibold tabular-nums">{formatCurrency(price)}</span>
          {shownMove ? (
            <PriceChange dollarChange={shownMove.dollars} percentChange={shownMove.pct} size="xl" />
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          {!mounted ? (
            <Skeleton className="h-[300px] w-full rounded-lg" />
          ) : candles.length >= 2 ? (
            <ThesisChart
              ticker={ticker}
              candles={candles}
              direction={held?.direction ?? "LONG"}
              entryPrice={null}
              avgCost={held?.avgCost ?? null}
              levels={null}
              targetPrice={null}
              stopLoss={null}
              current={price}
              addedAt={null}
              enteredAt={held?.openedAt ?? null}
              soldAt={null}
              variant="full"
              onChange={setMove}
              showChange={false}
            />
          ) : null}
          {children}
        </div>
        <div className="hidden lg:block space-y-4">{sidebar}</div>
      </div>
    </div>
  );
}
