/**
 * Zod schemas for triggers: the save gate every writer goes through (the
 * agents' tools, the trigger popover, the level rules) and the condition the
 * agents write. A condition is in the shape (./condition) and is valid when
 * its measure says so (`refusalOf`, from the catalog). A new measure is one
 * catalog entry; this file lists the measures from the catalog and needs no
 * change.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Condition, Direction, VariableId, Watch, When } from "./condition/types";
import type { MeasureDef } from "./condition/measure";
import { MEASURES, declaredOnly } from "./condition/catalog";
import { notACondition, refusalOf } from "./condition/valid";
import { rangeWords } from "./condition/range";

/**
 * A trigger's condition, in the condition shape (./condition): one its
 * measures can check, every number in range (from the catalog). Anything else
 * is refused with the measure's sentence naming the number; a removed
 * condition is never parsed as a live one.
 */
export const triggerPredicateSchema = z.unknown().transform((p, ctx): When => {
  const refused = refusalOf(p);
  if (refused) {
    ctx.addIssue({ code: "custom", message: refused });
    return z.NEVER;
  }
  return declaredOnly(p as When);
});

/**
 * The condition as the model writes it: one branch per measure, keyed on
 * `watch`, holding only the fields that measure takes (its buttons, its
 * value, what it is measured from, its own settings), so a model has nothing
 * to fill that the measure doesn't read. It is the form's fields: a price's
 * one input takes a dollar number or a line (the 50-day average), and a
 * filing's is which filing. Each value and setting says its range, read from
 * the catalog (./condition/range), and the save holds it to that range with
 * the same sentence. A field a branch doesn't list is dropped. The condition
 * is defined once per tool (`Condition`); `toStored` maps it onto the stored
 * shape. An old kind is refused with the list of measures.
 */
export function predicateInputSchema() {
  return (agentPredicate ??= buildPredicateInputSchema());
}
let agentPredicate: ReturnType<typeof buildPredicateInputSchema> | undefined;

function buildPredicateInputSchema() {
  const byWatch = Object.fromEntries(Object.values(MEASURES).map((m) => [m.id, measureBranch(m)])) as Record<Watch, z.ZodObject>;
  // A refusal says what's wrong: the field a measure is missing, or, for no measure at all, the list of them.
  const explain = (input: unknown): string => {
    const w = input && typeof input === "object" ? (input as { watch?: unknown }).watch : undefined;
    const branch = typeof w === "string" ? byWatch[w as Watch] : undefined;
    const issue = branch?.safeParse(input).error?.issues[0];
    if (!issue) return notACondition(input);
    const field = issue.path.join(".") || "condition";
    return `For ${w}, \`${field}\` is wrong: ${issue.message}. ${MEASURES[w as Watch].shape}`;
  };
  const branches = Object.values(byWatch) as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]];
  const condition = z.discriminatedUnion("watch", branches, { error: (iss) => explain(iss.input) }).meta({ id: "Condition" });
  const stored = condition.transform((c) => toStored(c as AgentCondition));
  const group = z.object({
    match: z.enum(["all", "any"]).describe("all = every condition holds; any = one does."),
    conditions: z.array(stored).min(2).max(8),
  });
  return z
    .union([stored, z.object({ match: group.shape.match, conditions: z.array(z.union([stored, group])).min(2).max(8) })], {
      error: (iss) => explain(iss.input),
    })
    .describe("One condition, or { match, conditions } for two or more. `watch` picks the measure; a condition takes only the fields listed under its measure.")
    .superRefine((w, ctx) => {
      const refused = refusalOf(w);
      if (refused) ctx.addIssue({ code: "custom", message: refused });
    })
    // A setting the measure doesn't take is dropped, never stored.
    .transform((w) => declaredOnly(w as When));
}

