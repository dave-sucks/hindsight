/**
 * The principal's trigger edits — add, edit a value, remove, change the
 * fire mode — from the thesis trigger popover.
 *
 * Every one of these is ONE trigger op through `applyTriggerOps`
 * (lib/agent/triggers/ops.ts), the same function the agent's
 * `update_thesis` runs its ops through. One write path, two callers — the
 * same principle as `positionBand()` for sizing (DAV-242). What differs is
 * the actor: the principal is exempt from the ratchet (only a person lowers
 * a safety line), and the rationale on a level change is written for them.
 *
 * Each call loads the thesis, applies the op, persists the resulting
 * triggers with the plan columns derived from them, mirrors a moved stop /
 * target onto the open Position, and writes one user-sourced ThesisUpdate
 * whose `fieldChanges.triggerOps` IS the change. No Alpaca, no approval.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { triggerSchema, triggersArraySchema } from "@/lib/agent/triggers/schema";
import { editableTriggerField } from "@/lib/agent/triggers/editable";
import {
  applyTriggerCooldownDefaults,
  defaultFireModeForAction,
} from "@/lib/agent/triggers/defaults";
import { predicateSentence } from "@/lib/agent/triggers/format";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import {
  acceptedOps,
  applyTriggerOps,
  checkLadder,
  type TriggerOp,
} from "@/lib/agent/triggers/ops";
import type {
  Trigger,
  TriggerAction,
  TriggerPredicate,
} from "@/lib/agent/triggers/types";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

export interface ThesisEditContext {
  accountId: string;
  actorUserId: string;
}

export type ThesisEditCode = "NOT_FOUND" | "FORBIDDEN" | "NOT_EDITABLE" | "INVALID";

export class ThesisEditError extends Error {
  code: ThesisEditCode;
  constructor(code: ThesisEditCode, message: string) {
    super(message);
    this.name = "ThesisEditError";
    this.code = code;
  }
}

/**
 * Build ONE validated, principal-authored trigger from UI input.
 *
 * Shared by the thesis write path (below) and the account/analyst write
 * path (./level-triggers): both run the same Zod gate, the same DIRECT
 * fire-mode restriction, the same cooldown discipline and the same
 * `source` stamp.
 */
