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
 * update_thesis for conviction, thesis-shape.ts for a priced plan, the
 * trigger ops for a refused trigger edit).
 *
 * `writer` is the writer's form: its score parts carry no number range in the
 * schema, as the writer's fields never did. The range is in the words, and the
 * writer's decision check refuses a score outside it (thesis-research/
 * decision.ts). The writer's tool is not sent in Anthropic's strict mode, on
 * purpose (run-thesis-writer.ts says why).
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

const SCORING =
  "The setup's score, each part with a one-sentence note citing the evidence: trendStrength 0-3 (0 no trend or breaking down, 3 a clean multi-week uptrend), " +
  "relativeStrength 0-3 (0 a laggard, 3 the sector leader), entryQuality 0-2 (0 extended or no setup, 2 a clean defined setup), " +
  "catalystFreshness 0-2 (0 already played, 2 still ahead). They add up to the composite out of 10; a buy is refused when it is under this analyst's minimum confidence.";

/** The trigger edits, worded once for update_thesis and the writer's submit_thesis (their shapes come from lib/agent/triggers/schema.ts). */
export const TRIGGER_EDITS = {
  ladder: "The trigger ladder for a new thesis. Omit it for the horizon's defaults.",
  add: "Triggers to add. Where the stock already has one of the same kind (a buy, a target, a floor, a review schedule), adding edits that one.",
  edit: "Triggers to edit, by the id shown on the thesis: the number, the action, the fire mode or the wording. A number change needs a rationale.",
  remove: "Triggers to remove, by id.",
} as const;

export function thesisFields(opts: { writer?: boolean } = {}) {
  const score = (max: number) => (opts.writer ? z.number() : z.number().min(0).max(max));
  const part = (max: number) => z.object({ score: score(max), note: z.string() });
  return {
    direction: z
      .enum(["LONG", "SHORT", "PASS"])
      .describe("LONG, SHORT, or PASS: a stock you researched and won't trade. A thesis's direction is set once, when it has none; sending the one it has changes nothing."),
    horizon: z
      .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
      .describe(
        "How the trade ends, and which default triggers a new thesis gets: CATALYST (a dated event; needs catalyst_date), TARGET (a price objective, weeks to months), " +
          "TRADE (a short setup, days to weeks), COMPOUNDER (business quality, months to years). Changing it later leaves the stock's triggers as they are.",
      ),
    setup_id: z.enum(SETUP_IDS).describe("The setup the plan is written on. The trigger run confirms a buy by it and results are grouped by it."),
    setup_id_or_none: z
      .enum([...SETUP_IDS, NO_SETUP_FITS])
      .describe(
        "The setup the plan is written on. The trigger run confirms a buy by it and results are grouped by it. NONE: no setup fits; say why in the rationale. " +
          "On a stock we hold, naming a setup writes that setup's exit triggers, one Activity line each.",
      ),
    entry_price: z
      .number()
      .describe(
        "Where you'd buy: the buy trigger's level. Below the price it is a pullback you wait for, above it a breakout you want confirmed, at or just past it a buy now. " +
          "A plan has entry, target and stop, or none of them.",
      ),
    entry_on_close: z.boolean().describe("true: the buy fires only on a close past entry_price, not an intraday cross."),
    target_price: z.number().describe("Where you'd take profit: the target trigger's level."),
    target_basis: z.string().describe("Why the target is there, with the rule and the numbers (\"prior high $236.54\"). It becomes the target trigger's sentence."),
    stop_loss: z.number().describe("Where the thesis breaks: the floor trigger's level."),
    stop_basis: z
      .string()
      .describe("Why the stop is there, with the chart number it sits under (\"under the base low $207.25, 1.6 ATR from entry\"). It becomes the floor trigger's sentence."),
    catalyst_date: z.string().datetime().describe("When the dated event lands, as the company announced it (ISO timestamp). Required when horizon is CATALYST."),
    catalyst_day: z.string().describe("When the dated event lands, as the company announced it (YYYY-MM-DD). Required when horizon is CATALYST."),
    core_belief: z.string().describe("One sentence: what you believe will happen, by when, and why. The claim that breaks the thesis when it stops being true."),
    key_assumptions: z.array(z.string()).describe("Specific, checkable premises that must stay true for the core belief: two or more on LONG or SHORT."),
    invalidation_conditions: z
      .array(z.string())
      .describe("Specific things that would prove the thesis wrong: two or more on LONG or SHORT. Exits are graded against them; on a PASS they are what would change your mind."),
    scoring: z
      .object({ trendStrength: part(3), relativeStrength: part(3), entryQuality: part(2), catalystFreshness: part(2) })
      .describe(SCORING),
    scoring_patch: z
      .object({ trendStrength: part(3).optional(), relativeStrength: part(3).optional(), entryQuality: part(2).optional(), catalystFreshness: part(2).optional() })
      .describe(`${SCORING} Send all four to replace the score, or some to change only those.`),
    conviction: z
      .enum(["STRONG", "HIGH", "MEDIUM", "LOW"])
      .describe(
        "Your own view, apart from the score: STRONG a top call to buy in size now, HIGH a clear edge you want in size, MEDIUM probably works, LOW tracking without enthusiasm. Comes with conviction_rationale.",
      ),
    conviction_rationale: z.string().describe("The judgment behind the conviction in a few plain sentences, not the scores restated."),
    variant_view: z
      .string()
      .describe("Where you differ from consensus: 'consensus expects X, I think Y, because Z'. A STRONG or HIGH call without one is stored as MEDIUM."),
    live_price: z
      .number()
      .describe(
        "The live price you read (get_stock_data's quote). It decides which side of the price a buy level sits on when the server's own quote fails; with neither, a change that sets a buy level is refused.",
      ),
    prior_exit: z
      .string()
      .describe("One line on how this plan differs from this analyst's sale of the stock in the last 14 days. Needed only when the buy is at or above that sale's price."),

    // The writer's research note, saved section by section.
    research_data: z.string().describe("The writer's raw data block, passed through verbatim for the card's data tab."),
    snapshot: sectionText.describe("Snapshot: the current state in one cited paragraph."),
    recent_catalysts: sectionText.describe("Recent catalysts: the last one to two weeks in one cited paragraph."),
    fundamentals: sectionText.describe("Fundamentals: one cited paragraph, with the segment breakdown when there is one."),
    latest_earnings: sectionBullets.describe("Latest earnings: five specific, cited bullets."),
    catalysts_and_events: sectionBullets.describe("Catalysts and events: three to five dated, cited bullets."),
    bull_case: sectionBullets.describe("Bull case: three to five cited bullets."),
    bear_case: sectionBullets.describe("Bear case: three to five cited bullets, on a LONG too."),
    analyst_consensus: sectionText.describe("Analyst consensus: one cited paragraph, firm by firm."),
    insider_technical: sectionText.describe("Insider and technical: one cited paragraph."),
  };
}
