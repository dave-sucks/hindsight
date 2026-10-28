/**
 * The Situations Library (docs/guide/reference/situations-library.md), built
 * from SITUATIONS so the reference can't drift from what agents are sent.
 * guide.test.ts fails when the file is out of date; regenerate it with
 * `UPDATE_GUIDE=1 npx jest lib/docs/guide`.
 */

import { FULL_ROW_SITUATIONS } from "@/lib/agent/row-for-model";
import { SITUATIONS, guidanceCodes, guidanceFor, type SituationCode } from "@/lib/agent/situations";

/** Each situation in a sentence for a person. The text an agent reads is SITUATIONS' own. */
const PLAIN: Record<SituationCode, string> = {
  AUTO_TRADE: "A trigger set to Auto just made a trade, and the analyst writes it up: what's going on with the company, and whether it agrees.",
  PROMOTED_AWAITING: "A stock just moved from paper to live money and needs a decision this run.",
  PROTECTIVE_SALE: "A floor, a trail or a trim fired on a holding, or a sale you declined or let expire is still past its line.",
  BUY_ARRIVES: "A watched stock reached its buy level.",
  BUY_BLOCKED_FULL: "A buy fired while the analyst already holds all it may.",
  ADD_OR_WINNER: "An add level fired, or a holding is three quarters of the way to its target.",
  EARNINGS: "A report is close, or just landed with a beat or a miss.",
  FILING: "The company filed something that matters with the SEC.",
  QUIET_WATCH_WOKE: "A watch with no plan hit one of its wakes and needs a fresh look.",
  PROTECTION: "A gain with too little floor under it, or a floor that would lose too much of the account.",
  FIRST_RESEARCH: "A stock on the watchlist with no view yet is due its first research.",
  REVIEW_DUE: "The review clock came round, or a review fired, and nothing else covers it.",
  STALE_RESEARCH: "The research is older than the analyst's limit.",
  PLAN_PROBLEM: "The plan contradicts the price or the calendar: a buy level left behind, a target passed, a floor too tight.",
  YOUR_WORD_UNANSWERED: "You left a note or made a decision since the analyst's last answer.",
  SOLD_ONE_REVIEW: "A stock sold in the last two weeks is owed one look back.",
  NO_SETUP_NAMED: "A researched stock has no setup named, so nothing says how to trade it.",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function situationsLibraryMarkdown(): string {
  const codes = Object.keys(SITUATIONS) as SituationCode[];
  const out: string[] = [
    "# Situations library",
    "",
    "**Every situation, and exactly what the agent is sent.** The seventeen codes in rank order, each with what it means and the text an agent reads.",
    "",
    "This file is built from `SITUATIONS` in `lib/agent/situations.ts`; don't edit it by hand. What situations are and where they come from is [Situations](../concepts/situations.md).",
    "",
    "## How a situation reaches an agent",
    "",
    "- **On the row.** Every stock in the read lists its situations by code, the most urgent first.",
    "- **In `guidance`, once.** The read carries one `guidance` entry per code on the day's list, keyed by code, however many stocks share it. A quiet stock brings none.",
    "- **In a trigger run,** the stock's own codes and their texts come with the fire. Three situations are never sent to a trigger run, and where a text tells a run to change a stock's status, the trigger run reads a line that takes the plan down instead (its save has no status change).",
    "- **The full row.** Two situations send the stock's full row, research and all, because the decision needs it: watch woke up, and no setup named.",
    "",
  ];
  codes.forEach((code, i) => {
    const s = SITUATIONS[code];
    const notTrigger = guidanceCodes("WATCHING", [code], "INTRADAY_TACTICAL").length === 0;
    const triggerText = guidanceFor([code], "INTRADAY_TACTICAL")[code];
    const facts = [`\`${code}\``, `rank ${i + 1} of ${codes.length}`, FULL_ROW_SITUATIONS.has(code) ? "full row" : "short row", notTrigger ? "not sent to a trigger run" : "sent to every run"];
    out.push(`## ${cap(s.name)}`, "", facts.join(" · "), "", PLAIN[code], "", "```text", s.guidance, "```", "");
    if (!notTrigger && triggerText && triggerText !== s.guidance) {
      out.push("In a trigger run it reads:", "", "```text", triggerText, "```", "");
    }
  });
  return out.join("\n");
}