export function buildPrincipalTrigger(input: {
  action: TriggerAction;
  predicate: TriggerPredicate;
  fireMode?: "TACTICAL" | "DIRECT";
  rationale?: string;
  cooldownDays?: number;
  /** Fallback prose when the caller supplies no rationale. */
  defaultRationale: string;
  /**
   * Whether a DIRECT fire mode is permissible here at all. The thesis
   * path also requires an open position; the level path has none to
   * check, so it passes the predicate gate alone.
   */
  allowDirect: boolean;
}): Trigger {
  let fireMode = input.fireMode ?? defaultFireModeForAction(input.action);
  if (fireMode === "DIRECT" && !input.allowDirect) fireMode = "TACTICAL";

  const parsed = triggerSchema.safeParse({
    predicate: input.predicate,
    action: input.action,
    rationale: input.rationale?.trim() || input.defaultRationale,
    ...(input.cooldownDays != null ? { cooldownDays: input.cooldownDays } : {}),
    // fireMode only means something on EXIT (DIRECT vs wake-the-agent). On
    // any other action the field is inert — a REVIEW fire batches into the
    // next daily run regardless — so don't stamp a label that claims a
    // tactical wake that never happens (DAV-226). Absent ⇒ TACTICAL.
    ...(input.action === "EXIT" ? { fireMode } : {}),
  });
  if (!parsed.success) {
    throw new ThesisEditError(
      "INVALID",
      `Invalid trigger: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  // Cooldown discipline (0-on-non-EXIT → per-kind default), then
  // source=PRINCIPAL — server-owned, never trusted from the request body.
  return {
    ...applyTriggerCooldownDefaults([parsed.data as Trigger])[0],
    source: "PRINCIPAL",
  };
}

/** Map a ThesisEditError code → HTTP status. Shared by every trigger route. */
export function statusForEditError(code: ThesisEditCode): number {
  return code === "NOT_FOUND"
    ? 404
    : code === "FORBIDDEN"
      ? 403
      : code === "NOT_EDITABLE"
        ? 409
        : 400;
}

const EDITABLE_STATUSES = new Set(["HOLDING", "WATCHING"]);

interface EditableThesis {
  id: string;
  ticker: string;
  direction: string | null;
  status: string;
  targetPrice: number | null;
  stopLoss: number | null;
  entryPrice: number | null;
  triggers: Trigger[];
  inherited: ReturnType<typeof resolveThesisLadder>;
  position: { id: string; avgCost: number | null } | null;
}

async function loadEditableThesis(
  thesisId: string,
  ctx: ThesisEditContext,
): Promise<EditableThesis> {
  const thesis = await prisma.thesis.findUnique({
    where: { id: thesisId },
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      horizon: true,
      accountId: true,
      targetPrice: true,
      stopLoss: true,
      entryPrice: true,
      triggers: true,
      triggerState: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) throw new ThesisEditError("NOT_FOUND", `Thesis ${thesisId} not found.`);
  if (thesis.accountId !== ctx.accountId) {
    throw new ThesisEditError("FORBIDDEN", `Thesis ${thesisId} is not on this account.`);
  }
  if (!EDITABLE_STATUSES.has(thesis.status)) {
    throw new ThesisEditError(
      "NOT_EDITABLE",
      `Thesis ${thesisId} is ${thesis.status} — only HOLDING/WATCHING are editable.`,
    );
  }
  // Refuse rather than fall back to [] — a write that "fixed" an
  // unparseable list by dropping it would silently destroy every stop and
  // target on the thesis. (The read-only evaluator can fall back; a write
  // path must not.)
  const parsed = triggersArraySchema.safeParse(thesis.triggers ?? []);
  if (!parsed.success) {
    throw new ThesisEditError(
      "INVALID",
      "This thesis's existing triggers couldn't be parsed — refusing to edit (it would overwrite them). Fix the thesis triggers first.",
    );
  }

  const analystId = thesis.researchRun?.agentConfigId ?? null;
  const levelSources = analystId
    ? (await loadLevelSources([analystId])).get(analystId)
    : undefined;
  const inherited = resolveThesisLadder(
    { triggers: [], triggerState: {}, status: thesis.status, horizon: thesis.horizon },
    levelSources,
    `thesis=${thesisId}`,
  );

  // Scoped to the thesis's own account + analyst so we never sync a level
  // onto another account's or another analyst's open position on the same
  // ticker (paper vs live, or two analysts both holding it).
  const position =
    thesis.status === "HOLDING"
      ? await prisma.position.findFirst({
          where: {
            accountId: thesis.accountId,
            symbol: thesis.ticker,
            status: "OPEN",
            ...(analystId ? { analystId } : {}),
          },
          orderBy: { openedAt: "desc" },
          select: { id: true, avgCost: true },
        })
      : null;

  return {
    id: thesis.id,
    ticker: thesis.ticker,
    direction: thesis.direction,
    status: thesis.status,
    targetPrice: thesis.targetPrice != null ? Number(thesis.targetPrice) : null,
    stopLoss: thesis.stopLoss != null ? Number(thesis.stopLoss) : null,
    entryPrice: thesis.entryPrice != null ? Number(thesis.entryPrice) : null,
    triggers: parsed.data as Trigger[],
    inherited,
    position: position
      ? { id: position.id, avgCost: position.avgCost != null ? Number(position.avgCost) : null }
      : null,
  };
}

interface OpOutcome {
  thesis: EditableThesis;
  /** The id the op landed on — an add into an occupied bucket lands on the existing trigger. */
  id: string;
  triggers: Trigger[];
  /** Plan columns that moved with the op. */
  synced: { stopLoss?: number; targetPrice?: number };
}

/**
 * Apply one principal op and persist it. The op is built after the load so
 * it can read the trigger it targets (a value edit needs the predicate kind).
 */
async function runPrincipalOp(
  thesisId: string,
  ctx: ThesisEditContext,
  buildOp: (thesis: EditableThesis) => TriggerOp,
  audit: (thesis: EditableThesis, id: string) => { summary: string; rationale: string },
): Promise<OpOutcome> {
  const thesis = await loadEditableThesis(thesisId, ctx);
  const applied = applyTriggerOps({
    stored: thesis.triggers,
    inherited: thesis.inherited,
    ops: [buildOp(thesis)],
    direction: thesis.direction,
    status: thesis.status,
    actor: "PRINCIPAL",
    mintId: () => randomUUID(),
  });
  const result = applied.results[0];
  if (!result?.ok) {
    const reason = result?.reason ?? "Nothing to change.";
    throw new ThesisEditError(
      /is not on this thesis|is set at the/.test(reason) ? "NOT_FOUND" : "INVALID",
      reason,
    );
  }
  const check = checkLadder({
    triggers: applied.triggers,
    inherited: thesis.inherited,
    direction: thesis.direction,
    status: thesis.status,
    entryPrice: thesis.position?.avgCost ?? thesis.entryPrice,
    avgCost: thesis.position?.avgCost,
  });
  if (!check.ok) throw new ThesisEditError("INVALID", check.message);

  const held = thesis.status === "HOLDING";
  const synced: { stopLoss?: number; targetPrice?: number } = {};
  if (check.columns.stopLoss != null && check.columns.stopLoss !== thesis.stopLoss)
    synced.stopLoss = check.columns.stopLoss;
  if (check.columns.targetPrice != null && check.columns.targetPrice !== thesis.targetPrice)
    synced.targetPrice = check.columns.targetPrice;

  const { summary, rationale } = audit(thesis, result.id);
  await prisma.$transaction(async (tx) => {
    await tx.thesis.update({
      where: { id: thesis.id },
      data: {
        triggers: applied.triggers as unknown as object,
        targetPrice: check.columns.targetPrice,
        stopLoss: check.columns.stopLoss,
        // Held: the entry is the fill, written once by the buy.
        ...(held ? {} : { entryPrice: check.columns.entryPrice }),
      },
    });
    if (thesis.position) {
      if (synced.stopLoss != null || synced.targetPrice != null) {
        await tx.position.update({
          where: { id: thesis.position.id },
          data: {
            ...(synced.stopLoss != null ? { stopLoss: synced.stopLoss } : {}),
            ...(synced.targetPrice != null ? { targetPrice: synced.targetPrice } : {}),
          },
        });
      }
      await tx.positionEvent.create({
        data: {
          positionId: thesis.position.id,
          eventType:
            synced.stopLoss != null
              ? "STOP_MOVED"
              : synced.targetPrice != null
                ? "TARGET_UPDATED"
                : "MODIFIED",
          description: `Principal: ${result.text}.`,
          priceAt: null,
        },
      });
    }
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary,
    rationale,
    fieldChanges: {
      source: { from: null, to: "USER" },
      triggerOps: { from: null, to: acceptedOps(applied.results) },
      ...(check.columns.stopLoss !== thesis.stopLoss
        ? { stopLoss: { from: thesis.stopLoss, to: check.columns.stopLoss } }
        : {}),
      ...(check.columns.targetPrice !== thesis.targetPrice
        ? { targetPrice: { from: thesis.targetPrice, to: check.columns.targetPrice } }
        : {}),
    },
    runId: null,
    tradeId: thesis.position?.id,
  });

  return { thesis, id: result.id, triggers: applied.triggers, synced };
}

export interface TriggerEditResult {
  ok: true;
  thesisId: string;
  triggerId: string;
  value: number;
  /** Set when the edit also moved the thesis stop / target. */
  synced: { stopLoss?: number; targetPrice?: number };
}

/**
 * applyTriggerValueEdit — the principal edits a single trigger's value
 * directly in the trigger popover (e.g. drag the stop from $375 → $400).
 */
export async function applyTriggerValueEdit(
  thesisId: string,
  triggerId: string,
  value: number,
  ctx: ThesisEditContext,
): Promise<TriggerEditResult> {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ThesisEditError("INVALID", "value must be a positive number.");
  }
  const outcome = await runPrincipalOp(
    thesisId,
    ctx,
    (thesis) => {
      const target = thesis.triggers.find((t) => t.id === triggerId);
      const field = target ? editableTriggerField(target.predicate) : null;
      if (target && !field) {
        throw new ThesisEditError("INVALID", `Trigger ${triggerId} has no editable value.`);
      }
      const kind = target?.predicate.kind;
      return kind === "PRICE_ABOVE" || kind === "PRICE_BELOW"
        ? { op: "edit", id: triggerId, level: value }
        : { op: "edit", id: triggerId, pct: value };
    },
    (thesis) => {
      const target = thesis.triggers.find((t) => t.id === triggerId)!;
      const label = editableTriggerField(target.predicate)?.label ?? "value";
      return {
        summary: `Principal edited ${thesis.ticker} trigger — ${label} ${value}`,
        rationale: `[USER] Principal set ${label} = ${value} on the "${target.action}" trigger directly. Honor it; don't re-propose against it unless the thesis materially changes.`,
      };
    },
  );
  return { ok: true, thesisId: outcome.thesis.id, triggerId, value, synced: outcome.synced };
}

