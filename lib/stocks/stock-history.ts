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
      label: string;
      dotClass: string;
      sentence: string;
      gain: { dollar: number; pct: number | null } | null;
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

  for (const p of positions) {
    const href = `/trades/${p.id}`;
    const short = p.direction === "SHORT";
    if (p.status === "PENDING_APPROVAL") {
      items.push({
        kind: "trade",
        id: `open-${p.id}`,
        at: p.openedAt.toISOString(),
        href,
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
      at: p.openedAt.toISOString(),
      href,
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
        at: p.closedAt.toISOString(),
        href,
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
