/**
 * The principal's decision or note no run has answered: a decision that
 * wants an answer (a decline with a reason, a resized approval, a hand edit),
 * or a note written since the last answer. Rule: `unansweredDecision`, moved
 * from stock-context.ts's buildStockContext, which still prints the
 * decisions in its block.
 */
import {
  isAgentAnswer,
  newestFirst,
  newestNotes,
  oneLine,
  principalDecision,
  type ActivityRow,
  type PrincipalDecision,
} from "@/lib/agent/stock-context";
import type { SituationDefinition } from "./types";

/** The first decision since the last answer that wants one, else a note written since it. */
export function unansweredDecision(activity: ActivityRow[], currentPrice: number | null): PrincipalDecision | null {
  const rows = newestFirst(activity);
  const last = rows.find(isAgentAnswer) ?? null;
  const since = last ? rows.slice(0, rows.indexOf(last)) : rows;
  // The price when a decision was made: its own line's, or the newest before it.
  const priceBefore = (r: ActivityRow) => rows.slice(rows.indexOf(r)).find((x) => typeof x.priceAtTime === "number")?.priceAtTime ?? null;
  const decisions = since
    .map((r) => principalDecision(r, priceBefore(r), currentPrice))
    .filter((d): d is PrincipalDecision => d != null);
  const notes = newestNotes(rows);
  // A note written after the last answer puts the stock on the list once, so a run reads it in full.
  const newNote = notes.find((n) => !last || n.timestamp > last.timestamp);
  return (
    decisions.find((d) => d.wantsAnswer) ??
    (newNote ? { at: newNote.timestamp, line: `Note: ${oneLine(newNote.rationale ?? "")}`, wantsAnswer: true } : null)
  );
}

export const yourWordUnanswered: SituationDefinition<"YOUR_WORD_UNANSWERED"> = {
  code: "YOUR_WORD_UNANSWERED",
  order: 14,
  appliesTo: "both",
  entry: "row",
  guidance: "",
  lists: () => true,
  rule: (stock) => {
    const decision = unansweredDecision(stock.work.activity ?? [], stock.work.latestQuote?.price ?? null);
    return decision ? { active: true, data: { decision } } : { active: false };
  },
};
