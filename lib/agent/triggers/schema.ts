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
  | { kind: "GAIN_FROM_ENTRY"; pct: number; direction: "UP" | "DOWN" }
  | { kind: "TRAILING_FROM_HIGH"; pct: number }
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
      kind: z.literal("GAIN_FROM_ENTRY"),
      pct: z.number().positive(),
      direction: z.enum(["UP", "DOWN"]),
    }),
    z.object({
      kind: z.literal("TRAILING_FROM_HIGH"),
      // ≥1%: a sub-1% trail off the peak would re-fire on ordinary noise
      // every tick the moment the peak is set.
      pct: z.number().min(1),
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
  // Never authored — derived at fire time by effectiveTriggerAction. Listed
  // so a stored value round-trips rather than failing the parse (which would
  // silently drop the whole ladder — see parseTriggersResilient's header).
  "DEMOTE",
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
  fireMode: z
    .enum(["TACTICAL", "DIRECT"])
    .default("TACTICAL")
    .describe(
      // How a fired trigger is acted on. TACTICAL (default) wakes a GPT-5.5
      // tactical run that evaluates + decides. DIRECT skips the agent and
      // closes the position directly via closeOpenPosition — EXIT-only, and
      // still routed through the approval gate (it saves the tactical-run
      // cost, not the approval step). The .default keeps legacy triggers
      // (and agent-minted ones that omit it) on the historical TACTICAL
      // behavior; the UI add-path opts new EXIT stops into DIRECT explicitly.
      "How a fired trigger is acted on: TACTICAL (wake a tactical run, default) or DIRECT (close directly, no agent — EXIT-only, still approval-gated).",
    ),
  // Server-owned provenance. Deliberately NO .default() — this schema is
  // also the disk-READ gate (trigger-evaluator, get-theses, thesis-sheet-
  // state, tactical-run, live-evaluate), so a default would silently
  // relabel every legacy rung as whatever we picked. Absent stays absent.
  // The write paths stamp it; the model never supplies it (anything it
  // fabricates is overwritten server-side).
  source: z
    .enum(["DEFAULT", "AGENT", "PRINCIPAL"])
    .optional()
    .describe(
      "Server-owned. Who authored this rung's value: DEFAULT (code template), AGENT, or PRINCIPAL (UI). Do not set — it is stamped server-side and any supplied value is overwritten.",
    ),
});

export const triggersArraySchema = z
  .array(triggerSchema)
  .max(20)
  .describe(
    "Structured triggers attached to this thesis. Each is a (predicate, action, rationale) tuple the router evaluates deterministically. Capped at 20 per thesis to keep the matching loop bounded.",
  );

export type TriggerInput = z.infer<typeof triggerSchema>;

// ── Resilient read-path parse ──────────────────────────────────────────
//
// `triggersArraySchema` is used at BOTH write time and disk-read time,
// and array validation is all-or-nothing: one out-of-range field fails
// the whole array, so every rung on that thesis silently disappears.
//
// This is not theoretical. On 2026-08-16, GD / ASML / ETN each carried a
// TIME_ELAPSED review rung with cooldownDays of 144 / 144 / 292 against
// the schema's max of 90 — and all 8 / 8 / 6 of their rungs, entry
// triggers included, were being discarded on every read. No error, no
// alert. Same silent-failure shape as the id-less bug of 2026-06.
//
// The file already warns about exactly this hazard for `.refine()`
// ("would fail the whole array parse and silently drop ALL triggers on
// that thesis") — the `.max(90)` on cooldownDays does the same thing and
// nobody noticed.
//
// So the read path parses rung-by-rung and repairs what it can:
//   • cooldownDays out of range → CLAMPED into [0, 90]. A 292-day
//     cooldown means "basically never re-fire"; 90 is close enough, and
//     keeping the rung beats losing it.
//   • anything else invalid   → that ONE rung is dropped, loudly. The
//     rest of the ladder survives.
//
// The write paths keep using `triggersArraySchema` directly and stay
// strict — bad input should be refused at the door, not repaired.

const MAX_COOLDOWN_DAYS = 90;

export interface ResilientParseResult {
  triggers: TriggerInput[];
  /** Rungs whose cooldown was out of range and got clamped. */
  clamped: number;
  /** Rungs that could not be repaired and were dropped. */
  dropped: number;
}

export function parseTriggersResilient(raw: unknown): ResilientParseResult {
  if (!Array.isArray(raw)) {
    // A non-array (or null) is "no triggers", not corruption.
    const whole = triggersArraySchema.safeParse(raw ?? []);
    return {
      triggers: whole.success ? whole.data : [],
      clamped: 0,
      dropped: 0,
    };
  }

  const triggers: TriggerInput[] = [];
  let clamped = 0;
  let dropped = 0;

  for (const entry of raw) {
    let candidate = entry;
    // Repair pass: clamp an out-of-range cooldown before validating.
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as { cooldownDays?: unknown }).cooldownDays === "number"
    ) {
      const cd = (candidate as { cooldownDays: number }).cooldownDays;
      const fixed = Math.min(Math.max(Math.round(cd), 0), MAX_COOLDOWN_DAYS);
      if (fixed !== cd) {
        candidate = { ...(candidate as object), cooldownDays: fixed };
        clamped++;
      }
    }

    const parsed = triggerSchema.safeParse(candidate);
    if (parsed.success) {
      triggers.push(parsed.data);
      continue;
    }
    dropped++;
    console.error(
      "[triggers] dropping one unparseable rung; the rest of the ladder is kept:",
      parsed.error.issues.slice(0, 2),
    );
  }

  return { triggers, clamped, dropped };
}
