/**
 * model-schema.ts — the trigger shape the MODEL is handed.
 *
 * On 2026-09-25 the writer sent `REVIEW_AFTER_DAYS` on IBRX and BBIO — a kind
 * that does not exist — because `triggers` was typed `z.array(z.unknown())`
 * and the real kinds were listed in prose. Both runs were refused and the
 * research was thrown away (DAV-316). This schema names every kind the
 * evaluator has, as a typed union the model reads in the tool definition,
 * and nothing else; the validator (decision.ts) coerces or drops what the
 * model still gets wrong, with a note on the row, and never refuses.
 *
 * It is NOT sent in strict mode, and that was measured, not assumed.
 * Anthropic's strict mode compiles the schema into a grammar and refuses
 * one with more than 24 optional parameters or 16 union-typed parameters
 * (nullable counts as a union). submit_thesis has 119 and 121 — twenty-odd
 * top-level fields, an edit op, and the predicate union repeated six times.
 * Both refusals came back from the API on 2026-09-25
 * (req_011CfQt3ZckbsuNNd91wSWbL, req_011CfQtMV9NnoTrn4srRu4T9); the static
 * keyword check had passed the schema. A grammar is for a small schema. For
 * this one the guarantee is: typed kinds the model reads, coercion at the
 * boundary, one repair turn. `model-schema.test.ts` pins the kind list.
 *
 * Why this is a second schema and not `triggerSchema` from ./schema.ts:
 * that one uses `discriminatedUnion` and `.int()` ranges and recursion,
 * which read badly in a tool definition; this one is `z.union`, plain
 * numbers, one level of AND / OR, and says every range in words. The server
 * schema still validates the values on the way in.
 */

import { z } from "zod";

const priceBasis = z
  .enum(["intraday", "close"])
  .optional()
  .describe('"close" = the day must CLOSE past the level (checked once at 16:20 ET); omit for the intraday cross.');

const smaPeriod = z.literal([20, 50, 150, 200]).describe("The moving average: 20, 50, 150 or 200 days.");

/** One condition. Every range is stated in the description; the server clamps. */
const leafPredicate = z.union([
  z.object({ kind: z.literal("PRICE_ABOVE"), level: z.number().describe("Price level, dollars."), basis: priceBasis }),
  z.object({ kind: z.literal("PRICE_BELOW"), level: z.number().describe("Price level, dollars."), basis: priceBasis }),
  z.object({
    kind: z.literal("PRICE_MOVE_PCT"),
    pct: z.number().describe("Percent move, positive."),
    direction: z.enum(["UP", "DOWN"]),
    window: z.enum(["1D", "5D", "20D"]).describe("1D off the quote; 5D / 20D off daily closes."),
  }),
  z.object({
    kind: z.literal("GAIN_FROM_ENTRY"),
    pct: z.number().describe("Percent from the fill, positive."),
    direction: z.enum(["UP", "DOWN"]),
    skipIfPeakGainPct: z.number().optional().describe("Off for good once the peak ran this far (≤ 500)."),
    skipIfPeakWithinDays: z.number().optional().describe("…within this many days of the buy (≤ 365)."),
  }),
  z.object({
    kind: z.literal("TRAILING_FROM_HIGH"),
    pct: z.number().describe("Give-back off the tracked peak, percent, at least 1."),
    armAtGainPct: z.number().optional().describe("Off until the position is up this % from entry (0–200)."),
    atrMultiple: z.number().optional().describe("The give-back widens to this × ATR(14) when larger (≤ 10)."),
  }),
  z.object({ kind: z.literal("VS_SMA"), period: smaPeriod, direction: z.enum(["ABOVE", "BELOW"]) }),
  z.object({ kind: z.literal("NEAR_SMA"), period: smaPeriod, withinPct: z.number().describe("Within this % of the average (≤ 10).") }),
  z.object({ kind: z.literal("VOLUME_RATIO"), min: z.number().describe("Today's volume ÷ the 20-day average, at least this (≤ 50).") }),
  z.object({ kind: z.literal("NEW_HIGH"), window: z.enum(["20D", "52W"]) }),
  z.object({ kind: z.literal("PCT_FROM_52W_HIGH"), max: z.number().describe("At most this % under the 52-week high (0–100).") }),
  z.object({
    kind: z.literal("RS_VS_SPY"),
    window: z.enum(["1M", "3M", "6M"]),
    min: z.number().describe("Percentage points ahead of SPY, at least this; negative is legal (−100…500)."),
  }),
  z.object({
    kind: z.literal("GAP_UP"),
    minPct: z.number().describe("Gap size, percent (≤ 100)."),
    minVolRatio: z.number().describe("Volume ÷ 20-day average on the gap day (0–50)."),
    withinDays: z.number().optional().describe("Sessions the gap may be old: 1 = today only (1–10)."),
  }),
  z.object({
    kind: z.literal("RSI"),
    period: z.literal([2, 14]).optional().describe("RSI period, 2 or 14; omit for 14."),
    threshold: z.number().describe("0–100."),
    direction: z.enum(["ABOVE", "BELOW"]),
  }),
  z.object({
    kind: z.literal("INSIDER_CLUSTER"),
    minBuyers: z.number().describe("Distinct open-market buyers, 1–10."),
    days: z.number().describe("Window in days, 1–90."),
  }),
  z.object({ kind: z.literal("EARNINGS_BEAT"), minSurprisePct: z.number().optional().describe("EPS beat at least this %, omit for any beat.") }),
  z.object({ kind: z.literal("EARNINGS_MISS"), minSurprisePct: z.number().optional().describe("EPS miss at least this %, omit for any miss.") }),
  z.object({ kind: z.literal("EARNINGS_WITHIN"), days: z.number().describe("Reports within this many days, 1–14.") }),
  z.object({
    kind: z.literal("EARNINGS_SINCE"),
    min: z.number().describe("Sessions since the report, 0 = the report day (0–5)."),
    max: z.number().describe("At most this many sessions since (0–5, ≥ min)."),
  }),
  z.object({
    kind: z.literal("SEC_EVENT"),
    tier: z.enum(["RED", "MATERIAL"]).optional().describe("At least this tier; MATERIAL matches red filings too."),
    items: z.array(z.string()).optional().describe('8-K item codes, e.g. ["2.01"] for a completed acquisition.'),
    forms: z.array(z.string()).optional().describe('Forms that are an event by themselves, e.g. ["SCHEDULE 13D"].'),
  }),
  z.object({
    kind: z.literal("REVIEW_CADENCE"),
    days: z.number().describe("Day count, 1–365."),
    from: z
      .enum(["LAST_REVIEW", "BUY", "EVENT"])
      .optional()
      .describe("Counting from: the last review (repeating; the default), the buy (a time limit on a held stock), or the thesis's own event date."),
    side: z.enum(["BEFORE", "AFTER"]).optional().describe('With from: "EVENT" — BEFORE fires from N days out until the date; AFTER fires N days past it.'),
  }),
]);

