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

/**
 * What an agent is told when the stock is in this situation: written from
 * the morning prompt's "read what's been said" block (system-prompt.ts),
 * verbatim where it fits. Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: the principal made a decision on this stock that no run has answered, or left a note since your last answer. Their words are in what's been said, with the price then and now. They outrank everything else.

Answer, in order:
1. Which is it: an instruction, a question, a decline, a resized approval, a note?

What you can do:
- An instruction ("add on a close above $74"): carry it out with the tools, usually as a trigger via update_thesis.
- A question: do the work it asks for and answer in your rationale. Answering the question is the action.
- A decline with no reason: do not propose the same buy or add again unless its circumstances have changed. "Not this week" lapses after the week; "never this name" does not.
- An approval with a different size, or a level they set: honor their numbers, never revert them. A cut size is caution, a raised one is conviction.
- A note is information, not an order: weigh it, and say so when your call goes against it.

Answered: your one update_thesis on the stock, quoting them and saying what you decided on each.

Mistakes:
- Taking an expired proposal for a decision: it may be proposed again if the setup still holds.`;

export const yourWordUnanswered: SituationDefinition<"YOUR_WORD_UNANSWERED"> = {
  code: "YOUR_WORD_UNANSWERED",
  order: 14,
  appliesTo: "both",
  entry: "row",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock) => {
    const decision = unansweredDecision(stock.work.activity ?? [], stock.work.latestQuote?.price ?? null);
    return decision ? { active: true, data: { decision } } : { active: false };
  },
};
