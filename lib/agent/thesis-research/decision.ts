/**
 * decision.ts — the compact `submit_thesis` decision contract for the V2
 * thesis-writer (THESIS_WRITER_V2).
 *
 * The research model writes the 9-section note as plain text (parsed
 * server-side by parse-sections.ts) and finishes by calling submit_thesis
 * with THIS object — decision fields only, ~1-2k chars. The boundary
 * schema is deliberately LOOSE (everything beyond direction/horizon is
 * optional, triggers are unknown[]) so a malformed call never throws out
 * of the SDK loop; validateThesisDecision() does the real enforcement and
 * returns itemized errors the model repairs in its next step. That repair
 * loop replaces the V1 failure mode where a 25k-char record_thesis payload
 * bounced off Zod and cost ~3 minutes of full regeneration per bounce.
 *
 * Field names mirror record_thesis / update_thesis args 1:1 so the persist
 * phase can splat them through without a mapping layer.
 */

import { z } from "zod";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { subFloorTargetSize } from "@/lib/agent/position-sizing";

const scoringDimSchema = z.object({
  score: z.number(),
  note: z.string(),
});

/** Boundary schema for the submit_thesis tool call. Loose on purpose. */
export const thesisDecisionSchema = z.object({
  direction: z
    .enum(["LONG", "SHORT", "PASS"])
    .describe("Your directional call. PASS is allowed when the research doesn't support a directional view."),
  rationale: z
    .string()
    .describe("2-4 sentences: the decision in your own voice. On refresh this becomes the audit-row rationale."),
  horizon: z
    .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
    .describe("Exit policy + trigger template. CATALYST requires catalyst_date; TRADE requires max_hold_days."),
  entry_price: z.number().optional().describe("The price you'd BUY at — a level the stock has NOT reached: above the live price for a breakout you want confirmed, below it for a pullback you want to pay. Never the current price. Required for LONG/SHORT."),
  target_price: z.number().optional().describe("Take-profit level. Required for LONG/SHORT."),
  stop_loss: z.number().optional().describe("Where the thesis breaks. Required for LONG/SHORT."),
  catalyst_date: z.string().optional().describe("ISO date. Required when horizon=CATALYST."),
  max_hold_days: z.number().optional().describe("Required when horizon=TRADE (5-7 tight, 10-14 swing)."),
  core_belief: z
    .string()
    .optional()
    .describe("ONE falsifiable sentence: outcome + timeframe + mechanism. Required for LONG/SHORT."),
  key_assumptions: z
    .array(z.string())
    .optional()
    .describe("≥2 specific premises that must remain true. Required for LONG/SHORT."),
  invalidation_conditions: z
    .array(z.string())
    .optional()
    .describe("≥2 specific trip-wires that would prove the thesis wrong. Required for LONG/SHORT."),
  scoring: z
    .object({
      trendStrength: scoringDimSchema,
      relativeStrength: scoringDimSchema,
      entryQuality: scoringDimSchema,
      catalystFreshness: scoringDimSchema,
    })
    .optional()
    .describe("Composite rubric: trend 0-3 + relative 0-3 + entry 0-2 + catalyst 0-2. Required for LONG/SHORT."),
  conviction: z
    .enum(["STRONG", "HIGH", "MEDIUM", "LOW"])
    .optional()
    .describe("YOUR REAL VIEW, independent of composite. Required for LONG/SHORT."),
  conviction_rationale: z
    .string()
    .optional()
    .describe("≤400 chars, written like you're talking to a person — the judgment, not the math. Required with conviction."),
  variant_view: z
    .string()
    .optional()
    .describe("≤300 chars: 'consensus expects X, I think Y, falsifiable because Z'. Required for STRONG/HIGH."),
  target_size_pct: z
    .number()
    .optional()
    .describe("% of portfolio at full position (STRONG 4-6, HIGH 3-5, MEDIUM 2-3, LOW 1-2). Required for LONG/SHORT."),
  prior_exit_acknowledgment: z
    .string()
    .optional()
    .describe(
      "REQUIRED when this analyst SOLD this ticker within the last 14 days and your entry_price is at/above that exit price (the exit details are in your prompt). One line that genuinely engages with the sale — why this is a new setup, not a re-buy of the dip just sold. Omit when no recent sale applies.",
    ),
  triggers: z
    .array(z.unknown())
    .optional()
    .describe(
      "OPTIONAL custom trigger ladder. Omit to accept the horizon-default template (right answer for most theses). " +
        "Shape per trigger: { predicate: {kind, ...params}, action, rationale, cooldownDays? }.",
    ),
});

export type ThesisDecisionInput = z.infer<typeof thesisDecisionSchema>;