// ── Add / delete / fire-mode ────────────────────────────────────────────

/** Predicate kinds the UI add-form can mint: a fixed price level (Target
 *  Price), a directional daily % move (Movement Amount), a cumulative % vs
 *  the position's entry (Gain from entry), or a give-back % off the tracked
 *  high (Trailing from high). The last two are position-scoped (they read
 *  avgCost / peakPrice), so the add path additionally requires an open
 *  position for them. */
const ADDABLE_PREDICATE_KINDS = new Set<TriggerPredicate["kind"]>([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PRICE_MOVE_PCT",
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
]);

/** Kinds that evaluate off the open position (avgCost / peakPrice). With no
 *  position they return false forever — a silent missed-trigger footgun —
 *  so the add path refuses to mint them on an un-held thesis. */
const POSITION_SCOPED_PREDICATE_KINDS = new Set<TriggerPredicate["kind"]>([
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
]);

export interface TriggerAddInput {
  action: TriggerAction;
  predicate: TriggerPredicate;
  /** Omit ⇒ defaultFireModeForAction (EXIT→DIRECT, else TACTICAL). */
  fireMode?: "TACTICAL" | "DIRECT";
  /** Omit ⇒ a generated default sentence. */
  rationale?: string;
  /** Omit ⇒ per-predicate-kind default via applyTriggerCooldownDefaults. */
  cooldownDays?: number;
}

