/**
 * The Situations Library (docs/guide/reference/situations-library.md), built
 * from SITUATIONS so the reference can't drift from what agents are sent.
 * guide.test.ts fails when the file is out of date; regenerate it with
 * `UPDATE_GUIDE=1 npx jest lib/docs/guide`.
 */

import { ROW_FIELDS, rowKeysFor } from "@/lib/agent/row-for-model";
import { SITUATIONS, guidanceCodes, guidanceFor, type SituationCode } from "@/lib/agent/situations";

/** Each situation in a sentence for a person. The text an agent reads is SITUATIONS' own. */
const PLAIN: Record<SituationCode, string> = {
  PROMOTED_AWAITING: "A stock just moved from paper to live money and needs a decision this run.",
  PROTECTIVE_SALE: "A sell or trim trigger fired on a holding, or a sale you declined or let expire is still past its line.",
  BUY_ARRIVES: "A buy trigger fired on a watched stock, whether or not the analyst has a free slot.",
  ADD_OR_WINNER: "An add trigger fired on a holding.",
  PROTECTION: "A gain with too little floor under it, or a floor that would lose too much of the account.",
  REVIEW_DUE: "A review trigger fired or the review clock came round: on the price, a report, a filing, or a watch with no view yet.",
  NOTE_TO_ANSWER: "You left a note or made a decision since the analyst's last answer, or a note is pinned on the stock (the Market Reviewer's or yours).",
  SOLD_ONE_REVIEW: "A stock sold in the last two weeks is owed one look back.",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function situationsLibraryMarkdown(): string {
  const codes = Object.keys(SITUATIONS) as SituationCode[];
  const out: string[] = [
    "# Situations library",
    "",
    "**Every situation, and exactly what the agent is sent.** The eight codes in rank order, each with what it means and the text an agent reads.",
    "",
    "This file is built from `SITUATIONS` in `lib/agent/situations.ts`; don't edit it by hand. What situations are and where they come from is [Situations](../concepts/situations.md).",
    "",
    "## How a situation reaches an agent",
    "",
    "- **On the row.** Every stock in the read lists its situations by code, the most urgent first.",
    "- **In `guidance`, once.** The read carries one `guidance` entry per code on the day's list, keyed by code, however many stocks share it. A quiet stock brings none.",
    "- **In a trigger run,** the stock's own codes and their texts come with the fire. Three situations are never sent to a trigger run, and where a text tells a run to change a stock's status, the trigger run reads a line that takes the stock's triggers off by id instead (its save has no status change).",
    "- **The row's fields.** Every stock in a situation sends the row's standing fields (the stock, its situations, the price, the position, a proposal waiting, every trigger with its id, the belief, the newest Activity lines, when the research was written, the chart numbers). A situation adds the fields its decision reads, listed under each one below; the review clock reads the whole case; the history comes only when the stock is asked for by name (`ROW_FIELDS` in `lib/agent/row-for-model.ts`).",
    "",
  ];
  codes.forEach((code, i) => {
    const s = SITUATIONS[code];
    const notTrigger = guidanceCodes("WATCHING", [code], "INTRADAY_TACTICAL").length === 0;
    const triggerText = guidanceFor([code], "INTRADAY_TACTICAL")[code];
    const standing = new Set(Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] === "always"));
    const adds = [...rowKeysFor([code], { size: "short", named: false })].filter((k) => !standing.has(k));
    const facts = [`\`${code}\``, `rank ${i + 1} of ${codes.length}`, adds.length ? `the row adds ${adds.map((k) => `\`${k}\``).join(", ")}` : "the standing fields only", notTrigger ? "not sent to a trigger run" : "sent to every run"];
    out.push(`## ${cap(s.name)}`, "", facts.join(" · "), "", PLAIN[code], "", "```text", s.guidance, "```", "");
    if (!notTrigger && triggerText && triggerText !== s.guidance) {
      out.push("In a trigger run it reads:", "", "```text", triggerText, "```", "");
    }
  });
  return out.join("\n");
}
