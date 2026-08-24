"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { TradeRow, WatchlistRow } from "@/components/ui/trade-row";
import { setPinnedTicker } from "@/lib/actions/pins.actions";
import type { CoverageData, CoverageRow } from "@/lib/actions/coverage.actions";
import { useTickerQuote, usePrefetchTickers } from "@/hooks/useTickerQuote";

// ─── PinnedPanel — the hand-picked shortlist on the dashboard right rail ─────
//
// Renders with the SAME row components as every other stock list in the app:
// TradeRow for names you hold or recently sold, WatchlistRow for names you're
// only watching. Nothing here composes TradeRowShell by hand — a pinned NVDA
// and an NVDA row anywhere else are the identical component.
//
// Pins are stored on the TICKER (see lib/actions/pins.actions.ts). Nothing
// about the row is stored with the pin: each ticker is resolved against the
// coverage data that already drives the table below the chart, so a pinned
// name re-reads itself as you buy, trim, or sell it.

/** What a pinned ticker resolved to. `row` is null for a name we don't cover. */
interface PinnedEntry {
  ticker: string;
  row: CoverageRow | null;
}

/**
 * Resolve pinned tickers against coverage. A ticker can legitimately sit in
 * more than one bucket (a WATCHING thesis on a name you also hold, an old
 * PASSED thesis from before you bought). Priority runs most-committed first:
 * open position → watch → closed trade → pass.
 */
export function resolvePinnedRows(
  pinned: string[],
  coverage: CoverageData | undefined,
): PinnedEntry[] {
  const open = new Map<string, CoverageRow>();
  const closed = new Map<string, CoverageRow>();
  for (const r of coverage?.trades ?? []) {
    const bucket = r.tradeState === "OPEN" ? open : closed;
    if (!bucket.has(r.ticker)) bucket.set(r.ticker, r);
  }
  const watching = new Map<string, CoverageRow>();
  for (const r of coverage?.watching ?? []) if (!watching.has(r.ticker)) watching.set(r.ticker, r);
  const passed = new Map<string, CoverageRow>();
  for (const r of coverage?.passed ?? []) if (!passed.has(r.ticker)) passed.set(r.ticker, r);

  return pinned.map((ticker) => ({
    ticker,
    row:
      open.get(ticker) ?? watching.get(ticker) ?? closed.get(ticker) ?? passed.get(ticker) ?? null,
  }));
}

/** Display key TradeRow expects — same derivation the coverage table uses. */
function tradeStatus(row: CoverageRow): string {
  if (row.tradeState === "OPEN") return "OPEN";
  return (row.sinceDollar ?? 0) >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS";
}

// A pinned name with no thesis and no position has no coverage row, so there's
// no server-resolved price to hand WatchlistRow. Pull it from the shared quote
// cache instead — its own component so the hook isn't called in a loop body.
function UncoveredPinnedRow({
  ticker,
  unpin,
}: {
  ticker: string;
  unpin: { label: string; onSelect: () => void; destructive?: boolean }[];
}) {
  const quote = useTickerQuote(ticker);
  return (
    <WatchlistRow
      ticker={ticker}
      currentPrice={quote?.price}
      direction={undefined}
      extraMenuItems={unpin}
    />
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
// Same shape as ProposalsPanel: uppercase mono label + a plain bordered
// container (the rows bring their own padding and dividers). Renders nothing
// when there are no pins.

export default function PinnedPanel({
  pinned,
  coverage,
}: {
  pinned: string[];
  coverage?: CoverageData;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Optimistic removals — the row disappears on click, the server action and
  // the router refresh catch up behind it.
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const visible = useMemo(() => pinned.filter((t) => !removed.has(t)), [pinned, removed]);
  const entries = useMemo(() => resolvePinnedRows(visible, coverage), [visible, coverage]);
  usePrefetchTickers(visible);

  const handleUnpin = (ticker: string) => {
    setRemoved((prev) => new Set(prev).add(ticker));
    startTransition(async () => {
      const res = await setPinnedTicker(ticker, false);
      if (!res.ok) {
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(ticker);
          return next;
        });
        toast.error(res.error ?? `Couldn't unpin ${ticker}`);
        return;
      }
      router.refresh();
    });
  };

  if (visible.length === 0) return null;

  return (
    <div className="mb-3">
      <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1.5 px-1">
        Pinned
      </p>
      <div className="rounded-lg border overflow-hidden bg-card">
        {entries.map(({ ticker, row }) => {
          const unpin = [
            { label: "Unpin", onSelect: () => handleUnpin(ticker), destructive: true },
          ];
          const direction = row?.direction === "LONG" || row?.direction === "SHORT" ? row.direction : null;

          // Held or recently sold — the trade row, exactly as the trades list
          // and the proposals rail render it.
          if (row && row.tradeState != null) {
            return (
              <TradeRow
                key={ticker}
                id={row.key}
                ticker={ticker}
                currentPrice={row.currentPrice ?? 0}
                entryPrice={row.anchorPrice ?? undefined}
                shares={row.shares ?? undefined}
                pnl={row.sinceDollar ?? 0}
                pnlPct={row.sincePct ?? 0}
                status={tradeStatus(row)}
                openedAt={row.anchorAt}
                thesisId={row.thesisId ?? undefined}
                direction={direction ?? undefined}
                extraMenuItems={unpin}
              />
            );
          }

          // Watching or passed — the watchlist row (a trade row without the
          // amount and shares), which already shows the day's move.
          if (row) {
            return (
              <WatchlistRow
                key={ticker}
                ticker={ticker}
                currentPrice={row.currentPrice ?? undefined}
                direction={direction}
                thesisId={row.thesisId ?? undefined}
                extraMenuItems={unpin}
              />
            );
          }

          return <UncoveredPinnedRow key={ticker} ticker={ticker} unpin={unpin} />;
        })}
      </div>
    </div>
  );
}