export interface TriggerAddResult {
  ok: true;
  thesisId: string;
  /** The trigger as stored — an add into an occupied bucket edits the existing one. */
  trigger: Trigger;
  /** Set when the new trigger is the canonical stop / target and moved it. */
  synced: { stopLoss?: number; targetPrice?: number };
}

/** A friendly rationale for a principal-added trigger when none was supplied. */
function addedTriggerRationale(
  action: TriggerAction,
  predicate: TriggerPredicate,
): string {
  const cond = predicateSentence(predicate).toLowerCase();
  switch (action) {
    case "EXIT":
      return `Exit when ${cond} (set by principal).`;
    case "ENTER":
      return `Consider entry when ${cond} (set by principal).`;
    case "ADD":
      return `Scale in when ${cond} (set by principal).`;
    case "TRIM":
      return `Trim when ${cond} (set by principal).`;
    case "MOVE_STOP":
      return `Move the stop when ${cond} (set by principal).`;
    case "REVIEW":
    default:
      return `Review when ${cond} (set by principal).`;
  }
}

export async function applyTriggerAdd(
  thesisId: string,
  input: TriggerAddInput,
  ctx: ThesisEditContext,
): Promise<TriggerAddResult> {
  if (!ADDABLE_PREDICATE_KINDS.has(input.predicate.kind)) {
    throw new ThesisEditError(
      "INVALID",
      `Can only add a target-price, movement-amount, gain-from-entry, or trailing-from-high trigger (got ${input.predicate.kind}).`,
    );
  }
  let fireMode = input.fireMode ?? defaultFireModeForAction(input.action);
  const outcome = await runPrincipalOp(
    thesisId,
    ctx,
    (thesis) => {
      if (POSITION_SCOPED_PREDICATE_KINDS.has(input.predicate.kind) && !thesis.position) {
        throw new ThesisEditError(
          "INVALID",
          "Gain-from-entry and trailing-from-high triggers measure off the open position — they can only be added to a held (HOLDING) thesis.",
        );
      }
      // DIRECT (close without an agent) is only coherent on an EXIT of a
      // held position. Anywhere else, fall back to the judgment-bearing
      // TACTICAL path.
      if (fireMode === "DIRECT" && (input.action !== "EXIT" || !thesis.position)) {
        fireMode = "TACTICAL";
      }
      return {
        op: "add",
        trigger: buildPrincipalTrigger({
          ...input,
          fireMode,
          defaultRationale: addedTriggerRationale(input.action, input.predicate),
          allowDirect: fireMode === "DIRECT",
        }),
      };
    },
    (thesis) => ({
      summary: `Principal added ${thesis.ticker} trigger — ${predicateSentence(input.predicate)} → ${input.action.toLowerCase()}`,
      // Fire mode is only mentioned where it means something (EXIT). A
      // REVIEW trigger's fire batches into the next daily run — naming a
      // fire mode on it would claim a tactical wake that never happens
      // (DAV-226).
      rationale: `[USER] Added a "${input.action}" trigger (${predicateSentence(input.predicate)}${input.action === "EXIT" ? `, fire mode ${fireMode}` : ""}). Honor it; it's a standing instruction.`,
    }),
  );
  const trigger = outcome.triggers.find((t) => t.id === outcome.id)!;
  return { ok: true, thesisId: outcome.thesis.id, trigger, synced: outcome.synced };
}

