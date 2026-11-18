/**
 * decision.ts — the compact `submit_thesis` decision contract for the V2
 * thesis-writer (THESIS_WRITER_V2).
 *
 * The research model writes the 9-section note as plain text (parsed
 * server-side by parse-sections.ts) and finishes by calling submit_thesis
 * with THIS object — decision fields only, ~1-2k chars. Everything beyond
 * direction/horizon is optional; a trigger the schema can't read is handed
 * back by the SDK with the schema's sentence. validateThesisDecision() does
 * the rest and returns itemized errors the model repairs in its next step.
 * That repair loop replaces the V1 failure mode where a 25k-char
 * record_thesis payload bounced off Zod and cost ~3 minutes of full
 * regeneration per bounce.
 *
 * Field names mirror record_thesis / update_thesis args 1:1 so the persist
 * phase can splat them through without a mapping layer.
 */

import { z } from "zod";
import { jsonSchema, zodSchema, type Schema } from "ai";
import { editNumber, editTriggerOpSchema, triggerInputSchema } from "@/lib/agent/triggers/schema";
import { shapeOf } from "@/lib/agent/triggers/condition";
import { TRIGGER_EDITS, thesisFields } from "@/lib/agent/tools/thesis-fields";

/** The fields the writer shares with record_thesis and update_thesis, defined once, in the writer's form: no number ranges on the score parts, as before (validateThesisDecision refuses a score out of range). */
const W = thesisFields({ writer: true });

/**
 * The submit_thesis tool's input schema. The tool is not sent in Anthropic's
 * strict mode, on purpose (makeSubmitThesisTool in run-thesis-writer.ts says
 * why), so this schema guides the model and does not bind it. It carries no
 * string-length or number-range limits; those are in the words here and in
 * validateThesisDecision below, which hands a refused field back with the
 * reason.
 */
/**
 * The trigger a writer sends, defined once: \`triggers\` (a mint) and
 * \`add_triggers\` (a refresh) both point at it, so the tool definition carries
 * the condition and its measures guide one time.
 */
const writerTrigger = triggerInputSchema.meta({ id: "Trigger" });

export const thesisDecisionSchema = z.object({
  direction: W.direction,
  rationale: z
    .string()
    .describe("Your decision, by How you write: what the company is doing and where the stock is and why, then your call. On a refresh it is the note at the top of the stock's page."),
  horizon: W.horizon,
  setup_id: W.setup_id.optional(),
  catalyst_date: W.catalyst_day.optional(),
  core_belief: W.core_belief.optional(),
  key_assumptions: W.key_assumptions.optional(),
  invalidation_conditions: W.invalidation_conditions.optional(),
  conviction: W.conviction.optional(),
  conviction_rationale: W.conviction_rationale.optional(),
  variant_view: W.variant_view.optional(),
  prior_exit_acknowledgment: W.prior_exit.optional(),
  // A mint sends `triggers`; a refresh edits one at a time (DAV-242). Sending
  // the wrong one is refused with the right one named (validateThesisDecision).
  triggers: z.array(writerTrigger).optional().describe(TRIGGER_EDITS.ladder),
  add_triggers: z.array(writerTrigger).optional().describe(TRIGGER_EDITS.add),
  edit_triggers: z.array(editTriggerOpSchema).optional().describe(TRIGGER_EDITS.edit),
  remove_trigger_ids: z.array(z.string()).optional().describe(TRIGGER_EDITS.remove),
});

/** A watch's view saved with nothing on it can never come back: what the Writer is told. */
export const nothingOnIt = (direction: string) =>
  `setup_id: nothing on this ${direction} can bring it back, so add the playbook that fits (setup_id) or a price or day to look again (look_again_price or look_again_date, with look_again_why).`;

/** The decision as the model wrote it: each trigger in the condition shape the save reads, not yet the stored one. */
export type ThesisDecisionInput = z.input<typeof thesisDecisionSchema>;

/**
 * The Writer's submit_thesis: the thesis and the playbook, and no trigger.
 * The save writes the playbook's watch triggers from the stock's chart and
 * the Writer's own review from look_again_* (./writer-triggers.ts). The Holding
 * refresh keeps thesisDecisionSchema: it edits a holding's triggers by id.
 */