/** One measure's condition: its own fields only, each saying its range. */
function measureBranch(m: MeasureDef) {
  const shape: Record<string, z.ZodTypeAny> = { watch: z.literal(m.id).describe(m.shape) };
  if (m.buttons) shape.is = z.enum(m.buttons.map((b) => b.is) as [Direction, ...Direction[]]);
  // Only the variables this measure can read with one of its buttons, the same ones the form's {x} menu offers.
  const fitting = (m.variables?.options ?? []).filter((o) =>
    (m.buttons ?? [{ is: undefined }]).some((b) => m.fits({ watch: m.id, is: b.is, variable: o.id, value: 1 } as Condition)),
  );
  const ids = fitting.map((o) => o.id) as [VariableId, ...VariableId[]];
  const ranges = [m.value.ranges?.map((r) => `${r.range.what}: ${rangeWords(r.range)}`).join("; "), m.value.range && `otherwise ${rangeWords(m.value.range)}`]
    .filter(Boolean)
    .join("; ");
  if (m.value.none) {
    shape.value = z.enum(ids).describe("Which filing: a tier, an 8-K item or a form.");
  } else if (m.variables?.mode === "replace") {
    shape.value = z.union([z.number(), z.enum(ids)]).describe(`A dollar price (${ranges}), or a line instead of one.`);
  } else {
    const n = z.number().describe(`${m.value.suffix ?? "The number"}: ${ranges}.`);
    shape.value = m.value.zero != null ? n.optional() : n;
  }
  if (m.variables?.mode === "from") shape.variable = z.enum(ids).describe("What it is measured from.");
  // A variable's own settings belong to the measures it is measured from (the trail's, on a move), not to a line a price reads.
  const settings = [...(m.settings ?? []), ...(m.variables?.mode === "from" ? fitting.flatMap((o) => o.settings ?? []) : [])];
  if (settings.length) {
    const fields: Record<string, z.ZodTypeAny> = {};
    for (const d of settings) {
      if (fields[d.key]) continue;
      const sample = d.options?.[0]?.value ?? d.default;
      const type = d.options ? z.enum(d.options.map((o) => String(o.value)) as [string, ...string[]]) : typeof sample === "boolean" ? z.boolean() : typeof sample === "string" ? z.string() : z.number();
      const typed = d.options && typeof sample !== "string" ? (typeof sample === "boolean" ? z.boolean() : z.number()) : type;
      const owner = m.settings?.includes(d) ? "" : ` Only with variable ${fitting.find((o) => o.settings?.includes(d))?.id}.`;
      const said = d.options ? `One of ${d.options.map((o) => String(o.value)).join(", ")}.` : d.range ? `${rangeWords(d.range)}.` : "";
      const name = (d.label ?? d.range?.what ?? d.key).replace(/ \(\w+\)$/, "");
      fields[d.key] = typed.describe(`${name}: ${said}${owner}`).optional();
    }
    shape.settings = z.object(fields).optional();
  }
  return z.object(shape);
}

type AgentCondition = { watch: Watch; is?: Condition["is"]; value?: number | VariableId; variable?: VariableId; settings?: Record<string, unknown> };

/** The agents' condition, stored: a line or a filing in `value` is the stored `variable`; no empty settings. */
function toStored({ value, variable, settings, ...base }: AgentCondition): Condition {
  const rest = settings && Object.keys(settings).length ? { ...base, settings } : base;
  const mode = MEASURES[rest.watch]?.variables?.mode;
  if (mode === "replace") return { ...rest, ...(typeof value === "string" ? { variable: value } : value != null ? { value } : {}) } as Condition;
  return { ...rest, ...(value != null ? { value } : {}), ...(mode === "from" && variable != null ? { variable } : {}) } as Condition;
}

export const triggerActionSchema = z.enum([
  "REVIEW",
  "EXIT",
  "ENTER",
  "ADD",
  "TRIM",
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
      "The note the owner reads: why it's here and what you'll do when it fires. e.g. 'A close under the 50-day average on heavy volume breaks the pullback, so I sell.'",
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
