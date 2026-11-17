/**
 * The Portfolio Manager's read of a stock (get_theses on its run). The book
 * is one line a stock in its first message; this is the detail it asks for by
 * name, in two sizes, and the limits are here, not in its job text:
 *   the card: a few lines on a stock, for up to CARDS_A_RUN stocks a run;
 *   the full case: what a buy or an add reads, for up to FULL_A_RUN.
 * It has no read of the whole book.
 */
import { z } from "zod";
import { rowForModel } from "@/lib/agent/row-for-model";

export const CARDS_A_RUN = 8;
export const FULL_A_RUN = 3;
/** The Activity lines on a card. */
const CARD_LINES = 3;

export const isManagerRun = (ctx: { runMode?: string }) => ctx.runMode === "PORTFOLIO_MANAGER";

export const managerReadSchema = z.object({
  tickers: z.array(z.string()).describe(`The stocks to open. A run opens ${CARDS_A_RUN} stocks at most, so name only the ones you may act on.`),
  full: z
    .boolean()
    .optional()
    .describe(`true only for a stock you are about to buy or add to: its whole case, the chart numbers, Wall Street's view and the playbook's triggers that come with the buy. ${FULL_A_RUN} stocks a run at most. A sale, a trim or a note needs only the card.`),
});

type Row = Record<string, unknown>;
const CARD_KEYS = ["stock", "id", "analyst", "position", "proposal_waiting", "price", "belief", "would_prove_it_wrong", "conviction_rationale", "triggers"] as const;
const NOT_ON_THE_FULL_CASE = ["situations", "repeat", "note", "research"] as const;

const opened = new WeakMap<object, { cards: Set<string>; full: Set<string> }>();

/** The stocks this call may open, counted against the run; `note` says what was left out, `refused` that nothing was opened. */
export function managerPick(ctx: object, input: { tickers?: string[]; full?: boolean }): { tickers: string[]; full: boolean; note?: string; refused?: string } {
  const seen = opened.get(ctx) ?? { cards: new Set<string>(), full: new Set<string>() };
  opened.set(ctx, seen);
  const full = input.full === true;
  const asked = [...new Set((input.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (asked.length === 0) return { tickers: [], full, refused: "Name the stocks to open: there is no read of the whole book. Every stock is one line in your first message." };
  const set = full ? seen.full : seen.cards;
  const cap = full ? FULL_A_RUN : CARDS_A_RUN;
  const tickers = asked.filter((t) => set.has(t) || (set.size < cap && set.add(t)));
  const left = asked.filter((t) => !tickers.includes(t));
  const limit = full ? `${FULL_A_RUN} full cases a run` : `${CARDS_A_RUN} stocks a run`;
  if (tickers.length === 0) return { tickers, full, refused: `Not opened: ${left.join(", ")}. You have opened your ${limit}. Decide from what you have read.` };
  return { tickers, full, ...(left.length ? { note: `Not opened: ${left.join(", ")}. The limit is ${limit}.` } : {}) };
}

/** One stock as the Portfolio Manager reads it: the card, or the full case. */
export function managerRow(row: Row, full: boolean): Row {
  const all = rowForModel({ ...row, situations: [] }, { named: false, size: "short", playbookChecks: full }) as Row;
  if (full) return Object.fromEntries(Object.entries(all).filter(([k]) => !(NOT_ON_THE_FULL_CASE as readonly string[]).includes(k)));
  const card: Row = Object.fromEntries(CARD_KEYS.filter((k) => all[k] != null).map((k) => [k, all[k]]));
  const lines = typeof row.context === "string" ? row.context.split("\n").filter((l) => l.startsWith("  ")).slice(0, CARD_LINES) : [];
  if (lines.length) card.said = lines.map((l) => l.trim());
  return card;
}