export const writerDecisionSchema = z.object({
  direction: W.direction.describe("LONG or SHORT for a view, or PASS: you researched it and won't trade it."),
  rationale: z.string().describe("Your decision, by How you write: what the company is doing, where the stock is and why, then your call."),
  horizon: W.horizon.describe("How the trade ends: CATALYST (a dated event), TARGET (a move over weeks to months), TRADE (days to weeks) or COMPOUNDER (months to years)."),
  setup_id: W.setup_id.optional().describe("The playbook that fits this stock, from your playbooks: the save writes its watch triggers at prices from this stock's chart; leave it out when none fits."),
  catalyst_date: W.catalyst_day.optional().describe("The day of the dated event as the company announced it (YYYY-MM-DD), needed when horizon is CATALYST."),
  core_belief: W.core_belief.optional().describe("Why we own the company, in two or three plain sentences about the business, never the stock's price, a target or a date."),
  key_assumptions: W.key_assumptions.optional().describe("Two or more checkable premises the belief needs, each ending with when and where it is checked (\"…, at the Q3 report on December 4\")."),
  invalidation_conditions: W.invalidation_conditions.optional().describe("Two or more things you could see in the business that would prove the thesis wrong, each with where it is read, never a stock price."),
  conviction: W.conviction.optional().describe("Your own view: STRONG a top call to buy in size now, HIGH a clear edge, MEDIUM probably works, LOW tracking without enthusiasm."),
  conviction_rationale: W.conviction_rationale.optional().describe("Why you feel this strongly about the company and the stock, in a few plain sentences."),
  variant_view: W.variant_view.optional().describe("Where you differ from Wall Street, as 'analysts expect X, I think Y, because Z'; a STRONG or HIGH call without one is saved as MEDIUM."),
  prior_exit_acknowledgment: W.prior_exit.optional().describe("One line on how this buy differs from our sale of this stock in the last 14 days, needed only when the buy is at or above that sale's price."),
  look_again_price: z.number().optional().describe("Your own extra review, if you want one: look at this stock again when it reaches this price."),
  look_again_date: z.string().optional().describe("Your own extra review, if you want one: look at this stock again on this day (YYYY-MM-DD), and every as many days after."),
  look_again_why: z.string().optional().describe("Why you'd look again, in one sentence, with the price or the day in it."),
});

/** The Writer's decision as it wrote it, before the save adds the triggers. */
export type WriterDecisionInput = z.input<typeof writerDecisionSchema>;

export const submitWriterInput: Schema<WriterDecisionInput> = asWritten(writerDecisionSchema);

/**
 * submit_thesis's input as the SDK reads it. The model is sent
 * thesisDecisionSchema's own JSON schema and its call is checked against it,
 * but the tool gets the call as the model wrote it, not zod's output, whose
 * triggers are already converted to their stored shape (`toStored`, a
 * filing or a line moved from `value` to `variable`). The save converts each
 * trigger once, on its own schema, and refuses the stored shape: from #770
 * (2026-10-06) to 2026-11-13 the Writer handed the save its converted copy,
 * so every filing trigger and every price against an average it wrote was
 * refused (PRAX and AAOI lost whole theses), and its retries quoted the model
 * a converted call it never wrote.
 */
export const submitThesisInput: Schema<ThesisDecisionInput> = asWritten(thesisDecisionSchema);

function asWritten<S extends z.ZodType>(schema: S): Schema<z.input<S>> {
  const checked = zodSchema(schema);
  return jsonSchema<z.input<S>>(() => checked.jsonSchema, {
    validate: async (value) => {
      const result = await checked.validate!(value);
      return result.success ? { success: true, value: value as z.input<S> } : result;
    },
  });
}

