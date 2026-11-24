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

/** What raises each situation: a trigger of yours, or a check in the code. One list for both docs pages. */
export const RAISED_BY: Record<SituationCode, { by: "trigger" | "code"; what: string }> = {
  PROTECTIVE_SALE: { by: "trigger", what: "A Sell or Trim trigger fired on a holding. A sale you declined or let lapse keeps it while the price is still past the trigger." },
  BUY_ARRIVES: { by: "trigger", what: "A Buy trigger fired on a watch, or is true when the morning run reads the stock." },
  ADD_OR_WINNER: { by: "trigger", what: "An Add trigger fired on a holding." },
  REPORT: { by: "trigger", what: "A trigger that watches the company's earnings report fired, before the report or after it." },
  FILING: { by: "trigger", what: "A trigger that watches the company's SEC filings fired." },
  NEWS: { by: "trigger", what: "A trigger that watches the Market Reviewer's notes fired: it wrote a high note on the stock." },
  REVIEW_DUE: { by: "trigger", what: "A “Review every N days” trigger came due, or a Review trigger on a price or a move fired." },
  PROTECTION: { by: "code", what: "A holding's floor (its “Sell if below” trigger) locks in much less than its gain, or a sale there would lose more than 1.5% of the account." },
  SOLD_ONE_REVIEW: { by: "code", what: "The stock was sold in the last two weeks and no run has looked at it since." },
  PROMOTED_AWAITING: { by: "code", what: "A paper analyst was promoted to live money, and its holdings need a decision." },
};

const BY = { trigger: "A trigger", code: "A check in the code" } as const;

/** The one table of situations: each one, and what raises it. Triggers first. */
export function situationsTableMarkdown(): string[] {
  const codes = (Object.keys(RAISED_BY) as SituationCode[]);
  return ["| Situation | Raised by | When |", "|---|---|---|", ...codes.map((c) => `| **${cap(SITUATIONS[c].name)}** | ${BY[RAISED_BY[c].by]} | ${RAISED_BY[c].what} |`)];
}

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
    "1. A situation is raised by one of your triggers firing, or by one of three checks in the code. Nothing else raises one, and nothing is stored: it is worked out each time the stock is read (`situationsFor`).",
    "2. The stock shows one tag, the same on its line of the stock table, on its page and on the row an agent reads: the decision on the table, then why. A trigger's action is the decision and its condition is the why (\"Possible sell · below $804\", \"Review · every 30 days\"). A check in the code shows its name and its fact (\"Floor to fix · 2.1% of the account below here\"). An agent's row puts the situation's code in front.",
    "3. The situation does one thing: it picks the text below. The text goes to the run that answers. The morning run's list carries one `guidance` entry per situation on the day's list, however many stocks share it. A trigger run gets its stock's texts with the fire. No other read carries a text; the chat reads one from the knowledge library when it is asked to act.",
    "4. A text can have a part for a stock we hold and a part for a stock we watch. A run is sent the part that fits its stock, whole and as written. No code writes or changes a word of it.",
    "",
    "## The situations, and what raises each",
    "",
    ...situationsTableMarkdown(),
    "",
    "## What every stock in a situation carries",
    "",
    "The same row, whatever the situation and whoever reads it. A stock an agent opens by its ticker gets the same row. To stop sending a field, delete its line in `ROW_FIELDS`.",
    "",
    "**On every row:**",
    "",
    "| Field | What it is |",
    "|---|---|",
    ...ROW_FIELDS.filter((f) => f.when === "always").map((f) => `| \`${f.key}\` | ${f.what} |`),
    "",
    "**Only on a stock it applies to:**",
    "",
    "| Field | What it is | Sent when |",
    "|---|---|---|",
    ...ROW_FIELDS.filter((f) => f.when !== "always" && !f.ask).map((f) => `| \`${f.key}\` | ${f.what} | ${f.when} |`),
    "",
    "**Only when the agent asks for it:**",
    "",
    "| Field | What it is |",
    "|---|---|",
    ...ROW_FIELDS.filter((f) => f.ask).map((f) => `| \`${f.key}\` | ${f.what} |`),
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
      `**Raised by:** ${BY[RAISED_BY[code].by].toLowerCase()}. ${RAISED_BY[code].what}`,
      "",
      "**How it reads, in each place it shows:**",
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