/** A condition, or two-to-eight conditions that must all / any hold. */
export const modelPredicateSchema = z.union([
  leafPredicate,
  z.object({ kind: z.literal("AND"), predicates: z.array(leafPredicate).describe("2–8 conditions, all true.") }),
  z.object({ kind: z.literal("OR"), predicates: z.array(leafPredicate).describe("2–8 conditions, any true.") }),
]);

export const modelTriggerActionSchema = z.enum(["REVIEW", "EXIT", "ENTER", "ADD", "TRIM", "MOVE_STOP"]);

/** A trigger as the writer authors it. Ids, provenance and fire state are the server's. */
export const modelTriggerSchema = z.object({
  predicate: modelPredicateSchema,
  action: modelTriggerActionSchema.describe("ENTER = buy; EXIT = sell; REVIEW = look again; ADD / TRIM / MOVE_STOP on a stock we hold."),
  rationale: z.string().describe("One sentence read when this fires: what it means and what to do."),
  cooldownDays: z
    .number()
    .optional()
    .describe("Days before this can fire again (0–90). Omit for the kind's default — the right answer almost always."),
});

/** One edit to an existing trigger, by id — the model-facing twin of editTriggerOpSchema. */
export const modelEditTriggerOpSchema = z.object({
  id: z.string().describe("The trigger's id, as shown on the thesis."),
  level: z.number().optional().describe("New price for a price-above / price-below trigger."),
  pct: z.number().optional().describe("New percent for a move / gain / trailing trigger."),
  days: z.number().optional().describe("New day count for a review-cadence trigger (1–365)."),
  action: modelTriggerActionSchema.optional(),
  fire_mode: z.enum(["TACTICAL", "DIRECT"]).optional(),
  rationale: z.string().optional().describe("REQUIRED when level / pct / days changes — the sentence moves with the number."),
  cooldown_days: z.number().optional().describe("0–90."),
});

export type ModelTrigger = z.infer<typeof modelTriggerSchema>;
export type ModelEditTriggerOp = z.infer<typeof modelEditTriggerOpSchema>;
