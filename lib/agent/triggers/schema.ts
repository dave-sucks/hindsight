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
import { isShape, shapeOf, toLegacy } from "./condition/legacy";
import { legacyPredicateSchema } from "./condition/legacy-schema";
import type { Watch, When } from "./condition/types";
import { MEASURES } from "./condition/catalog";

// Recursive shape for AND/OR composition. Zod doesn't support direct
// discriminated-union recursion, so we type the recursion via z.lazy.
/**
 * A trigger's condition, in the condition shape (./condition). It is valid
 * exactly when its kind spelling passes the kinds' schema, so the shape
 * accepts what the kinds did and refuses what they refused. A kind (a row
 * from before the cutover, an old event, a model that still sends one) is
 * translated on the way in.
 */
export const triggerPredicateSchema = z.unknown().transform((p, ctx): When => {
  const legacyIn = !isShape(p);
  if (legacyIn && !legacyPredicateSchema.safeParse(p).success) {
    ctx.addIssue({ code: "custom", message: "Not a condition this app can check." });
    return z.NEVER;
  }
  const w = shapeOf(p);
  const spelled = w ? toLegacy(w) : null;
  if (!w || !spelled || (!legacyIn && !legacyPredicateSchema.safeParse(spelled).success)) {
    ctx.addIssue({ code: "custom", message: "Not a condition this app can check." });
    return z.NEVER;
  }
  return w;
});

/**
 * The condition as the model writes it: one flat object, the same one the
 * form builds. The measures and what each takes are listed from the catalog,
 * so the tool definition can't drift from the form. A model that still sends
 * a kind has it translated (and logged), never refused; the values are held
 * to the same ranges as before.
 */
export function predicateInputSchema() {
  const condition = z.object({
    watch: z.enum(Object.keys(MEASURES) as [Watch, ...Watch[]]).describe("The measure, from the list above."),
    is: z.enum(["below", "above", "near", "before", "after", "miss", "beat"]).optional().describe("Its direction, from the list; omit where a measure has one choice."),
    value: z.number().optional().describe("The number, in the measure's unit."),
    variable: z.string().optional().describe("What the number is measured from or stands in for, a date, or a filing, from the list."),
    settings: settingsSchema().optional().describe("The measure's own options, from the list."),
  });
  const group = z.object({
    match: z.enum(["all", "any"]).describe("all = every condition holds; any = one does."),
    conditions: z.array(condition).min(2).max(8),
  });
  return z
    .preprocess(
      (v) => {
        if (isShape(v) || !v || typeof v !== "object" || typeof (v as { kind?: unknown }).kind !== "string") return v;
        const w = shapeOf(v);
        if (w) console.info(`[triggers] a model sent the kind ${(v as { kind: string }).kind}; translated`);
        return w ?? v;
      },
      z
        .union([condition, z.object({ match: group.shape.match, conditions: z.array(z.union([condition, group])).min(2).max(8) })])
        .describe(`One condition, or { match, conditions } for two or more. ${measureGuide()}`),
    )
    .superRefine((w, ctx) => {
      const spelled = isShape(w) ? toLegacy(w) : null;
      if (!spelled || !legacyPredicateSchema.safeParse(spelled).success) {
        ctx.addIssue({ code: "custom", message: "Not a condition this app can check: see the measures and what each takes." });
      }
    });
}

/** Each measure in one line: its directions, its number, its variables and settings. */
function measureGuide(): string {
  const line = (m: (typeof MEASURES)[Watch]) => {
    const is = m.buttons ? ` is ${m.buttons.map((b) => b.is).join("|")};` : "";
    const unit = m.value.none ? "" : ` value ${m.value.prefix === "$" ? "in dollars" : (m.value.suffix ?? "a number")};`;
    const vars = m.variables
      ? ` ${m.variables.mode === "replace" ? "or variable" : "variable"} ${variableList(m.variables.options.map((o) => o.id))};`
      : "";
    const settings = (m.settings ?? []).map((s) => `${s.key}${s.options ? `=${s.options.map((o) => String(o.value)).join("|")}` : ""}`);
    const varSettings = [...new Set((m.variables?.options ?? []).flatMap((o) => (o.settings ?? []).map((s) => `${s.key} (with ${o.id})`)))];
    const all = [...settings, ...varSettings];
    return `${m.id} (${m.label}):${is}${unit}${vars}${all.length ? ` settings ${all.join(", ")};` : ""}`.replace(/;$/, ".");
  };
  return `Measures: ${Object.values(MEASURES).map(line).join(" ")}`;
}

/**
 * Every setting a measure or a variable takes, by key, from the catalog. The
 * SDK writes a record as an object that allows no keys, so the keys are
 * listed; which measure takes which is in the list above, and the save checks it.
 */
