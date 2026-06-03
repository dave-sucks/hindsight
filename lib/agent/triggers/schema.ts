/**
 * Zod schemas for thesis triggers — used by record_thesis / update_thesis
 * to validate agent-supplied trigger arrays before persistence.
 *
 * Stays in sync with lib/agent/triggers/types.ts. Adding a new predicate
 * kind requires updating BOTH this schema AND the type union AND the
 * deterministic evaluator (PR 2). All three or none — partial updates
 * mean triggers that look valid get silently dropped at evaluation time.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";

const signalTypeEnum = z.enum([
  "NEWS",
  "EARNINGS",
  "FILING",
  "SOCIAL",
  "PRICE_ACTION",
  "ANALYST_NOTE",
  "OPTIONS",
  "MACRO",
  "SECTOR",
]);

const sentimentEnum = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);
const urgencyEnum = z.enum(["LOW", "MEDIUM", "HIGH", "BREAKING"]);

// Recursive shape for AND/OR composition. Zod doesn't support direct
// discriminated-union recursion, so we type the recursion via z.lazy.
type PredicateShape =
  | { kind: "PRICE_ABOVE"; level: number }
  | { kind: "PRICE_BELOW"; level: number }
  | {
      kind: "PRICE_MOVE_PCT";
      pct: number;
      direction: "UP" | "DOWN";
      window: "1D" | "5D" | "30D";
    }
  | { kind: "VS_SMA"; period: 50 | 200; direction: "ABOVE" | "BELOW" }
  | { kind: "RSI"; threshold: number; direction: "ABOVE" | "BELOW" }
  | {
      kind: "SIGNAL_TYPE";
      signalType: z.infer<typeof signalTypeEnum>;
      sentiment?: z.infer<typeof sentimentEnum>;
      minUrgency?: z.infer<typeof urgencyEnum>;
    }
  | { kind: "EARNINGS_BEAT"; minSurprisePct?: number }
  | { kind: "EARNINGS_MISS"; minSurprisePct?: number }
  | { kind: "GUIDANCE_CHANGE"; direction: "UP" | "DOWN" }
  | { kind: "FILING"; formType: "10-K" | "10-Q" | "8-K" | "FORM_4" }
  | { kind: "TIME_ELAPSED"; days: number }
  | { kind: "REVIEW_DATE_HIT" }
  | { kind: "AND"; predicates: PredicateShape[] }
  | { kind: "OR"; predicates: PredicateShape[] };

export const triggerPredicateSchema: z.ZodType<PredicateShape> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("PRICE_ABOVE"), level: z.number() }),
    z.object({ kind: z.literal("PRICE_BELOW"), level: z.number() }),
    z.object({
      kind: z.literal("PRICE_MOVE_PCT"),
      pct: z.number().positive(),
      direction: z.enum(["UP", "DOWN"]),
      window: z.enum(["1D", "5D", "30D"]),
    }),
    z.object({
      kind: z.literal("VS_SMA"),
      period: z.union([z.literal(50), z.literal(200)]),
      direction: z.enum(["ABOVE", "BELOW"]),
    }),
    z.object({
      kind: z.literal("RSI"),
      threshold: z.number().min(0).max(100),
      direction: z.enum(["ABOVE", "BELOW"]),
    }),
    z.object({
      kind: z.literal("SIGNAL_TYPE"),
      signalType: signalTypeEnum,
      sentiment: sentimentEnum.optional(),
      minUrgency: urgencyEnum.optional(),
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
      kind: z.literal("GUIDANCE_CHANGE"),
      direction: z.enum(["UP", "DOWN"]),
    }),
    z.object({
      kind: z.literal("FILING"),
      formType: z.enum(["10-K", "10-Q", "8-K", "FORM_4"]),
    }),
    z.object({
      kind: z.literal("TIME_ELAPSED"),
      days: z.number().int().positive(),
    }),
    z.object({ kind: z.literal("REVIEW_DATE_HIT") }),
    z.object({
      kind: z.literal("AND"),
      predicates: z.array(triggerPredicateSchema).min(1).max(8),
    }),
    z.object({
      kind: z.literal("OR"),
      predicates: z.array(triggerPredicateSchema).min(1).max(8),
    }),
  ]),
);

export const triggerActionSchema = z.enum([
  "REVIEW",
  "EXIT",
  "ENTER",
  "ADD",
  "TRIM",
  "MOVE_STOP",
]);

export const triggerSchema = z.object({
  // Stable id, REQUIRED at evaluation time — the trigger-evaluator drops
  // any trigger without one (parseTriggers), and lastFiredAt cooldown
  // stamping keys off it. The LLM never supplies an id (it's an internal
  // field), so we GENERATE one here via .default() when omitted. Before
  // 2026-06-02 this was a bare .optional() whose "auto-generated if
  // omitted" description was never implemented — agent-supplied trigger
  // arrays persisted id-less, and the evaluator silently skipped them, so
  // ENTER/EXIT triggers on 25 of 30 theses (incl. live MRVL/TSM stops)
  // never fired. See docs + the trigger-id backfill.
  id: z
    .string()
    .default(() => randomUUID())
    .describe("Stable id; auto-generated when the writer omits it."),
  predicate: triggerPredicateSchema,
  action: triggerActionSchema,
  rationale: z
    .string()
    .min(1)
    .describe(
      "Prose the LLM reads when acting on this trigger. e.g. 'Guidance cut compresses the multiple — exit immediately.'",
    ),
  cooldownDays: z
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .describe(
      // Description-level discipline — the agent reads this when picking
      // a value. Runtime enforcement lives in the read/write paths
      // (applyTriggerCooldownDefaults overwrites bad 0s at write time,
      // shouldFire falls back to the per-kind default at evaluation time).
      // Not enforced by Zod .refine() here because triggersArraySchema is
      // ALSO used at disk-read time (trigger-evaluator parseTriggers,
      // get-theses, thesis-sheet-state, tactical-run, live-evaluate). A
      // refine() that rejects legacy bad-shape rows would fail the whole
      // array parse and silently drop ALL triggers on that thesis —
      // including the legitimate EXIT stops sitting next to the bad
      // REVIEW. That's the same silent-failure shape PR #371 just fixed
      // for the id-less bug; don't re-introduce it.
      "Don't re-fire this trigger more than once per N days. OMIT to use the per-predicate-kind default (EARNINGS_*: 7, FILING/SIGNAL_TYPE/PRICE_*: 1, TIME_ELAPSED: ~80% of window, REVIEW_DATE_HIT: 7) — that's the right answer in almost every case. The value 0 ('fire every evaluation') is RESERVED for terminal EXIT triggers ONLY; passing 0 on any other action creates a 5-minute trigger-evaluator infinite loop the instant the predicate latches true (NVDA 2026-06-02 cost ~$10–15 before manual hotfix). The runtime overrides 0 with the per-kind default on every action ≠ EXIT.",
    ),
  lastFiredAt: z.string().datetime().optional(),
});

export const triggersArraySchema = z
  .array(triggerSchema)
  .max(20)
  .describe(
    "Structured triggers attached to this thesis. Each is a (predicate, action, rationale) tuple the router evaluates deterministically. Capped at 20 per thesis to keep the matching loop bounded.",
  );

export type TriggerInput = z.infer<typeof triggerSchema>;
