"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { TradeRowShell } from "@/components/ui/trade-row";
import { ThesisSheet, type ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import { statusDotClass, seedFor } from "@/components/dashboard/CoverageTable";
import { setPinnedTicker } from "@/lib/actions/pins.actions";
import type { CoverageData, CoverageRow } from "@/lib/actions/coverage.actions";
import { useTickerQuote, usePrefetchTickers } from "@/hooks/useTickerQuote";
import { formatCurrency } from "@/lib/format";
import { cn, pnlColor } from "@/lib/utils";

// ─── PinnedPanel — the hand-picked shortlist on the dashboard right rail ─────
//
// Pins are stored on the TICKER (see lib/actions/pins.actions.ts for why).
// Nothing about a pinned row is stored with the pin: this component RESOLVES
// each ticker against the coverage data that already drives the table below
// the chart, so a pinned name automatically re-reads itself as you buy it,
// trim it, or sell it. No sync to maintain, no second source of truth.
//
// Row layout is deliberately split:
//   left  — your relationship to the name (shares + total gain / watching / passed)
//   right — the STOCK's move today, identical on every row
// So the panel answers "how's my position doing overall" and "what's moving
// right now" without either question needing its own list.

/** What a pinned ticker resolved to. `row` is null for a name we don't cover. */
interface PinnedEntry {
  ticker: string;
  row: CoverageRow | null;
}

/**
 * Resolve pinned tickers against coverage. A ticker can legitimately appear in
 * more than one bucket (a WATCHING thesis on a name you also hold, a PASSED
 * thesis from before you bought). Priority runs from most-committed to least:
 * an open position beats a watch, a watch beats a closed trade, and a closed
 * trade beats an old pass. That ordering is what makes the row's single line
 * say the most relevant true thing.
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
      open.get(ticker) ??
      watching.get(ticker) ??
      closed.get(ticker) ??
      passed.get(ticker) ??
      null,
  }));
}

/** The bottom-left line: what YOU have on this name, not what it did today. */
function contextLine(row: CoverageRow | null): string {
  // No coverage row: either we've never covered the name, or its last trade /
  // pass fell outside coverage's recent window. "Not held" is the one thing
  // that's true in every one of those cases.
  if (!row) return "Not held";

  if (row.tradeState === "OPEN") {
    const shares = row.shares != null ? `${row.shares} share${row.shares === 1 ? "" : "s"}` : null;
    const gain =
      row.sinceDollar != null
        ? `${row.sinceDollar >= 0 ? "+" : "−"}${formatCurrency(Math.abs(row.sinceDollar))}`
        : null;
    const pct = row.sincePct != null ? ` (${row.sincePct >= 0 ? "+" : ""}${row.sincePct.toFixed(1)}%)` : "";
    return [shares, gain ? `${gain}${pct}` : null].filter(Boolean).join(" · ") || "Holding";
  }

  if (row.tradeState === "CLOSED") {
    const gain =
      row.sinceDollar != null
        ? `${row.sinceDollar >= 0 ? "+" : "−"}${formatCurrency(Math.abs(row.sinceDollar))}`
        : null;
    return gain ? `Sold · ${gain}` : "Sold";
  }

  if (row.verdict != null) {
    return row.anchorPrice != null ? `Passed at $${row.anchorPrice.toFixed(2)}` : "Passed";
  }

  // WATCHING — direction null means the seed hasn't been researched yet.
  if (row.direction === "LONG") return "Watching — long";
  if (row.direction === "SHORT") return "Watching — short";
  return "Awaiting review";
}

// ── One pinned row ───────────────────────────────────────────────────────────
// Its own component so each row can hold its own quote subscription (hooks
// can't run in a loop body).

function PinnedRow({
  entry,
  onOpenThesis,
  onUnpin,
}: {
  entry: PinnedEntry;
  onOpenThesis: (seed: ThesisCardData) => void;
  onUnpin: (ticker: string) => void;
}) {
  const { ticker, row } = entry;
  // Live quote is the source for BOTH price and the day badge, on every row —
  // including uncovered names that have no coverage row to read from. Coverage
  // values are the fallback so a quote failure degrades to the server's last
  // resolved price instead of an em dash.
  const quote = useTickerQuote(ticker);
  const price = quote?.price ?? row?.currentPrice ?? null;
  const dayPct = quote?.changePct ?? row?.oneDayPct ?? null;

  const dot = row ? statusDotClass(row) : "bg-muted-foreground/40";
  const isHeld = row?.tradeState === "OPEN";

  return (
    <TradeRowShell
      href={row?.thesisId ? undefined : `/stocks/${ticker}`}
      onClick={row?.thesisId ? () => onOpenThesis(seedFor(row)) : undefined}
      leading={<StockLogo ticker={ticker} size="md" className="rounded-md" />}
      primary={
        <>
          <span className="text-sm font-medium">{ticker}</span>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
        </>
      }
      trailingTop={
        <span className="text-sm tabular-nums font-light">
          {price != null ? `$${price.toFixed(2)}` : "—"}
        </span>
      }
      secondary={
        <span className={cn(isHeld && row?.sinceDollar != null && pnlColor(row.sinceDollar))}>
          {contextLine(row)}
        </span>
      }
      trailingBottom={
        dayPct != null ? (
          <PnlBadge value={dayPct} format="percent" className="text-xs" />
        ) : (
          <span className="text-[10px] text-muted-foreground/50">—</span>
        )
      }
      menuItems={[{ label: "Unpin", onSelect: () => onUnpin(ticker), destructive: true }]}
    />
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
// Same shape as ProposalsPanel: uppercase mono label + a plain bordered
// container (TradeRowShell brings its own padding and dividers). Renders
// nothing when there are no pins, so it only takes up rail space when used.

export default function PinnedPanel({
  pinned,
  coverage,
}: {
  pinned: string[];
  coverage?: CoverageData;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [seed, setSeed] = useState<ThesisCardData | null>(null);
  // Optimistic removals — the row disappears on click, the server action and
  // the router refresh catch up behind it.
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => pinned.filter((t) => !removed.has(t)),
    [pinned, removed],
  );
  const entries = useMemo(
    () => resolvePinnedRows(visible, coverage),
    [visible, coverage],
  );
  usePrefetchTickers(visible);

  if (visible.length === 0) return null;

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

  return (
    <div className="mb-3">
      <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1.5 px-1">
        Pinned
      </p>
      <div className="rounded-lg border overflow-hidden bg-card">
        {entries.map((entry) => (
          <PinnedRow
            key={entry.ticker}
            entry={entry}
            onOpenThesis={(s) => {
              setSeed(s);
              setSheetOpen(true);
            }}
            onUnpin={handleUnpin}
          />
        ))}
      </div>
      {seed && <ThesisSheet open={sheetOpen} onOpenChange={setSheetOpen} {...seed} />}
    </div>
  );
}
