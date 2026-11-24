/**
 * thesis-fields.ts — the thesis fields, defined once (step 5 of
 * docs/plans/AGENT_ARCHITECTURE.md, part 3).
 *
 * record_thesis, update_thesis and the writer's submit_thesis take the same
 * fields. Each was defined three times, and the three copies said different
 * things (record_thesis's conviction ran 1,399 characters, update_thesis's
 * 587). Now each field is defined here, once; a tool picks the fields it
 * takes and marks them optional or nullable.
 *
 * A description says what the field is and what the save does with it. How
 * to choose a value is not here: when a value is wrong, the tool's reply says
 * why (thesis-belief.ts for the belief fields, record_thesis and
 * update_thesis for conviction, the trigger ops for a refused trigger edit).
 */
import { z } from "zod";
import { NO_SETUP_FITS, SETUP_IDS } from "@/lib/agent/knowledge/setups";

const citation = z
  .object({
    url: z.string().optional(),
    title: z.string().optional(),
    domain: z.string().optional(),
    kind: z.enum(["STRUCTURED", "WEB"]).optional(),
  })
  .describe("Citation chip (one URL or [STRUCTURED:...] reference).");

const sectionText = z
  .object({ text: z.string(), citations: z.array(citation).optional() })
  .describe("Prose paragraph with optional citations.");

const sectionBullets = z
  .object({ bullets: z.array(z.object({ text: z.string(), citation: citation.optional() })) })
  .describe("Bulleted list, one citation per bullet.");

/** The trigger edits, worded once for update_thesis and the writer's submit_thesis (their shapes come from lib/agent/triggers/schema.ts). */
export const TRIGGER_EDITS = {
  ladder: "The new thesis's triggers: its buy, its floor and anything else it should act on, one trigger each. A watch gets nothing it is not given here.",
  add: "Triggers to add. Where the stock already has one of the same kind (a buy, a floor, an upside line, a review schedule), adding edits that one.",
  edit: "Triggers to edit, by the id shown on the thesis: the number, the action, the fire mode or the wording. A number change needs a rationale.",
  remove: "Triggers to remove, by id.",
} as const;

