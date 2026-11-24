/**
 * decision.ts — the compact `submit_thesis` decision contract for the V2
 * thesis-writer (THESIS_WRITER_V2).
 *
 * The research model researches the stock and finishes by calling
 * submit_thesis with THIS object: every thesis field (the company, the
 * belief, the opinion, the KPIs, the bull and bear cases) and the playbook
 * it names, no trigger. The save writes the playbook's watch triggers,
 * priced from the chart, and the writer tailors them with edit_triggers
 * after it. Nothing is parsed out of prose: a field the model leaves out is
 * refused by name, never dropped unseen.
 * validateThesisDecision() returns itemized errors the model repairs in its
 * next step.
 * That repair loop replaces the V1 failure mode where a 25k-char
 * record_thesis payload bounced off Zod and cost ~3 minutes of full
 * regeneration per bounce.
 *
 * Field names mirror record_thesis / update_thesis args 1:1 so the persist
 * phase can splat them through without a mapping layer.
 */

import { z } from "zod";
import { zodSchema, type Schema } from "ai";
import { thesisFields } from "@/lib/agent/tools/thesis-fields";

/** The fields the writer shares with record_thesis and update_thesis, defined once. */
const W = thesisFields();

/**
 * The submit_thesis tool's input schema. The tool is not sent in Anthropic's
 * strict mode, on purpose (makeSubmitThesisTool in run-thesis-writer.ts says
 * why), so this schema guides the model and does not bind it. It carries no
 * string-length or number-range limits; those are in the words here and in
 * validateThesisDecision below, which hands a refused field back with the
 * reason.
 */
export const thesisDecisionSchema = z.object({
  direction: W.direction,
  rationale: z
    .string()
    .describe("This run's note on the stock's Activity, by How you write: what you found about the company and what you decided. The opinion holds the full view, so the note stays short."),
  company: W.company.optional(),
  horizon: W.horizon,
  setup_id: W.setup_id.optional(),
  catalyst_date: W.catalyst_day.optional(),
  core_belief: W.core_belief.optional(),
  outlook: W.outlook.optional(),
  opinion: W.opinion.optional(),
  kpis: W.kpis.optional(),
  bull_case: W.bull_points.optional(),
  bear_case: W.bear_points.optional(),
  conviction: W.conviction.optional(),
  conviction_rationale: W.conviction_rationale.optional(),
  prior_exit_acknowledgment: W.prior_exit.optional(),
  look_again: z
    .object({
      after_next_report: z.boolean().optional().describe("Look again the day after the stock's next report."),
      after_event: z.boolean().optional().describe("Look again the day after the stock's event date: give that date in catalyst_date."),
      why: z.string().describe("What you'd look for then, in a sentence."),
    })
    .optional()
    .describe(
      "Keep a view with no buy yet and say when to look again, instead of a pass. A look-again is tied to the next report or to the stock's event date; for a plain date with no event, add a review clock with edit_triggers after the save.",
    ),
});

/** The Holding refresh's: a held stock's playbook was set when it was bought, so its save names none. */
export const heldDecisionSchema = thesisDecisionSchema.omit({ setup_id: true });

/** The decision as the model wrote it. */
export type ThesisDecisionInput = z.input<typeof thesisDecisionSchema>;

/** submit_thesis's input: the decision schema, the held stock's for the Holding refresh. The SDK parses the call with it, dropping a field it doesn't have. */
export function submitThesisInput(held = false): Schema<ThesisDecisionInput> {
  return zodSchema(held ? heldDecisionSchema : thesisDecisionSchema) as unknown as Schema<ThesisDecisionInput>;
}

/**
 * The review a look-again writes, as watch_stock writes one: the day after the
 * next report, or the day after the stock's event date (its catalystDate, so it
 * follows a re-dated event). Each fires once and has a slot of its own: a
 * review clock counts from the last review and slides with every note.
 * Null with no look-again.
 */
export function lookAgainTrigger(look: ThesisDecisionInput["look_again"]): Record<string, unknown> | null {
  if (!look) return null;
  const predicate = look.after_next_report ? LOOK_AFTER_REPORT : LOOK_AFTER_EVENT;
  return { action: "REVIEW", predicate, rationale: look.why.trim() };
}

/** "Review if within 1 day after earnings". */
export const LOOK_AFTER_REPORT = { watch: "report", is: "after", value: 1 } as const;
/** "Review 1 day after the event date". */
export const LOOK_AFTER_EVENT = { watch: "from_date", is: "after", value: 1, variable: "event" } as const;

/** A decision that passed validation. */
export interface ValidatedThesisDecision extends ThesisDecisionInput {
  /** What the save will go without, and why: each goes on the stock as a "Not applied" line. */
  dropped?: DroppedItem[];
  /**
   * What the app fixed on the way in, in words — a conviction stored one
   * tier down, a trigger it couldn't read. Appended to the saved rationale
   * so the fix is visible on the stock, never silent (DAV-316).
   */
  notes?: string[];
}

export interface DecisionValidationOpts {
  /** mint = record_thesis; refresh = update_thesis. */
  mode: "mint" | "refresh";
  /** Status of the existing thesis on refresh (null on mint). */
  existingStatus?: string | null;
  /** Live price from the pull phase, when available. */
  currentPrice?: number | null;
}

export interface DecisionValidationResult {
  ok: boolean;
  errors: string[];
  decision?: ValidatedThesisDecision;
}

