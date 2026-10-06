/**
 * The kinds' schema, from before the condition shape, and the app's save
 * check until PR 4: a condition is valid exactly when its kind spelling
 * passes this (lib/agent/triggers/schema.ts), so the shape accepts what the
 * kinds did and refuses what they refused. PR 4 moves the ranges onto each
 * measure's catalog entry and deletes this file with the translator.
 */

import { z } from "zod";
import type { LegacyPredicate } from "./legacy-types";

const priceBasis = z
  .enum(["intraday", "close"])
  .optional()
  .describe('"close" = the day must CLOSE past the level (checked once at 16:20 ET); omit for the intraday cross.');
const smaPeriod = z.union([z.literal(20), z.literal(50), z.literal(150), z.literal(200)]);

export const legacyPredicateSchema: z.ZodType<LegacyPredicate> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("PRICE_ABOVE"), level: z.number(), basis: priceBasis }),
    z.object({ kind: z.literal("PRICE_BELOW"), level: z.number(), basis: priceBasis }),
    z.object({
      kind: z.literal("PRICE_MOVE_PCT"),
      pct: z.number().positive(),
      direction: z.enum(["UP", "DOWN"]),
      // 1D off the quote; 5D / 20D off the daily snapshot's closes.
      window: z.enum(["1D", "5D", "20D"]),
    }),
    z.object({
      kind: z.literal("GAIN_FROM_ENTRY"),
      // A big winner is not trimmed: once the position's peak has run this
      // far off the buy, this fast, the rung is off for good. Both halves
      // together — a slow grind to the same gain is an ordinary winner and
      // still gets de-risked.
      skipIfPeakGainPct: z.number().positive().max(500).optional(),
      skipIfPeakWithinDays: z.number().int().positive().max(365).optional(),
      pct: z.number().positive(),
      direction: z.enum(["UP", "DOWN"]),
    }),
    z.object({
      kind: z.literal("TRAILING_FROM_HIGH"),
      // The stock's own range widens the give-back: the larger of pct and
      // atrMultiple × ATR(14). It only ever widens (DAV-294, playbook E5).
      atrMultiple: z.number().positive().max(10).optional(),
      // ≥1%: a sub-1% trail off the peak would re-fire on ordinary noise
      // every tick the moment the peak is set.
      pct: z.number().min(1),
      // Off until the position has once been up this % from entry.
      armAtGainPct: z.number().min(0).max(200).optional(),
    }),
    z.object({
      kind: z.literal("VS_SMA"),
      period: smaPeriod,
      direction: z.enum(["ABOVE", "BELOW"]),
    }),
    z.object({
      kind: z.literal("NEAR_SMA"),
      period: smaPeriod,
      withinPct: z.number().positive().max(10),
    }),
    z.object({
      kind: z.literal("VOLUME_RATIO"),
      min: z.number().positive().max(50),
    }),
    z.object({
      kind: z.literal("NEW_HIGH"),
      window: z.enum(["20D", "52W"]),
    }),
    z.object({
      kind: z.literal("PCT_FROM_52W_HIGH"),
      max: z.number().min(0).max(100),
    }),
    z.object({
      kind: z.literal("RS_VS_SPY"),
      window: z.enum(["1M", "3M", "6M"]),
      // Percentage points vs SPY; negative is legal ("not lagging by more than 5").
      min: z.number().min(-100).max(500),
    }),
    z.object({
      kind: z.literal("GAP_UP"),
      minPct: z.number().positive().max(100),
      minVolRatio: z.number().min(0).max(50),
      // 1 = today only; up to the 10 sessions the snapshot keeps gaps for.
      withinDays: z.number().int().min(1).max(10).optional(),
    }),
    z.object({
      kind: z.literal("RSI"),
      period: z.union([z.literal(2), z.literal(14)]).optional(),
      threshold: z.number().min(0).max(100),
      direction: z.enum(["ABOVE", "BELOW"]),
    }),
    z.object({
      kind: z.literal("INSIDER_CLUSTER"),
      minBuyers: z.number().int().min(1).max(10),
      // The snapshot keeps 90 days of buys (INSIDER_LOOKBACK_DAYS).
      days: z.number().int().min(1).max(90),
    }),
    z.object({
      kind: z.literal("EARNINGS_BEAT"),
      minSurprisePct: z.number().optional(),
    }),
    z.object({
      kind: z.literal("EARNINGS_MISS"),
      minSurprisePct: z.number().optional(),
    }),
    z.object({
      kind: z.literal("EARNINGS_WITHIN"),
      // Capped at the calendar lookahead (EARNINGS_LOOKAHEAD_DAYS) — a
      // longer horizon would ask about reports the evaluator never fetches.
      days: z.number().int().min(1).max(14),
    }),
    z
      .object({
        kind: z.literal("EARNINGS_SINCE"),
        // 0 = the report day itself. Max is the calendar lookback
        // (EARNINGS_LOOKBACK_DAYS) — beyond it the row isn't fetched.
        min: z.number().int().min(0).max(5),
        max: z.number().int().min(0).max(5),
      })
      .refine((p) => p.min <= p.max, { message: "min must be ≤ max" }),
    z
      .object({
        kind: z.literal("SEC_EVENT"),
        // "At least": MATERIAL matches red filings too.
        tier: z.enum(["RED", "MATERIAL"]).optional(),
        // 8-K item codes, e.g. ["2.01"] for a completed acquisition.
        items: z.array(z.string().min(4).max(5)).max(20).optional(),
        // Forms that are an event by themselves, e.g. ["SCHEDULE 13D"].
        forms: z.array(z.string().min(1).max(20)).max(10).optional(),
      })
      .refine((p) => p.tier != null || (p.items?.length ?? 0) > 0 || (p.forms?.length ?? 0) > 0, {
        message: "SEC_EVENT needs a tier, item codes or forms",
      }),
    z.object({
      kind: z.literal("REVIEW_CADENCE"),
      days: z.number().int().positive().max(365),
      // Counting from: the last review (the review clock, repeating), the
      // buy (a time limit on a held position: "sell 20 days after the buy
      // if still held"), or the thesis's own event date ("review 3 days
      // before the FDA date"). The event date is the one stored on the
      // thesis (catalystDate) — never typed here.
      from: z.enum(["LAST_REVIEW", "BUY", "EVENT"]).optional(),
      side: z.enum(["BEFORE", "AFTER"]).optional(),
    }),
    z.object({
      kind: z.literal("AND"),
      predicates: z.array(legacyPredicateSchema).min(1).max(8),
    }),
    z.object({
      kind: z.literal("OR"),
      predicates: z.array(legacyPredicateSchema).min(1).max(8),
    }),
  ]),
);