/** The four verdicts a review ends with. */
export const VERDICTS = ["STRONGER", "UNCHANGED", "WEAKER", "BROKEN"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What we expect of the stock from here. */
export const OUTLOOKS = ["BULLISH", "NEUTRAL", "BEARISH"] as const;
export type Outlook = (typeof OUTLOOKS)[number];

/** How confident we are in the outlook and its reasons, lowest first. */
export const CONVICTIONS = ["LOW", "MEDIUM", "HIGH"] as const;
export type Conviction = (typeof CONVICTIONS)[number];

export function thesisFields() {
  // The four notes went 2026-11-03: nothing read them. A sent note is kept; none is asked for.
  return {
    direction: z
      .enum(["LONG", "SHORT", "PASS"])
      .describe("LONG, SHORT, or PASS: a stock you researched and won't trade. A view you would look again at is LONG or SHORT with no buy and a review, not a PASS."),
    horizon: z
      .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
      .describe(
        "How the trade ends, and how often a holding is reviewed: CATALYST (a dated event; needs catalyst_date; daily), TARGET (a move over weeks to months; weekly), " +
          "TRADE (a short trade, days to weeks; daily), COMPOUNDER (business quality, months to years; monthly). Changing it later leaves the stock's triggers as they are.",
      ),
    setup_id: z.enum(SETUP_IDS).describe("The playbook the triggers are written on. The trigger run confirms a buy by it and results are grouped by it."),
    setup_id_or_none: z
      .enum([...SETUP_IDS, NO_SETUP_FITS])
      .describe(
        "The playbook the triggers are written on. The trigger run confirms a buy by it and results are grouped by it. NONE: no playbook fits; say why in the rationale. " +
          "On a stock we hold, naming a playbook writes its triggers written at the fill, one Activity line each.",
      ),
    catalyst_date: z.string().datetime().describe("When the dated event lands, as the company announced it (ISO timestamp). Required when horizon is CATALYST."),
    catalyst_day: z.string().describe("When the dated event lands, as the company announced it (YYYY-MM-DD). Required when horizon is CATALYST."),
    core_belief: z
      .string()
      .describe(
        "Why the business is worth owning, in two or three plain sentences: what it does well and what has to stay true. " +
          "About the business, never the trade: no stock price, no target, no dates. The opinion holds the price.",
      ),
    company: z
      .string()
      .describe(
        "What the company sells, to whom, and how it makes money, in three or four plain sentences: the revenue mix and the deal or change that last reshaped the business, with its date. " +
          "Send the stored text again unless the business has changed.",
      ),
    kpis: z
      .array(z.string())
      .describe(
        "The KPIs: two to four lines that tell us whether the belief is right. Each is one number the company reports or one named event that would end the case: " +
          "what it is, the reading that says we are on track, the reading that says we are wrong, and when it is read " +
          "(\"Northwind freight bookings: on track at 10%+ a year, broken under 5%. Read at each report.\"). " +
          "Business readings only, never a stock price: the triggers hold the price. Replaces the stored list whole.",
      ),
    outlook: z
      .enum(OUTLOOKS)
      .describe(
        "What you expect of the stock from here: BULLISH, NEUTRAL or BEARISH. It can change with no news about the company: a rally that uses up the upside turns BULLISH into NEUTRAL. Comes with the opinion.",
      ),
    opinion: z
      .string()
      .describe(
        "Your opinion of the stock at today's price, written by \"The opinion\" in How you write: two or three sentences that stand alone, matching the outlook, then the reasoning with its numbers and dates. " +
          "It replaces the stored opinion whole.",
      ),
    conviction: z
      .enum(["HIGH", "MEDIUM", "LOW"])
      .describe(
        "How confident you are in the belief as written, whichever way it points. HIGH: the evidence clearly supports it and nothing against it is unanswered. MEDIUM: reasoned and plausible, but untested, or the evidence is mixed. LOW: thin or contested, a KPI has missed or is in doubt. " +
          "It is not how bullish you are and not whether to buy today: HIGH with a NEUTRAL outlook is a real view. Comes with conviction_rationale.",
      ),
    conviction_rationale: z.string().describe("Why you are this confident, in a few plain sentences: the evidence for the belief. A move in the price or the chart is not evidence; what the price already reflects can be part of the belief."),
    live_price: z
      .number()
      .describe(
        "The live price you read (get_stock_data's quote); the save uses it when its own quote fails. On an edit of a buy's number it decides which side of the price the buy sits on; with neither price that edit is refused.",
      ),
    prior_exit: z
      .string()
      .describe("One line on how this buy differs from this analyst's sale of the stock in the last 14 days. Needed only when the buy is at or above that sale's price."),

    // A review's verdict, and the earlier line a note answers (update_thesis only; a string, so a wrong word comes back by name).
    verdict: z
      .string()
      .describe(
        "What the evidence since the last look did to the belief as written, not to the stock: evidence that backs a bearish belief is STRONGER. STRONGER: it supports the belief more than before. UNCHANGED: nothing bore on it. WEAKER: it goes against the belief, not fatally. " +
          "BROKEN: a KPI broke, or the belief no longer holds. A move in the price alone is UNCHANGED. Any verdict but UNCHANGED comes with verdict_line; BROKEN comes with the rewritten opinion too.",
      ),
    verdict_line: z.string().describe("One sentence: what happened and which KPI it touched, when there is one."),
    answers_update_id: z
      .string()
      .describe("The id of the earlier Activity line this note answers, when it answers one (the pre-report note, after the report): the [id …] at the end of that line."),

    // The writer's research note, saved section by section.
    research_data: z.string().describe("The writer's raw data block, passed through verbatim for the card's data tab."),
    bull_case: sectionBullets.describe("Bull case: three to five cited bullets."),
    bear_case: sectionBullets.describe("Bear case: three to five cited bullets, on a LONG too."),
    // The Writer's own: plain lines, saved as the bullets above.
    bull_points: z
      .array(z.string())
      .describe("The bull case: three to five reasons it could work, each one claim with its number and a citation ([WEB:url] or [STRUCTURED:field]). Replaces the stored bull case whole."),
    bear_points: z
      .array(z.string())
      .describe("The bear case: three to five risks, each one claim with its number, then the sign that would show it is happening, and a citation. Name the rival or the number; \"competition\" or \"volatility\" alone is not a risk. Required on a LONG too. Replaces the stored bear case whole."),
  };
}