function settingsSchema() {
  const defs = Object.values(MEASURES).flatMap((m) => [
    ...(m.settings ?? []),
    ...(m.variables?.options ?? []).flatMap((o) => o.settings ?? []),
  ]);
  const shape: Record<string, z.ZodOptional<z.ZodTypeAny>> = {};
  for (const d of defs) {
    if (shape[d.key]) continue;
    const sample = d.options?.[0]?.value ?? d.default;
    shape[d.key] = (typeof sample === "boolean" ? z.boolean() : typeof sample === "string" ? z.string() : z.number()).optional();
  }
  return z.object(shape);
}

/** Variable ids, with the filing ones written as patterns. */
function variableList(ids: readonly string[]): string {
  const plain = ids.filter((id) => !/^(item|form):/.test(id));
  const filing = ids.some((id) => id.startsWith("item:")) ? ["item:<8-K item, e.g. 8.01>", "form:<form, e.g. S-3>"] : [];
  return [...plain, ...filing].join("|");
}

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
      "Don't re-fire this trigger more than once per N days. Omit it to use the default (an earnings result 7, price and chart conditions 1, a review schedule its own interval) — the right answer in almost every case. 0 is for EXIT triggers only; on any other action the runtime replaces it with the default.",
    ),
  lastFiredAt: z.string().datetime().optional(),
  firedFilings: z
    .array(z.string())
    .max(50)
    .optional()
    .describe("Evaluator-stamped on a filing trigger: the filings it has fired on. Do not set."),
  firedReports: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Evaluator-stamped on an earnings heads-up: the report dates it has fired for. Do not set."),
  writtenPrice: z
    .number()
    .positive()
    .optional()
    .describe("Server-stamped on a buy trigger when it is written. Do not set — any supplied value is overwritten."),
  writtenAt: z
    .string()
    .datetime()
    .optional()
    .describe("Server-stamped with writtenPrice. Do not set."),
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
 * The trigger shape the two thesis tools show the MODEL: `triggerSchema`
 * without the fields only the server writes. `id` is minted on the way in
 * (ops.ts: `trigger.id || mintId()`; record_thesis mints for the triggers
 * it stores directly), and the evaluator and the write paths stamp
 * `lastFiredAt`, `firedFilings`, `firedReports`, `writtenPrice`, `writtenAt`
 * and `source`. Each of those used to sit in the tool definition saying
 * "do not set" — and `id` carried its `.default(() => randomUUID())`, which
 * the SDK re-ran on every request, so every request's tool definition held
 * a different id. OpenAI caches an exact prefix, so the cache stopped at
 * that id on every step of every run (measured 2026-10-02: the same request
 * cached 71% with the random id and 97% without). The server schema above
 * is unchanged; this is only what the model is shown.
 */
export const triggerInputSchema = triggerSchema
  .omit({
    id: true,
    lastFiredAt: true,
    firedFilings: true,
    firedReports: true,
    writtenPrice: true,
    writtenAt: true,
    source: true,
  })
  .extend({ predicate: predicateInputSchema() });

export const triggersInputArraySchema = z
  .array(triggerInputSchema)
  .max(20)
  .describe(
    "Structured triggers attached to this thesis. Each is a (predicate, action, rationale) tuple the router evaluates deterministically. Capped at 20 per thesis to keep the matching loop bounded.",
  );

/**
 * One edit to an existing trigger, by id. The ONE shape for every caller that
 * edits a trigger — update_thesis and the thesis writer's submit_thesis both
 * use it. Two hand-written copies drifted on 2026-09-11 (the writer's `action`
 * was a free string, update_thesis's the enum) and a PRAX refresh passed the
 * writer's check, then failed at save with no retry (DAV-257).
 */
export const editTriggerOpSchema = z.looseObject({
  id: z.string().describe("The trigger's id, as shown on the thesis."),
  value: z.number().optional().describe("The new number, in the trigger's own unit (a price, a %, a count of days)."),
  variable: z.string().optional().describe("The new variable: what the number is measured from, or what stands in for it."),
  action: triggerActionSchema.optional(),
  fire_mode: z.enum(["TACTICAL", "DIRECT"]).optional(),
  rationale: z.string().optional().describe("REQUIRED when the value changes — the sentence moves with the number."),
  cooldown_days: z.number().int().min(0).max(90).optional(),
});

/**
 * An edit's number. A model that still sends the old `level` / `pct` / `days`
 * has it read as the value, and the old name kept as the unit it promised: an
 * edit naming `level` on a % trigger is refused, as it always was.
 */
export function editNumber(e: { value?: number } & Record<string, unknown>): { value?: number; unit?: "level" | "pct" | "days" } {
  if (e.value !== undefined) return { value: e.value };
  for (const unit of ["level", "pct", "days"] as const) {
    if (typeof e[unit] === "number") return { value: e[unit] as number, unit };
  }
  return {};
}

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