/** A decision that passed validation; triggers are the parsed, typed array. */
export interface ValidatedThesisDecision
  extends Omit<ThesisDecisionInput, "triggers" | "add_triggers"> {
  triggers?: WriterTrigger[];
  add_triggers?: WriterTrigger[];
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
  /**
   * Status of the existing thesis on refresh (null on mint). Drives the
   * trigger action-set rule: held theses must not carry ENTER; unheld
   * theses must not carry position-management actions.
   */
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
 * (belief, conviction, the chart checks on its buy).
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
  const held = opts.mode === "refresh" && opts.existingStatus === "HOLDING";

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

  if (directional) {
    // ── Belief fields ─────────────────────────────────────────────────
    if (!d.core_belief || d.core_belief.trim().length < 10) {
      errors.push("core_belief: required for LONG/SHORT — why we own the company, in two or three plain sentences about the business: never a stock price, a target or a date.");
    }
    if (!d.key_assumptions || d.key_assumptions.filter((a) => a.trim().length > 0).length < 2) {
      errors.push("key_assumptions: ≥2 specific falsifiable premises required for LONG/SHORT.");
    }
    if (!d.invalidation_conditions || d.invalidation_conditions.filter((c) => c.trim().length > 0).length < 2) {
      errors.push("invalidation_conditions: ≥2 readings about the business, each with where it is read, required for LONG/SHORT — never a stock price, and not 'market volatility'.");
    }

    // ── Conviction Expression v4 ──────────────────────────────────────
    if (!d.conviction) {
      errors.push("conviction: required for LONG/SHORT — STRONG/HIGH/MEDIUM/LOW, your real view.");
    }
    if (!d.conviction_rationale || d.conviction_rationale.trim().length === 0) {
      errors.push("conviction_rationale: required — the judgment in plain speech, not a paraphrase of the bull case.");
    }
    // A top-tier call needs a variant view. Without one the tier is MEDIUM —
    // stored that way with a note, not refused. Three catalyst theses were
    // thrown away on 2026-09-25 over a 400-character rule; a detail the app
    // can fix is fixed by the app (DAV-316).
    if ((d.conviction === "STRONG" || d.conviction === "HIGH") && (!d.variant_view || d.variant_view.trim().length < 10)) {
      notes.push(`Conviction stored as MEDIUM: ${d.conviction} needs a variant view (consensus expects X, I think Y) and none was given.`);
      d.conviction = "MEDIUM";
    }
  }

  if (d.direction === "PASS" && d.triggers !== undefined && (d.triggers as unknown[]).length > 0) {
    errors.push(
      "look_again_price / look_again_date: a PASS stores no review. If you would look again at a price or a day, the view is LONG or SHORT with no playbook; if the research doesn't support a view at all, leave them out.",
    );
  }
  if (opts.mode === "refresh" && d.triggers !== undefined) {
    errors.push(
      "triggers: a refresh edits triggers one at a time — use add_triggers / edit_triggers (by the ids in EXISTING THESIS) / remove_trigger_ids. Omit `triggers`.",
    );
  }
  if (opts.mode === "mint" && (d.add_triggers || d.edit_triggers || d.remove_trigger_ids)) {
    errors.push("add_triggers / edit_triggers / remove_trigger_ids: a mint has no existing triggers to edit — send `triggers`.");
  }
  for (const e of d.edit_triggers ?? []) {
    if (editNumber(e).value !== undefined && !e.rationale?.trim()) {
      errors.push(`edit_triggers[${e.id}]: a value change requires a rationale — the sentence moves with the number.`);
    }
  }

  // A directional view with nothing on it can never come back (DAV-291).
  // LUXE 2026-09-18: "I want to price a drift or pullback entry rather than
  // buying now" — then saved LONG with no buy, no trigger and no review. A
  // watch gets no triggers it is not given, so omitting `triggers` on a mint
  // leaves zero wakes. Said here, in the writer's loop, with the level it
  // said it was waiting for — never a refusal at the save.
  if (directional && !held && opts.mode === "mint" && !((d.triggers as unknown[] | undefined)?.length)) {
    errors.push(nothingOnIt(d.direction));
  }

  // ── Triggers ─────────────────────────────────────────────────────────
  // On a refresh the same checks run on `add_triggers`: an added trigger is
  // a new trigger, so the action-set rules apply to it alone.
  let parsedTriggers: WriterTrigger[] | undefined;
  let parsedAdds: WriterTrigger[] | undefined;
  const dropped: DroppedItem[] = [];
  const supplied = opts.mode === "refresh" ? d.add_triggers : d.triggers;
  if (supplied !== undefined) {
    // One trigger at a time. A rung the server schema can't read is fixed
    // where the fix is obvious (an invented review kind with a day count is
    // a review cadence) and otherwise dropped with a note; the rest of the
    // ladder and the decision save. Under strict mode the model can't send
    // an unknown kind at all — this is the OpenAI / non-strict path and the
    // out-of-range values (a 500-day review) the grammar can't express.
    const kept: WriterTrigger[] = [];
    for (const item of supplied as unknown[]) {
      const read = readOneTrigger(item);
      if (read.trigger) kept.push(read.trigger);
      if (read.note) notes.push(read.note);
      if (read.dropped) dropped.push(read.dropped);
    }
    const parsed = { success: true as const, data: kept };
    {
      if (opts.mode === "refresh") parsedAdds = parsed.data;
      else parsedTriggers = parsed.data;
      // Action-set sanity by position state — mirrors the Layer-1 guards
      // record/update enforce, surfaced here so the repair is one step.
      const actions = new Set(parsed.data.map((t) => t.action));
      if (held) {
        if (actions.has("ENTER") || actions.has("STOP_WATCHING")) {
          errors.push("triggers: this thesis is HOLDING (position open) — ENTER and STOP_WATCHING triggers are forbidden. Use EXIT/REVIEW/TRIM/ADD.");
        }
      } else {
        // Mint, WATCHING refresh, PROMOTED refresh: no position exists, so nothing to sell.
        const forbidden = ["TRIM", "ADD", "EXIT"].filter((a) => actions.has(a as never));
        if (forbidden.length > 0) {
          errors.push(
            `triggers: no position exists (${opts.mode === "mint" ? "mint" : `refresh on ${opts.existingStatus}`}) — ${forbidden.join("/")} triggers are forbidden. Use ENTER, STOP_WATCHING ("Stop watching if below $X": it ends the watch, never sells) and REVIEW.`,
          );
        }
      }

    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    decision: {
      ...d,
      triggers: parsedTriggers,
      add_triggers: parsedAdds,
      notes: notes.length ? notes : undefined,
      ...(dropped.length ? { dropped } : {}),
    },
  };
}

/**
 * Read one model-authored trigger through the save's own schema
 * (`triggerInputSchema`, the one record_thesis and update_thesis parse), so
 * what the decision keeps is what the save takes, in the model's own shape:
 * the save converts it to the stored shape, once (`submitThesisInput` says
 * why). Returns the trigger as the save will read it, or nothing and what was
 * dropped and why (it goes on the stock as a "Not applied" line).
 */
export function readOneTrigger(item: unknown): { trigger: WriterTrigger | null; note: string | null; dropped?: DroppedItem } {
  const reads = (t: unknown) => triggerInputSchema.safeParse(t).success;
  if (reads(item)) return { trigger: item as WriterTrigger, note: null };

  const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
  const pred = obj?.predicate && typeof obj.predicate === "object" ? (obj.predicate as Record<string, unknown>) : null;
  const kind = typeof pred?.kind === "string" ? pred.kind : typeof pred?.watch === "string" ? pred.watch : "(none)";

  // An invented review kind with a day count ("REVIEW_AFTER_DAYS", IBRX
  // 2026-09-25) means "look again in N days" — the review cadence.
  if (pred && typeof pred.days === "number" && obj?.action === "REVIEW" && shapeOf(pred) == null) {
    const days = Math.min(Math.max(Math.round(pred.days), 1), 365);
    const asCadence = { ...obj, predicate: { watch: "repeat", value: days } };
    if (reads(asCadence)) {
      return { trigger: asCadence as WriterTrigger, note: `Trigger kind "${kind}" isn't one the app evaluates; saved as a review in ${days} days.` };
    }
  }

  const issue = triggerInputSchema.safeParse(item).error?.issues[0];
  return { trigger: null, note: null, dropped: droppedTrigger(obj, issue?.message ?? "the app couldn't read it") };
}

/** A trigger as the save reads it: the model's own shape, checked against the save's schema. */
export type WriterTrigger = Record<string, unknown> & { action: string; predicate: unknown; rationale: string };

/** What a save went without, and why: written on the stock as a "Not applied" line (`fieldChanges.notApplied`, as update_thesis writes). */
export interface DroppedItem {
  field: string;
  why: string;
  reason: string;
}

export function droppedTrigger(t: Record<string, unknown> | null, reason: string): DroppedItem {
  const note = typeof t?.rationale === "string" ? t.rationale.trim() : "";
  const action = typeof t?.action === "string" ? t.action.toLowerCase() : "a";
  return { field: "triggers", why: `the ${action} trigger${note ? ` "${note.length > 90 ? `${note.slice(0, 89)}…` : note}"` : ""}`, reason };
}