export interface TriggerDeleteResult {
  ok: true;
  thesisId: string;
  triggerId: string;
}

/**
 * applyTriggerDelete — the principal removes a trigger from the popover.
 * The plan columns follow the trigger: removing the floor clears the stop.
 */
export async function applyTriggerDelete(
  thesisId: string,
  triggerId: string,
  ctx: ThesisEditContext,
): Promise<TriggerDeleteResult> {
  const outcome = await runPrincipalOp(
    thesisId,
    ctx,
    () => ({ op: "remove", id: triggerId }),
    (thesis) => {
      const target = thesis.triggers.find((t) => t.id === triggerId)!;
      return {
        summary: `Principal removed ${thesis.ticker} trigger — ${predicateSentence(target.predicate)} → ${target.action.toLowerCase()}`,
        rationale: `[USER] Removed the "${target.action}" trigger (${predicateSentence(target.predicate)}). Don't re-create it unless the thesis materially changes.`,
      };
    },
  );
  return { ok: true, thesisId: outcome.thesis.id, triggerId };
}

export interface TriggerFireModeChangeResult {
  ok: true;
  thesisId: string;
  triggerId: string;
  fireMode: "TACTICAL" | "DIRECT";
}

/**
 * applyTriggerFireModeChange — the principal flips a trigger between waking a
 * tactical run (TACTICAL) and closing directly with no agent (DIRECT), from
 * the popover's "On fire" control. DIRECT is only valid on an EXIT of a held
 * position (nothing deterministic to execute otherwise).
 */
export async function applyTriggerFireModeChange(
  thesisId: string,
  triggerId: string,
  fireMode: "TACTICAL" | "DIRECT",
  ctx: ThesisEditContext,
): Promise<TriggerFireModeChangeResult> {
  const outcome = await runPrincipalOp(
    thesisId,
    ctx,
    () => ({ op: "edit", id: triggerId, fireMode }),
    (thesis) => {
      const target = thesis.triggers.find((t) => t.id === triggerId)!;
      return {
        summary: `Principal set ${thesis.ticker} trigger fire mode → ${fireMode}`,
        rationale: `[USER] Set the "${target.action}" trigger (${predicateSentence(target.predicate)}) to fire mode ${fireMode}${fireMode === "DIRECT" ? " — close directly on fire, no tactical run (still approval-gated)." : " — wake a tactical run on fire."}`,
      };
    },
  );
  return { ok: true, thesisId: outcome.thesis.id, triggerId, fireMode };
}