/** A decision that passed validation; triggers are the parsed, typed array. */
export interface ValidatedThesisDecision extends Omit<ThesisDecisionInput, "triggers"> {
  triggers?: z.infer<typeof triggersArraySchema>;
  /** Sum of the four scoring dimensions (present on LONG/SHORT). */
  composite?: number;
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
  /** Existing thesis target on refresh — feeds the goalpost-guard mirror. */
  existingTargetPrice?: number | null;
  /**
   * Whether the existing thesis carries any triggers (refresh only).
   * update_thesis is wholesale-REPLACE with NO default merge, and its
   * zero-trigger gate refuses a review-shaped patch on a bare thesis —
   * so a refresh on a trigger-less row must supply a full ladder.
   */
  existingHasTriggers?: boolean;
  /**
   * DAV-204: live account equity + the analyst's position band, when
   * known. Mirrors #524's sub-floor gate in-loop: a target_size_pct whose
   * dollar value can't clear the entry floor is an un-fillable plan (the
   * RARE failure) and must be repaired before persist. All optional —
   * missing equity/floor skips the mirror (persist gate also fails open).
   */
  equityUSD?: number | null;
  minPositionSize?: number;
  maxPositionSize?: number;
  realMaxPosition?: number;
  environment?: "PAPER" | "LIVE";
  /**
   * P1-35 (#524): set when this analyst sold this ticker within the last
   * 14 days. record_thesis refuses a mint at/above the exit price without
   * an explicit acknowledgment — required here so the repair happens
   * in-loop instead of failing the run at persist.
   */
  priorExit?: {
    exitPrice: number | null;
    daysAgo: number;
    closeReason: string | null;
  } | null;
}

export interface DecisionValidationResult {
  ok: boolean;
  errors: string[];
  decision?: ValidatedThesisDecision;
  /** Realized reward/risk for LONG/SHORT decisions. */
  riskReward?: number;
}

const MIN_RR = 2.0;

/**
 * Pure Layer-1 pre-validation of a submit_thesis call. Mirrors the gates
 * record_thesis / update_thesis enforce at persist time so the model gets
 * its rejection INSIDE the research loop — where a repair costs one cheap
 * step — instead of at the persist boundary where V1 paid ~3 minutes per
 * bounce. The persist-side gates still run afterwards; this is the fast
 * first line, not a replacement.
 */
