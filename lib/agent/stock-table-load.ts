/**
 * The stock table's rows, read off a stock's facts (lib/agent/stock-facts.ts):
 * the same load get_theses and the thesis sheet read, so no two surfaces
 * disagree about a stock. get_theses builds its analyst's table from the
 * facts it already loaded; `loadStockTable` reads the account's.
 */
import { prisma } from "@/lib/prisma";
import type { AlpacaCredentials } from "@/lib/alpaca";
import { loadStockFacts, type FactsRow, type StockFacts } from "@/lib/agent/stock-facts";
import { SITUATIONS, situationsFor } from "@/lib/agent/situations";
import { movePctOverSessions, volumeRatio } from "@/lib/market-data/indicator-snapshot";
import { EARNINGS_LOOKAHEAD_DAYS, fetchEarningsWindow } from "@/lib/agent/triggers/earnings";
import { sortStockRows, type StockTable, type StockTableRow } from "@/lib/agent/stock-table";

/** The thesis columns a table row reads beyond the facts' own. */
export type TableThesis = FactsRow & { conviction?: string | null; outlook?: string | null; researchRun: { agentConfigId?: string | null; agentConfig?: { name: string | null } | null } | null };

const pct = (now: number | null | undefined, then: number | null | undefined): number | null =>
  now != null && then != null && then > 0 ? ((now - then) / then) * 100 : null;
const STATUS: Record<string, string> = { HOLDING: "held", WATCHING: "watch", PROMOTED: "promoted" };

/** The trades on a stock that wait for the owner, in a few words: "sell 300". */
function waitingLine(proposals: Array<{ side?: string; intent?: string | null; quantity?: number }>): string | null {
  if (proposals.length === 0) return null;
  return proposals
    .map((p) => `${p.side === "SELL" ? (p.intent === "PARTIAL_CLOSE" ? "trim" : "sell") : p.intent === "ADD" ? "add" : "buy"} ${p.quantity ?? "?"}`)
    .join(", ");
}

/** Our stocks' next report dates in the calendar's reach; null when it couldn't be read. */
export async function nextReports(now: Date): Promise<Map<string, string> | null> {
  const window = await fetchEarningsWindow({ now, lookbackDays: 0, lookaheadDays: EARNINGS_LOOKAHEAD_DAYS }).catch(() => null);
  if (!window || window.error) return null;
  return new Map(Array.from(window.upcoming, ([ticker, r]) => [ticker.toUpperCase(), r.reportDate]));
}

/** The table for these stocks, off facts already loaded for them. */
export function stockTableFromFacts(
  theses: TableThesis[],
  facts: StockFacts,
  opts: { nameAnalyst: boolean; reports: Map<string, string> | null },
): StockTable {
  const { load } = facts;
  const rows: StockTableRow[] = theses.map((t) => {
    const price = load.livePrice[t.ticker] ?? null;
    const snap = load.indicators.get(t.ticker.toUpperCase()) ?? null;
    const paid = t.status === "HOLDING" ? (load.positions.get(t.id)?.avgCost ?? null) : null;
    const sources = facts.sources.get(t.id);
    return {
      id: t.id,
      ticker: t.ticker.toUpperCase(),
      status: STATUS[t.status] ?? t.status.toLowerCase(),
      analyst: opts.nameAnalyst ? (t.researchRun?.agentConfig?.name ?? null) : null,
      situations: sources ? situationsFor(sources).map((code) => SITUATIONS[code].name) : [],
      price,
      dayPct: load.dayChange[t.ticker] ?? null,
      volume: snap ? volumeRatio(snap, load.dayVolume[t.ticker]) : null,
      move5dPct: snap && price != null ? movePctOverSessions(snap, price, 5) : null,
      move20dPct: snap && price != null ? movePctOverSessions(snap, price, 20) : null,
      vsSpy1M: snap?.rsVsSpy?.["1M"] ?? null,
      vs50dPct: pct(price, snap?.sma?.[50]),
      offHighPct: pct(price, snap?.high52w),
      sinceBuyPct: pct(price, paid),
      outlook: t.outlook ?? (t.direction === "LONG" || t.direction === "SHORT" ? "not rated" : null),
      conviction: t.conviction ?? null,
      nextReport: opts.reports?.get(t.ticker.toUpperCase()) ?? null,
      waiting: waitingLine(load.proposals.get(t.id) ?? []),
    };
  });
  const asOf = Object.values(load.priceAsOf).sort().at(-1) ?? null;
  return { asOf, rows: sortStockRows(rows) };
}

/** The account's table: every stock held or watched in one book (paper or live), each naming its analyst. Null when it can't be read. */
export async function loadStockTable(args: {
  userId: string;
  accountId: string;
  environment: "PAPER" | "LIVE";
  alpacaCreds?: AlpacaCredentials;
  now?: Date;
}): Promise<StockTable | null> {
  try {
    const theses = await prisma.thesis.findMany({
      where: {
        userId: args.userId,
        status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
        researchRun: { agentConfig: { accountId: args.accountId, tradingEnvironment: args.environment } },
      },
      orderBy: [{ ticker: "asc" }, { id: "asc" }],
      select: {
        id: true,
        ticker: true,
        status: true,
        direction: true,
        triggers: true,
        catalystDate: true,
        createdAt: true,
        outlook: true,
        conviction: true,
        researchRun: { select: { agentConfigId: true, agentConfig: { select: { name: true } } } },
      },
    });
    const [facts, reports] = await Promise.all([
      loadStockFacts(theses, { userId: args.userId, runEnvironment: args.environment, alpacaCreds: args.alpacaCreds, accountId: args.accountId, slots: null }),
      nextReports(args.now ?? new Date()),
    ]);
    return stockTableFromFacts(theses, facts, { nameAnalyst: true, reports });
  } catch (err) {
    console.warn("[stock-table] the account's table couldn't be read:", err);
    return null;
  }
}
