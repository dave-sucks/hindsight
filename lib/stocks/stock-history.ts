/**
 * Hindsight on one stock — every thesis and every trade on it, as one list
 * of dated rows in the homepage activity feed's shape. Pure: the page hands
 * in the rows it already loaded.
 *
 * A thesis is one row at the date it was written, carrying its status, so a
 * pass or a watch reads quietly and a holding reads as held. A trade is two
 * rows: the buy at the open, and once closed the sale with its result — the
 * rows that should stand out on a stock's page.
 */

import { buildTradeSentence } from "@/lib/trade-statement";
import { getThesisSnapshotText } from "@/lib/agent/thesis-narrative";

export type StockHistoryItem =
  | {
      kind: "thesis";
      id: string;
      /** ISO timestamp the row sorts and groups by. */
      at: string;
      thesisId: string;
      status: string;
      sentence: string;
    }
  | {
      kind: "trade";
      id: string;
      at: string;
      href: string;
      /** The position the row belongs to: the Transactions tab opens its dialog on it. */
      positionId: string;
      label: string;
      dotClass: string;
      sentence: string;
      gain: { dollar: number; pct: number | null } | null;
    };

/**
 * One transaction's facts, as every surface can hand them in (ISO dates, so
 * the sheet's position and a page's loaded rows look the same): the rows of
 * the Transactions tab and the dialog a row opens.
 */
export type TransactionFacts = {
  id: string;
  direction: string;
  /** OPEN | CLOSED | PENDING_APPROVAL, the Position's status. */
  status: string;
  outcome?: string | null;
  avgCost: number;
  closePrice: number | null;
  realizedPnl: number | null;
  quantity: number;
  openedAt: string;
  closedAt: string | null;
  closeReason?: string | null;
  analyst?: { id: string; name: string } | null;
};

export type StockHistoryPosition = {
  id: string;
  direction: string;
  status: string;
  avgCost: number;
  closePrice: number | null;
  realizedPnl: number | null;
  quantity: number;
  openedAt: Date;
  closedAt: Date | null;
};

export type StockHistoryThesis = Parameters<typeof getThesisSnapshotText>[0] & {
  id: string;
  status: string;
  createdAt: Date;
  coreBelief?: string | null;
  researchRun?: { agentConfig?: { name: string | null } | null } | null;
};

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function buildStockHistory(
  positions: StockHistoryPosition[],
  theses: StockHistoryThesis[],
): StockHistoryItem[] {
  const items: StockHistoryItem[] = [];

  for (const t of theses) {
    const who = t.researchRun?.agentConfig?.name ?? null;
    const text = getThesisSnapshotText(t) || t.coreBelief || "";
    items.push({
      kind: "thesis",
      id: `thesis-${t.id}`,
      at: t.createdAt.toISOString(),
      thesisId: t.id,
      status: t.status,
      sentence: clip(who && text ? `${who}: ${text}` : who || text || "Thesis"),
    });
  }

  items.push(
    ...transactionRows(
      positions.map((p) => ({
        id: p.id,
        direction: p.direction,
        status: p.status,
        avgCost: p.avgCost,
        closePrice: p.closePrice,
        realizedPnl: p.realizedPnl,
        quantity: p.quantity,
        openedAt: p.openedAt.toISOString(),
        closedAt: p.closedAt ? p.closedAt.toISOString() : null,
      })),
    ),
  );

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * A stock's transactions as rows: the buy at the open (a proposal while it
 * waits), and once closed the sale with its result. Newest first.
 */
export function transactionRows(facts: TransactionFacts[]): Extract<StockHistoryItem, { kind: "trade" }>[] {
  const items: Extract<StockHistoryItem, { kind: "trade" }>[] = [];
  for (const p of facts) {
    const href = `/trades/${p.id}`;
    const short = p.direction === "SHORT";
    if (p.status === "PENDING_APPROVAL") {
      items.push({
        kind: "trade",
        id: `open-${p.id}`,
        at: p.openedAt,
        href,
        positionId: p.id,
        label: "Proposal",
        dotClass: "bg-amber-500",
        sentence:
          buildTradeSentence({
            kind: "proposed-buy",
            qty: p.quantity,
            entry: p.avgCost,
            buyVerb: short ? "Short" : "Buy",
          }) ?? "Proposed",
        gain: null,
      });
      continue;
    }
    items.push({
      kind: "trade",
      id: `open-${p.id}`,
      at: p.openedAt,
      href,
      positionId: p.id,
      label: short ? "Shorted" : "Bought",
      dotClass: short ? "bg-negative" : "bg-positive",
      sentence: buildTradeSentence({ kind: "holding", qty: p.quantity, entry: p.avgCost }) ?? "Bought",
      gain: null,
    });
    if (p.status === "CLOSED" && p.closedAt) {
      const cost = p.avgCost * p.quantity;
      items.push({
        kind: "trade",
        id: `close-${p.id}`,
        at: p.closedAt,
        href,
        positionId: p.id,
        label: "Sold",
        dotClass: "bg-muted-foreground/60",
        sentence:
          buildTradeSentence({
            kind: "closed",
            qty: p.quantity,
            entry: p.avgCost,
            closePrice: p.closePrice,
          }) ?? "Sold",
        gain:
          p.realizedPnl != null
            ? { dollar: p.realizedPnl, pct: cost > 0 ? (p.realizedPnl / cost) * 100 : null }
            : null,
      });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