/**
 * The writer's own rules for a submit_thesis call: what a decision must say
 * (belief, conviction).
 * The save's rules are NOT copied here — the submit step runs record_thesis /
 * update_thesis itself in check-only mode right after this
 * (checkDecisionAgainstSave in run-thesis-writer.ts). A copy drifted twice:
 * PRAX 09-11, FIVE and DOCU 09-15.
 */
export function validateThesisDecision(
  input: ThesisDecisionInput,
  opts: DecisionValidationOpts,
): DecisionValidationResult {
  const errors: string[] = [];
  const notes: string[] = [];
  // A shallow copy: the fixes below (a conviction stored one tier down)
  // land on the decision that is saved, not on the model's argument object.
  const d: ThesisDecisionInput = { ...input };
  const directional = d.direction === "LONG" || d.direction === "SHORT";

  if (!d.rationale || d.rationale.trim().length < 20) {
    errors.push("rationale: required, ≥20 chars — state the decision in your own voice.");
  }

  // ── Horizon conditionals ────────────────────────────────────────────
  if (d.horizon === "CATALYST" && !d.catalyst_date) {
    errors.push("catalyst_date: required when horizon=CATALYST. If you don't know the date, this isn't a CATALYST thesis — use TRADE or TARGET.");
  }
  if (d.catalyst_date && Number.isNaN(Date.parse(d.catalyst_date))) {
    errors.push(`catalyst_date: "${d.catalyst_date}" is not a parseable date — use ISO YYYY-MM-DD.`);
  }
  // max_hold_days is gone (DAV-195 L8). "This has been open long enough"
  // is the review cadence on the ladder, minted per horizon —
  // visible and editable, unlike a column that fed a template once at mint
  // and then drifted from it.

  // The setup is whatever the decision names: no check reads it. A buy may be
  // saved with no setup, and a setup off the seat's list is accepted as named.
  // A buy's chase cap is in the trigger itself ("… and below $C"), and the
  // setup's sale rules are read on the sale the buy names (place_trade's
  // saleRuleProblem), never on a watch's Stop watching line.

  // A look-again keeps a view: one of its two, with why, on a LONG or SHORT.
  const look = d.look_again;
  if (look) {
    if (!look.after_next_report === !look.after_event) errors.push("look_again: give one of after_next_report or after_event, with why.");
    else if (look.after_event && !d.catalyst_date) errors.push("look_again.after_event: give the event's date in catalyst_date; for a plain date with no event, add a review clock with edit_triggers after the save.");
    if (!look.why?.trim()) errors.push("look_again.why: say what you'd look for then, in a sentence.");
    if (d.direction === "PASS") errors.push("look_again: a PASS takes none. A view you would look again at is LONG or SHORT with no buy and this look-again; or pass with none.");
  }

  if (directional) {
    // ── Belief fields ─────────────────────────────────────────────────
    // Every field of the thesis comes with every save on a view: nothing is kept from an older save unless it is sent again.
    if (!d.company || d.company.trim().length < 20) {
      errors.push("company: required for LONG/SHORT, at least 20 characters. What the company sells, to whom and how it makes money, in three or four sentences; send the stored text again if the business has not changed.");
    }
    if (!d.core_belief || d.core_belief.trim().length < 10) {
      errors.push("core_belief: required for LONG/SHORT. Why the business is worth owning, in two or three plain sentences: never a stock price, a target or a date.");
    }
    if (!d.kpis || d.kpis.filter((a) => a.trim().length > 0).length < 2) {
      errors.push("kpis: at least two lines required for LONG/SHORT (two to four is the aim). Each is a number the company reports or a named event, with the reading that says we are on track, the reading that says we are wrong, and when it is read.");
    }
    if (!d.bull_case || d.bull_case.filter((b) => b.trim().length > 0).length < 2) {
      errors.push("bull_case: at least two lines required for LONG/SHORT (three to five is the aim).");
    }
    if (!d.bear_case || d.bear_case.filter((b) => b.trim().length > 0).length < 2) {
      errors.push("bear_case: at least two lines required for LONG/SHORT, on a LONG too (three to five is the aim).");
    }

    // ── Conviction Expression v4 ──────────────────────────────────────
    if (!d.conviction) {
      errors.push("conviction: required for LONG/SHORT — HIGH, MEDIUM or LOW: how confident you are in the outlook and its reasons.");
    }
    if (!d.conviction_rationale || d.conviction_rationale.trim().length === 0) {
      errors.push("conviction_rationale: required — the judgment in plain speech, not a paraphrase of the bull case.");
    }
    // What it expects of the stock is the Writer's main judgment: never left out, never guessed from the direction.
    if (!d.outlook) {
      errors.push("outlook: required for LONG/SHORT — BULLISH, NEUTRAL or BEARISH: what you expect of the stock from here.");
    }
    if (!d.opinion || d.opinion.trim().length === 0) {
      errors.push("opinion: required. Your full view of the stock at today's price: two or three sentences that stand alone, then the reasoning with its numbers.");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    decision: { ...d, notes: notes.length ? notes : undefined },
  };
}

/** What a save went without, and why: written on the stock as a "Not applied" line (`fieldChanges.notApplied`, as update_thesis writes). */
export interface DroppedItem {
  field: string;
  why: string;
  reason: string;
}

/** A playbook watch trigger the save didn't write, and why (its key had no number on the chart). */
export function notWrittenTrigger(ref: string, sentence: string, why: string): DroppedItem {
  return { field: "triggers", why: `the playbook's ${ref}, ${sentence}`, reason: why };
}