export function validateThesisDecision(
  input: ThesisDecisionInput,
  opts: DecisionValidationOpts,
): DecisionValidationResult {
  const errors: string[] = [];
  const d = input;
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
  // is a TIME_ELAPSED review trigger on the ladder, minted per horizon —
  // visible and editable, unlike a column that fed a template once at mint
  // and then drifted from it.

  let riskReward: number | undefined;

  if (directional) {
    // ── Prices + R/R floor ────────────────────────────────────────────
    const { entry_price: entry, target_price: target, stop_loss: stop } = d;
    if (entry == null || entry <= 0) errors.push("entry_price: required and positive for LONG/SHORT.");
    if (target == null || target <= 0) errors.push("target_price: required and positive for LONG/SHORT.");
    if (stop == null || stop <= 0) errors.push("stop_loss: required and positive for LONG/SHORT.");

    if (entry != null && target != null && stop != null && entry > 0 && target > 0 && stop > 0) {
      if (d.direction === "LONG" && !(stop < entry && entry < target)) {
        errors.push(`price ordering: LONG requires stop_loss < entry_price < target_price (got stop=${stop}, entry=${entry}, target=${target}).`);
      }
      if (d.direction === "SHORT" && !(target < entry && entry < stop)) {
        errors.push(`price ordering: SHORT requires target_price < entry_price < stop_loss (got target=${target}, entry=${entry}, stop=${stop}).`);
      }
      const risk = d.direction === "LONG" ? entry - stop : stop - entry;
      const reward = d.direction === "LONG" ? target - entry : entry - target;
      if (risk > 0 && reward > 0) {
        riskReward = reward / risk;
        if (riskReward < MIN_RR) {
          errors.push(
            `R/R floor: ${riskReward.toFixed(2)}:1 is below the mandatory ${MIN_RR}:1 minimum. ` +
              "Either tighten the stop to a REAL technical level, raise the target to a CITED level, " +
              "or change direction to PASS with the rationale naming what entry would fix the math.",
          );
        }
      }
    }

    // ── Belief fields ─────────────────────────────────────────────────
    if (!d.core_belief || d.core_belief.trim().length < 10) {
      errors.push("core_belief: required for LONG/SHORT — ONE falsifiable sentence (outcome + timeframe + mechanism).");
    }
    if (!d.key_assumptions || d.key_assumptions.filter((a) => a.trim().length > 0).length < 2) {
      errors.push("key_assumptions: ≥2 specific falsifiable premises required for LONG/SHORT.");
    }
    if (!d.invalidation_conditions || d.invalidation_conditions.filter((c) => c.trim().length > 0).length < 2) {
      errors.push("invalidation_conditions: ≥2 specific trip-wires required for LONG/SHORT (numbers, events, dates — not 'market volatility').");
    }

    // ── Scoring rubric ────────────────────────────────────────────────
    if (!d.scoring) {
      errors.push("scoring: required for LONG/SHORT — all four dimensions with a note each.");
    } else {
      const caps: Array<[keyof NonNullable<typeof d.scoring>, number]> = [
        ["trendStrength", 3],
        ["relativeStrength", 3],
        ["entryQuality", 2],
        ["catalystFreshness", 2],
      ];
      for (const [dim, cap] of caps) {
        const s = d.scoring[dim];
        if (!s || typeof s.score !== "number" || s.score < 0 || s.score > cap) {
          errors.push(`scoring.${dim}: score must be 0-${cap}.`);
        } else if (!s.note || s.note.trim().length === 0) {
          errors.push(`scoring.${dim}: note is required — one line of concrete evidence.`);
        }
      }
    }

    // ── Conviction Expression v4 ──────────────────────────────────────
    if (!d.conviction) {
      errors.push("conviction: required for LONG/SHORT — STRONG/HIGH/MEDIUM/LOW, your real view.");
    }
    if (!d.conviction_rationale || d.conviction_rationale.trim().length < 20) {
      errors.push("conviction_rationale: required, ≥20 chars, ≤400 — the judgment in plain speech, not a paraphrase of the scoring object.");
    }
    if (d.conviction_rationale && d.conviction_rationale.length > 400) {
      errors.push("conviction_rationale: over 400 chars — tighten it.");
    }
    if ((d.conviction === "STRONG" || d.conviction === "HIGH") && (!d.variant_view || d.variant_view.trim().length < 10)) {
      errors.push("variant_view: required for STRONG/HIGH conviction — 'consensus expects X, I think Y, falsifiable because Z'. If you can't articulate one, your tier is MEDIUM.");
    }
    if (d.variant_view && d.variant_view.length > 300) {
      errors.push("variant_view: over 300 chars — tighten it.");
    }
    if (d.target_size_pct == null) {
      errors.push("target_size_pct: required for LONG/SHORT (STRONG 4-6, HIGH 3-5, MEDIUM 2-3, LOW 1-2).");
    } else if (d.target_size_pct < 0 || d.target_size_pct > 100) {
      errors.push("target_size_pct: must be between 0 and 100.");
    }
  }

  // ── Persist-gate mirrors (review finding #4) ────────────────────────
  // These reproduce update_thesis/record_thesis gates IN the loop so the
  // model repairs for one step instead of the whole run dying at persist.
  if (directional && opts.mode === "refresh") {
    // Goalpost guard mirror (update-thesis.ts "Goalpost-moving guard"):
    // raising the target on a WATCHING thesis whose live price has already
    // crossed the OLD target is moving the bar instead of acting.
    if (
      opts.existingStatus === "WATCHING" &&
      d.target_price != null &&
      opts.existingTargetPrice != null &&
      d.target_price > opts.existingTargetPrice &&
      opts.currentPrice != null &&
      opts.currentPrice >= opts.existingTargetPrice
    ) {
      errors.push(
        `target_price: the live price (${opts.currentPrice}) has already crossed the stored target (${opts.existingTargetPrice}) — raising the target now would be rejected by the goalpost gate. Keep target_price ≤ ${opts.existingTargetPrice}; note the re-rating case in the rationale and let the orchestrator decide entry.`,
      );
    }
    // Zero-trigger gate mirror: update_thesis refuses a patch that leaves
    // a thesis with no triggers at all.
    if (opts.existingHasTriggers === false && d.triggers === undefined) {
      errors.push(
        "triggers: the existing thesis has NO triggers, and omitting the field would leave it bare (update_thesis rejects zero-trigger patches). Supply a full ladder for this refresh.",
      );
    }
  }
  if (d.direction === "PASS" && d.triggers !== undefined && (d.triggers as unknown[]).length > 0) {
    errors.push("triggers: a PASS decision cannot carry triggers — omit the field entirely.");
  }

  // ── DAV-204: sub-floor sizing mirror (#524's persist gate, in-loop) ──
  if (
    directional &&
    d.target_size_pct != null &&
    opts.minPositionSize != null &&
    opts.minPositionSize > 0 &&
    opts.equityUSD != null &&
    opts.equityUSD > 0
  ) {
    const subFloor = subFloorTargetSize({
      targetSizePct: d.target_size_pct,
      equity: opts.equityUSD,
      environment: opts.environment ?? "PAPER",
      minPositionSize: opts.minPositionSize,
      maxPositionSize: opts.maxPositionSize,
      realMaxPosition: opts.realMaxPosition,
    });
    if (subFloor) {
      errors.push(
        `target_size_pct: ${d.target_size_pct}% ≈ $${Math.round(subFloor.intendedDollars).toLocaleString()} at current equity — below this analyst's $${Math.round(subFloor.floorDollars).toLocaleString()} entry floor, so place_trade would refuse the entry the day it fires (the RARE failure). Use ${subFloor.floorPct}% or higher IF conviction supports a full-floor position; otherwise the honest call is direction PASS, not a small size.`,
      );
    }
  }

  // ── P1-35: recently-sold acknowledgment mirror (#524, in-loop) ───────
  if (
    opts.mode === "mint" &&
    directional &&
    opts.priorExit?.exitPrice != null &&
    d.entry_price != null &&
    d.entry_price >= opts.priorExit.exitPrice &&
    !(d.prior_exit_acknowledgment && d.prior_exit_acknowledgment.trim().length > 0)
  ) {
    errors.push(
      `prior_exit_acknowledgment: required — this analyst SOLD this ticker ${opts.priorExit.daysAgo} day(s) ago at $${opts.priorExit.exitPrice}${opts.priorExit.closeReason ? ` (${opts.priorExit.closeReason})` : ""}, and your entry_price (${d.entry_price}) is at/above that exit. Supply one line that engages with the sale (why this is a new setup, not a re-buy of the dip just sold), or set entry below the exit price.`,
    );
  }

  // ── Triggers (optional — omission means horizon defaults) ───────────
  let parsedTriggers: z.infer<typeof triggersArraySchema> | undefined;
  if (d.triggers !== undefined) {
    const parsed = triggersArraySchema.safeParse(d.triggers);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      errors.push(
        `triggers: invalid shape — ${issues}. Each trigger is { predicate: {kind, ...}, action, rationale }. ` +
          "Simplest fix: OMIT the triggers field entirely and accept the horizon-default template.",
      );
    } else {
      parsedTriggers = parsed.data;
      // Action-set sanity by position state — mirrors the Layer-1 guards
      // record/update enforce, surfaced here so the repair is one step.
      const actions = new Set(parsedTriggers.map((t) => t.action));
      const held = opts.mode === "refresh" && opts.existingStatus === "HOLDING";
      if (held) {
        if (actions.has("ENTER")) {
          errors.push("triggers: this thesis is HOLDING (position open) — ENTER triggers are forbidden. Use EXIT/REVIEW/TRIM/ADD/MOVE_STOP.");
        }
      } else {
        // Mint, WATCHING refresh, PROMOTED refresh: no position exists.
        const forbidden = ["EXIT", "TRIM", "ADD", "MOVE_STOP"].filter((a) =>
          actions.has(a as never),
        );
        if (forbidden.length > 0) {
          errors.push(
            `triggers: no position exists (${opts.mode === "mint" ? "mint" : `refresh on ${opts.existingStatus}`}) — ${forbidden.join("/")} triggers are forbidden. Use ENTER + REVIEW only.`,
          );
        }
      }

      // Required-action mirrors of the persist-side enter-guard (review
      // finding #4c). update_thesis is wholesale-REPLACE with no default
      // merge, so a refresh ladder must itself carry the load-bearing rung.
      if (opts.mode === "refresh" && directional && parsedTriggers.length > 0) {
        if (held && !actions.has("EXIT")) {
          errors.push(
            "triggers: a HOLDING ladder must carry at least one EXIT rung (the automated stop-loss path) — the persist gate rejects ladders without one.",
          );
        }
        if (!held && !actions.has("ENTER")) {
          errors.push(
            "triggers: an unheld ladder must carry an ENTER rung — PRICE_ABOVE(entry) when the buy level is above the live price, PRICE_BELOW(entry) when it is below (mirror for SHORT). Add the ENTER rung or omit the triggers field and it is derived for you.",
          );
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    riskReward,
    decision: {
      ...d,
      triggers: parsedTriggers,
      composite: d.scoring
        ? d.scoring.trendStrength.score +
          d.scoring.relativeStrength.score +
          d.scoring.entryQuality.score +
          d.scoring.catalystFreshness.score
        : undefined,
    },
  };
}
