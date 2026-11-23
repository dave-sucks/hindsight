/**
 * The Situations Library (docs/guide/reference/situations-library.md), built
 * from SITUATIONS, the skill files and the row's field table (ROW_FIELDS) so
 * the reference can't drift from what agents are sent.
 * guide.test.ts fails when the file is out of date; regenerate it with
 * `UPDATE_GUIDE=1 npx jest lib/docs/guide`.
 */

import { ROW_FIELDS } from "@/lib/agent/row-for-model";
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

/** A text has a part for a stock we hold and one for a stock we watch when the two reads differ. */
const parts = (code: SituationCode) => (situationText(code, true) === situationText(code, false) ? "one text for every stock" : "a part for a stock we hold, a part for a stock we watch");

export function situationsLibraryMarkdown(): string {
  const codes = Object.keys(SITUATIONS) as SituationCode[];
  const out: string[] = [
    "# Situations library",
    "",
    `**Every situation, and exactly what the agent is sent.** The ${codes.length} codes in rank order, each with when it is true, where its text goes and the text itself. Then, once, what every stock in a situation carries.`,
    "",
    "This file is built from `SITUATIONS` in `lib/agent/situations.ts`, the skill files in `lib/agent/engine/skills/` and `ROW_FIELDS` in `lib/agent/row-for-model.ts`; don't edit it by hand. What situations are and where they come from is [Situations](../concepts/situations.md).",
    "",
    "## How a situation works",
    "",
    "1. A trigger fires or a clock comes due. Code works out the stock's situations from that (`situationsFor`); nothing is stored.",
    "2. The stock shows its situations by name on its line of the stock table and on its row, the most urgent first. Every reader gets that.",
    "3. The situation does one thing: it picks the text below. The text goes to the run that answers. The morning run's list carries one `guidance` entry per situation on the day's list, however many stocks share it. A trigger run gets its stock's texts with the fire. No other read carries a text; the chat reads one from the knowledge library when it is asked to act.",
    "4. A text can have a part for a stock we hold and a part for a stock we watch. A run is sent the part that fits its stock, whole and as written. No code writes or changes a word of it.",
    "",
    "## What every stock in a situation carries",
    "",
    "The same row, whatever the situation and whoever reads it. A stock an agent opens by its ticker gets the same row. A field is included always, or when the stock has it, or when the read asks for it. A field with nothing to say is left off. To stop sending a field, delete its line in `ROW_FIELDS`.",
    "",
    "| Field | What it is | When it is included |",
    "|---|---|---|",
    ...ROW_FIELDS.map((f) => `| \`${f.key}\` | ${f.what} | ${f.when} |`),
    "",
  ];
  codes.forEach((code, i) => {
    const s = SITUATIONS[code];
    const notTrigger = guidanceCodes("WATCHING", [code], "INTRADAY_TACTICAL").length === 0;
    out.push(
      `## ${cap(s.name)}`,
      "",
      [`\`${code}\``, `rank ${i + 1} of ${codes.length}`, s.skill ? `\`${s.skill}\`` : "its text is in `SITUATIONS`"].join(" · "),
      "",
      `**True when:** ${PLAIN[code]}`,
      "",
      "**How it is named, in each place it shows:**",
      "",
      `<!-- asset: situation-named ${code} -->`,
      "",
      `**Its text goes to:** ${notTrigger ? "the morning run's list only" : "the morning run's list, or the trigger run with the fire"}; ${s.skill ? parts(code) : "one text for every stock"}.`,
      "",
      "```text",
      situationText(code, null),
      "```",
      "",
    );
  });
  return out.join("\n");
}
