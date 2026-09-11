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

// Recursive shape for AND/OR composition. Zod doesn't support direct
// discriminated-union recursion, so we type the recursion via z.lazy.
type PredicateShape =
  | { kind: "PRICE_ABOVE"; level: number; basis?: "intraday" | "close" }
  | { kind: "PRICE_BELOW"; level: number; basis?: "intraday" | "close" }
  | { kind: "PRICE_MOVE_PCT"; pct: number; direction: "UP" | "DOWN"; window: "1D" | "5D" | "20D" }
  | { kind: "GAIN_FROM_ENTRY"; pct: number; direction: "UP" | "DOWN" }
  | { kind: "TRAILING_FROM_HIGH"; pct: number; armAtGainPct?: number }
  | { kind: "VS_SMA"; period: 20 | 50 | 150 | 200; direction: "ABOVE" | "BELOW" }
  | { kind: "NEAR_SMA"; period: 20 | 50 | 150 | 200; withinPct: number }
  | { kind: "VOLUME_RATIO"; min: number }
  | { kind: "NEW_HIGH"; window: "20D" | "52W" }
  | { kind: "PCT_FROM_52W_HIGH"; max: number }
  | { kind: "RS_VS_SPY"; window: "1M" | "3M" | "6M"; min: number }
  | { kind: "GAP_UP"; minPct: number; minVolRatio: number; withinDays?: number }
  | { kind: "RSI"; period?: 2 | 14; threshold: number; direction: "ABOVE" | "BELOW" }
  | { kind: "EARNINGS_BEAT"; minSurprisePct?: number }
  | { kind: "EARNINGS_MISS"; minSurprisePct?: number }
  | { kind: "EARNINGS_WITHIN"; days: number }
  | { kind: "EARNINGS_SINCE"; min: number; max: number }
  | { kind: "REVIEW_CADENCE"; days: number }
  | { kind: "AND"; predicates: PredicateShape[] }
  | { kind: "OR"; predicates: PredicateShape[] };

const priceBasis = z
  .enum(["intraday", "close"])
  .optional()
  .describe('"close" = the day must CLOSE past the level (checked once at 16:20 ET); omit for the intraday cross.');
const smaPeriod = z.union([z.literal(20), z.literal(50), z.literal(150), z.literal(200)]);

export const triggerPredicateSchema: z.ZodType<PredicateShape> = z.lazy(() =>
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
      pct: z.number().positive(),
      direction: z.enum(["UP", "DOWN"]),
    }),
    z.object({
      kind: z.literal("TRAILING_FROM_HIGH"),
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
    z.object({
      kind: z.literal("REVIEW_CADENCE"),
      days: z.number().int().positive().max(365),
    }),
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
      "Prose the LLM reads when acting on this trigger. e.g. 'A close under the 50-day on heavy volume breaks the pullback thesis — exit.'",
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
      "Don't re-fire this trigger more than once per N days. OMIT to use the per-predicate-kind default (EARNINGS_BEAT/MISS: 7, PRICE_* and chart kinds: 1, REVIEW_CADENCE: matches the cadence) — that's the right answer in almost every case. The value 0 ('fire every evaluation') is RESERVED for terminal EXIT triggers ONLY; passing 0 on any other action creates a 5-minute trigger-evaluator infinite loop the instant the predicate latches true (NVDA 2026-06-02 cost ~$10–15 before manual hotfix). The runtime overrides 0 with the per-kind default on every action ≠ EXIT.",
    ),
  lastFiredAt: z.string().datetime().optional(),
  horizons: z
    .array(z.enum(["TRADE", "TARGET", "CATALYST", "COMPOUNDER"]))
    .min(1)
    .optional()
    .describe(
      "Account/analyst rules only: the thesis horizons this rule applies to. Omit for every horizon. Ignored on a thesis's own trigger.",
    ),
  fireOnMatch: z
    .boolean()
    .optional()
    .describe(
      "ENTER only: fire on the first check where the condition is already true (a buy-now level the price is past), instead of waiting for it to cross. Ignored on other actions.",
    ),
  fireMode: z
    .enum(["TACTICAL", "DIRECT"])
    .optional()
    .describe(
      // How a fired trigger is acted on. TACTICAL wakes a GPT-5.5 tactical
      // run that evaluates + decides. DIRECT skips the agent and closes the
      // position directly via closeOpenPosition — EXIT-only, and still
      // routed through the approval gate (it saves the tactical-run cost,
      // not the approval step). Absent ⇒ TACTICAL (types.ts contract; every
      // reader does `?? "TACTICAL"`). Was `.default("TACTICAL")` until
      // DAV-226: the default stamped a "TACTICAL" label onto every rung on
      // every write — including REVIEW rungs, whose fires never wake a
      // tactical agent (they batch into the next daily run), so the stored
      // label claimed behavior that doesn't exist. The UI add-path still
      // opts new EXIT stops into DIRECT explicitly.
      "How a fired trigger is acted on: TACTICAL (wake a tactical run; the behavior when omitted) or DIRECT (close directly, no agent — EXIT-only, still approval-gated).",
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

/**
 * An account's or analyst's standing rules. Larger cap than a thesis: since
 * DAV-250 the account holds one sell ladder per horizon (four of them) plus
 * the rules every horizon shares — 20 on a fresh seed.
 */
export const levelTriggersArraySchema = z.array(triggerSchema).max(48);

export type TriggerInput = z.infer<typeof triggerSchema>;

// ── Resilient read-path parse ──────────────────────────────────────────
//
// `triggersArraySchema` is used at BOTH write time and disk-read time,
// and array validation is all-or-nothing: one out-of-range field fails
// the whole array, so every rung on that thesis silently disappears.
//
// This is not theoretical. On 2026-08-16, GD / ASML / ETN each carried a
// review rung with cooldownDays of 144 / 144 / 292 against
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
