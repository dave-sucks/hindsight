/**
 * The Situations Library (docs/guide/reference/situations-library.md), built
 * from SITUATIONS and the skill files so the reference can't drift from what
 * agents are sent.
 * guide.test.ts fails when the file is out of date; regenerate it with
 * `UPDATE_GUIDE=1 npx jest lib/docs/guide`.
 */

import { ROW_FIELDS, rowKeysFor } from "@/lib/agent/row-for-model";
import { SITUATIONS, guidanceCodes, type SituationCode } from "@/lib/agent/situations";
import { situationText } from "@/lib/agent/situation-skills";

/** Each situation in a sentence for a person. The text an agent reads is its skill file's own. */
const PLAIN: Record<SituationCode, string> = {
  PROMOTED_AWAITING: "A stock just moved from paper to live money and needs a decision this run.",
  PROTECTIVE_SALE: "A sell or trim trigger fired on a holding, or a sale you declined or let expire is still past its line.",
  BUY_ARRIVES: "A buy trigger fired on a watched stock.",
  ADD_OR_WINNER: "An add trigger fired on a holding.",
  REPORT: "A trigger on the company's earnings report fired: the report is coming, or it just landed.",
  FILING: "A trigger on the company's SEC filings fired.",
  NEWS: "Something happened to the company, or the stock had a day far outside its normal. Nothing puts a stock here yet.",
  PROTECTION: "A gain with too little floor under it, or a floor that would lose too much of the account.",
  REVIEW_DUE: "The review clock came round, or the price reached a level the analyst asked to look at again.",
  SOLD_ONE_REVIEW: "A stock sold in the last two weeks is owed one look back.",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function situationsLibraryMarkdown(): string {
  const codes = Object.keys(SITUATIONS) as SituationCode[];
  const out: string[] = [
    "# Situations library",
    "",
    `**Every situation, and exactly what the agent is sent.** The ${codes.length} codes in rank order, each with what it means and the text an agent reads.`,
    "",
    "This file is built from `SITUATIONS` in `lib/agent/situations.ts` and the skill files in `lib/agent/engine/skills/`; don't edit it by hand. What situations are and where they come from is [Situations](../concepts/situations.md).",
    "",
    "## How a situation reaches an agent",
    "",
    "- **On the row.** Every stock in a read lists its situations by code and name, the most urgent first. Every reader gets that: the chat, the Portfolio Manager, a read of one stock by ticker.",
    "- **The text goes to the run that answers.** The morning run's own list carries one `guidance` entry per code on the day's list, however many stocks share it. A trigger run gets its stock's texts with the fire. No other read carries a text; the chat reads one from the knowledge library when it is asked to act.",
    "- **A skill has a part for a stock we hold and a part for a stock we watch.** A run is sent the part that fits its stock, whole and as written; a list with both kinds gets both. No code writes or changes a word of a skill.",
    "- **A just-sold stock** is never a trigger run's, so that skill goes only to the morning run.",
    "- **The row's fields.** Every stock in a situation sends the row's standing fields (the stock, its situations, the price, the position, a proposal waiting, every trigger with its id, the belief, the newest Activity lines, when the research was written, the chart numbers). A situation adds the fields its decision reads, listed under each one below; the review reads the whole case; the history comes only when the stock is asked for by name (`ROW_FIELDS` in `lib/agent/row-for-model.ts`).",
    "",
  ];
  codes.forEach((code, i) => {
    const s = SITUATIONS[code];
    const notTrigger = guidanceCodes("WATCHING", [code], "INTRADAY_TACTICAL").length === 0;
    const standing = new Set(Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] === "always"));
    const adds = [...rowKeysFor([code], { size: "short", named: false })].filter((k) => !standing.has(k));
    const facts = [`\`${code}\``, `rank ${i + 1} of ${codes.length}`, s.skill ? `\`${s.skill}\`` : "its text is in the table", adds.length ? `the row adds ${adds.map((k) => `\`${k}\``).join(", ")}` : "the standing fields only", notTrigger ? "not sent to a trigger run" : "sent to the run that answers"];
    out.push(`## ${cap(s.name)}`, "", facts.join(" · "), "", PLAIN[code], "", "```text", situationText(code, null), "```", "");
  });
  return out.join("\n");
}
