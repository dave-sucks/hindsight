/**
 * applyTriggerValueEdit — the principal edits a single trigger's value
 * directly in the thesis trigger popover (e.g. drag the stop from $375 → $400).
 *
 * Updates that trigger's numeric value in the thesis `triggers[]` array, and —
 * when the trigger is the canonical price stop or target — keeps `Thesis` +
 * the paired open `Position` stop/target in sync so the chart, run-summary,
 * and price-monitor don't drift from the pill. Writes one user-sourced
 * ThesisUpdate the agent reads back. No Alpaca, no approval: it's a DB write.
 *
 * "Canonical stop/target" by direction:
 *   LONG  → stop = EXIT + PRICE_BELOW ; target = (REVIEW|EXIT) + PRICE_ABOVE
 *   SHORT → stop = EXIT + PRICE_ABOVE ; target = (REVIEW|EXIT) + PRICE_BELOW
 */

import { prisma } from "@/lib/prisma";
import { triggerSchema, triggersArraySchema } from "@/lib/agent/triggers/schema";
import {
  editableTriggerField,
  withEditedValue,
} from "@/lib/agent/triggers/editable";
import {
  applyTriggerCooldownDefaults,
  defaultFireModeForAction,
} from "@/lib/agent/triggers/defaults";
import { predicateSentence } from "@/lib/agent/triggers/format";
import { isDirectEligiblePredicate } from "@/lib/agent/triggers/types";
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
 * `source` stamp. Only what surrounds this differs — the thesis path
 * mirrors canonical stop/target onto the Thesis + Position and writes an
 * audit row; the level path checks predicate eligibility and refuses a
 * duplicate bucket.
 *
 * Extracted 2026-08-16 so the two paths can't drift on validation, which
 * is the part where drift would be dangerous rather than merely untidy.
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
    fireMode,
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

export interface TriggerEditResult {
  ok: true;
  thesisId: string;
  triggerId: string;
  value: number;
  /** Set when the edit also moved the thesis stop / target. */
  synced: { stopLoss?: number; targetPrice?: number };
}

const EDITABLE_STATUSES = new Set(["HOLDING", "WATCHING"]);

export async function applyTriggerValueEdit(
  thesisId: string,
  triggerId: string,
  value: number,
  ctx: ThesisEditContext,
): Promise<TriggerEditResult> {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ThesisEditError("INVALID", "value must be a positive number.");
  }

  const thesis = await prisma.thesis.findUnique({
    where: { id: thesisId },
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      accountId: true,
      userId: true,
      targetPrice: true,
      stopLoss: true,
      triggers: true,
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

  const parsed = triggersArraySchema.safeParse(thesis.triggers);
  const triggers: Trigger[] = parsed.success ? (parsed.data as Trigger[]) : [];
  const target = triggers.find((t) => t.id === triggerId);
  if (!target) {
    throw new ThesisEditError(
      "NOT_FOUND",
      // Most likely cause since the cascade landed: the rung is INHERITED
      // (analyst / account / code default) and so isn't stored on this
      // thesis at all. The UI renders those read-only, so this is a
      // backstop for a stale client — but say why, not just "not found".
      `Trigger ${triggerId} is not stored on this thesis. Inherited triggers (analyst, account, or app default) are edited at the level that owns them.`,
    );
  }
  if (!editableTriggerField(target.predicate)) {
    throw new ThesisEditError("INVALID", `Trigger ${triggerId} has no editable value.`);
  }

  // The principal now owns this rung's VALUE, so stamp the source axis to
  // match (DAV-203: Dave's MU 814→935 edit kept showing source=AGENT in the
  // popover). Purely informational — nothing gates on source — and the
  // update_thesis wholesale-replace preserves the stamp on agent resends
  // ("resending a rung you didn't author doesn't make it yours").
  const nextTriggers = triggers.map((t) =>
    t.id === triggerId
      ? {
          ...t,
          predicate: withEditedValue(t.predicate, value),
          source: "PRINCIPAL" as const,
        }
      : t,
  );

  // Is this the canonical price stop / target? If so, mirror onto the thesis
  // (and the open position) so everything that reads Thesis.stopLoss/targetPrice
  // stays consistent with the pill.
  const isLong = thesis.direction !== "SHORT";
  const kind = target.predicate.kind;
  const isStop =
    target.action === "EXIT" &&
    ((isLong && kind === "PRICE_BELOW") || (!isLong && kind === "PRICE_ABOVE"));
  const isTarget =
    (target.action === "REVIEW" || target.action === "EXIT") &&
    ((isLong && kind === "PRICE_ABOVE") || (!isLong && kind === "PRICE_BELOW")) &&
    !isStop;
  // A PRICE_MOVE_PCT edit just updates the predicate's percent — no Thesis /
  // Position mirror (a daily-% move isn't a canonical stop/target level).

  const synced: { stopLoss?: number; targetPrice?: number } = {};
  if (isStop) synced.stopLoss = value;
  if (isTarget) synced.targetPrice = value;

  const analystId = thesis.researchRun?.agentConfigId ?? null;
  const position =
    thesis.status === "HOLDING"
      ? await prisma.position.findFirst({
          where: {
            // Scope to the thesis's own account + analyst so we never sync a
            // stop/target onto another account's or another analyst's open
            // position on the same ticker (e.g. paper vs live, or two analysts
            // both holding it). accountId is the hard boundary.
            accountId: thesis.accountId,
            symbol: thesis.ticker,
            status: "OPEN",
            ...(analystId ? { analystId } : {}),
          },
          orderBy: { openedAt: "desc" },
          select: { id: true },
        })
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.thesis.update({
      where: { id: thesis.id },
      data: {
        triggers: nextTriggers as unknown as object,
        ...(isStop ? { stopLoss: value } : {}),
        ...(isTarget ? { targetPrice: value } : {}),
      },
    });
    if (position && (isStop || isTarget)) {
      await tx.position.update({
        where: { id: position.id },
        data: {
          ...(isStop ? { stopLoss: value } : {}),
          ...(isTarget ? { targetPrice: value } : {}),
        },
      });
      await tx.positionEvent.create({
        data: {
          positionId: position.id,
          eventType: isStop ? "STOP_MOVED" : "TARGET_UPDATED",
          description: `Principal edit: ${isStop ? "stop" : "target"} → $${value}.`,
          priceAt: null,
        },
      });
    }
  });

  const field = editableTriggerField(target.predicate)!;
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: `Principal edited ${thesis.ticker} trigger — ${field.label} ${value}`,
    rationale: `[USER] Principal set ${field.label} = ${value} on the "${target.action}" trigger directly. Honor it; don't re-propose against it unless the thesis materially changes.`,
    fieldChanges: {
      source: { from: null, to: "USER" },
      ...(isStop ? { stopLoss: { from: thesis.stopLoss ?? null, to: value } } : {}),
      ...(isTarget ? { targetPrice: { from: thesis.targetPrice ?? null, to: value } } : {}),
    },
    runId: null,
    tradeId: position?.id,
  });

  return { ok: true, thesisId: thesis.id, triggerId, value, synced };
}

// ── Add / delete / fire-mode ────────────────────────────────────────────
//
// The trigger popover edits existing triggers (value + fire mode).
// applyTriggerAdd / applyTriggerDelete extend that to full UI management:
// mint a NEW price / % trigger on any action group, or remove one.
// Same invariants the agent write-paths protect — every added trigger is
// validated by the same Zod schema (invalid triggers are silently dropped
// at evaluation, so we reject them up front), cooldown-defaulted (the
// `cooldownDays:0`-reserved-for-EXIT rule), and — when it's the canonical
// price stop / target — mirrored onto Thesis + the open Position so the
// chart line, run-summary, and evaluator never drift from the pill.

/** Predicate kinds the UI add-form can mint: a fixed price level (Target
 *  Price), a directional daily % move (Movement Amount), a cumulative % vs
 *  the position's entry (Gain from entry), or a give-back % off the tracked
 *  high (Trailing from high). All exist across the evaluator/format switches
 *  — no new predicate KIND. The last two are position-scoped (they read
 *  avgCost / peakPrice), so applyTriggerAdd additionally requires an open
 *  position for them (see the POSITION_SCOPED gate below). */
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

  const thesis = await prisma.thesis.findUnique({
    where: { id: thesisId },
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      accountId: true,
      userId: true,
      targetPrice: true,
      stopLoss: true,
      triggers: true,
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

  const isLong = thesis.direction !== "SHORT";

  // Resolve the paired open position once — needed for the canonical
  // stop/target mirror and the DIRECT held-only check.
  const analystId = thesis.researchRun?.agentConfigId ?? null;
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
          select: { id: true },
        })
      : null;

  // Gain-from-entry / trailing-from-high measure off the open position's
  // avgCost / peakPrice — un-held they evaluate false forever (a silent
  // missed-trigger, never an error), so refuse to mint them without a
  // position. The UI hides these criteria on non-HOLDING theses; this is
  // the backend backstop.
  if (POSITION_SCOPED_PREDICATE_KINDS.has(input.predicate.kind) && !position) {
    throw new ThesisEditError(
      "INVALID",
      "Gain-from-entry and trailing-from-high triggers measure off the open position — they can only be added to a held (HOLDING) thesis.",
    );
  }

  // DIRECT (close without an agent) is only coherent on an EXIT of a held
  // position. Anywhere else, fall back to the judgment-bearing TACTICAL path.
  let fireMode = input.fireMode ?? defaultFireModeForAction(input.action);
  if (fireMode === "DIRECT" && (input.action !== "EXIT" || !position)) {
    fireMode = "TACTICAL";
  }

  const newTrigger = buildPrincipalTrigger({
    ...input,
    defaultRationale: addedTriggerRationale(input.action, input.predicate),
    // A DIRECT close needs a position to close and a deterministic
    // predicate; `fireMode` was already narrowed above.
    allowDirect: fireMode === "DIRECT",
  });

  // Re-parse the existing array. If it fails to parse, REFUSE — falling back
  // to [] here would persist only the new trigger and silently destroy every
  // existing one (stops, targets, review dates). (The read-only evaluator can
  // fall back to []; a write path must not.) The sibling edit/delete paths
  // bail earlier via a "trigger not found" lookup; add has no such guard, so
  // it needs this one.
  const existing = triggersArraySchema.safeParse(thesis.triggers);
  if (!existing.success) {
    throw new ThesisEditError(
      "INVALID",
      "This thesis's existing triggers couldn't be parsed — refusing to add (it would overwrite them). Fix the thesis triggers first.",
    );
  }
  const triggers = existing.data as Trigger[];
  const nextTriggers = [...triggers, newTrigger];
  // Whole-array validation enforces the 20-cap before we persist.
  if (!triggersArraySchema.safeParse(nextTriggers).success) {
    throw new ThesisEditError(
      "INVALID",
      "Adding this trigger would exceed the 20-trigger cap on a thesis.",
    );
  }

  // Canonical stop / target classification (mirror onto Thesis + Position),
  // identical to applyTriggerValueEdit.
  const kind = newTrigger.predicate.kind;
  const level =
    kind === "PRICE_ABOVE" || kind === "PRICE_BELOW"
      ? newTrigger.predicate.level
      : null;
  const isStop =
    newTrigger.action === "EXIT" &&
    ((isLong && kind === "PRICE_BELOW") || (!isLong && kind === "PRICE_ABOVE"));
  const isTarget =
    (newTrigger.action === "REVIEW" || newTrigger.action === "EXIT") &&
    ((isLong && kind === "PRICE_ABOVE") || (!isLong && kind === "PRICE_BELOW")) &&
    !isStop;
  const synced: { stopLoss?: number; targetPrice?: number } = {};
  if (isStop && level != null) synced.stopLoss = level;
  if (isTarget && level != null) synced.targetPrice = level;

  await prisma.$transaction(async (tx) => {
    await tx.thesis.update({
      where: { id: thesis.id },
      data: {
        triggers: nextTriggers as unknown as object,
        ...(synced.stopLoss != null ? { stopLoss: synced.stopLoss } : {}),
        ...(synced.targetPrice != null ? { targetPrice: synced.targetPrice } : {}),
      },
    });
    if (position) {
      const posData: { stopLoss?: number; targetPrice?: number } = {};
      if (synced.stopLoss != null) posData.stopLoss = synced.stopLoss;
      if (synced.targetPrice != null) posData.targetPrice = synced.targetPrice;
      if (Object.keys(posData).length > 0) {
        await tx.position.update({ where: { id: position.id }, data: posData });
      }
      await tx.positionEvent.create({
        data: {
          positionId: position.id,
          eventType: isStop ? "STOP_MOVED" : isTarget ? "TARGET_UPDATED" : "MODIFIED",
          description: `Principal added trigger: ${predicateSentence(newTrigger.predicate)} → ${newTrigger.action.toLowerCase()}${fireMode === "DIRECT" ? " (direct exit)" : ""}.`,
          priceAt: null,
        },
      });
    }
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: `Principal added ${thesis.ticker} trigger — ${predicateSentence(newTrigger.predicate)} → ${newTrigger.action.toLowerCase()}`,
    rationale: `[USER] Added a "${newTrigger.action}" trigger (${predicateSentence(newTrigger.predicate)}, fire mode ${fireMode}). Honor it; it's a standing instruction.`,
    fieldChanges: {
      source: { from: null, to: "USER" },
      ...(synced.stopLoss != null
        ? { stopLoss: { from: thesis.stopLoss ?? null, to: synced.stopLoss } }
        : {}),
      ...(synced.targetPrice != null
        ? { targetPrice: { from: thesis.targetPrice ?? null, to: synced.targetPrice } }
        : {}),
    },
    runId: null,
    tradeId: position?.id,
  });

  return { ok: true, thesisId: thesis.id, trigger: newTrigger, synced };
}

export interface TriggerDeleteResult {
  ok: true;
  thesisId: string;
  triggerId: string;
}

/**
 * applyTriggerDelete — the principal removes a trigger from the popover.
 *
 * Removes it from `triggers[]` and writes one [USER] ThesisUpdate. We
 * intentionally LEAVE `Thesis.stopLoss` / `targetPrice` (and the Position's)
 * intact: deleting the trigger removes the automated ACTION, not the
 * documented price level (the chart line + run-summary still reflect the
 * plan). To change a level, edit the trigger; to drop the level entirely is
 * a separate explicit edit.
 */
export async function applyTriggerDelete(
  thesisId: string,
  triggerId: string,
  ctx: ThesisEditContext,
): Promise<TriggerDeleteResult> {
  const thesis = await prisma.thesis.findUnique({
    where: { id: thesisId },
    select: {
      id: true,
      ticker: true,
      status: true,
      accountId: true,
      triggers: true,
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

  const parsed = triggersArraySchema.safeParse(thesis.triggers);
  const triggers: Trigger[] = parsed.success ? (parsed.data as Trigger[]) : [];
  const target = triggers.find((t) => t.id === triggerId);
  if (!target) {
    throw new ThesisEditError(
      "NOT_FOUND",
      // Most likely cause since the cascade landed: the rung is INHERITED
      // (analyst / account / code default) and so isn't stored on this
      // thesis at all. The UI renders those read-only, so this is a
      // backstop for a stale client — but say why, not just "not found".
      `Trigger ${triggerId} is not stored on this thesis. Inherited triggers (analyst, account, or app default) are edited at the level that owns them.`,
    );
  }
  const nextTriggers = triggers.filter((t) => t.id !== triggerId);

  const analystId = thesis.researchRun?.agentConfigId ?? null;
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
          select: { id: true },
        })
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.thesis.update({
      where: { id: thesis.id },
      data: { triggers: nextTriggers as unknown as object },
    });
    if (position) {
      await tx.positionEvent.create({
        data: {
          positionId: position.id,
          eventType: "MODIFIED",
          description: `Principal removed trigger: ${predicateSentence(target.predicate)} → ${target.action.toLowerCase()}.`,
          priceAt: null,
        },
      });
    }
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: `Principal removed ${thesis.ticker} trigger — ${predicateSentence(target.predicate)} → ${target.action.toLowerCase()}`,
    rationale: `[USER] Removed the "${target.action}" trigger (${predicateSentence(target.predicate)}). Don't re-create it unless the thesis materially changes.`,
    fieldChanges: { source: { from: null, to: "USER" } },
    runId: null,
    tradeId: position?.id,
  });

  return { ok: true, thesisId: thesis.id, triggerId };
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
  const thesis = await prisma.thesis.findUnique({
    where: { id: thesisId },
    select: {
      id: true,
      ticker: true,
      status: true,
      accountId: true,
      triggers: true,
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

  const parsed = triggersArraySchema.safeParse(thesis.triggers);
  const triggers: Trigger[] = parsed.success ? (parsed.data as Trigger[]) : [];
  const target = triggers.find((t) => t.id === triggerId);
  if (!target) {
    throw new ThesisEditError(
      "NOT_FOUND",
      // Most likely cause since the cascade landed: the rung is INHERITED
      // (analyst / account / code default) and so isn't stored on this
      // thesis at all. The UI renders those read-only, so this is a
      // backstop for a stale client — but say why, not just "not found".
      `Trigger ${triggerId} is not stored on this thesis. Inherited triggers (analyst, account, or app default) are edited at the level that owns them.`,
    );
  }
  if (
    fireMode === "DIRECT" &&
    (target.action !== "EXIT" ||
      thesis.status !== "HOLDING" ||
      !isDirectEligiblePredicate(target.predicate.kind))
  ) {
    throw new ThesisEditError(
      "INVALID",
      "Direct exit is only available on a price/trailing EXIT trigger of a held position — judgment-bearing exits (earnings, signals, etc.) must wake a tactical run.",
    );
  }

  const prevMode = target.fireMode ?? "TACTICAL";
  // Stamp source too — the mode is part of the rung's definition, and the
  // principal just chose it (same DAV-203 fix as the value edit above).
  const nextTriggers = triggers.map((t) =>
    t.id === triggerId ? { ...t, fireMode, source: "PRINCIPAL" as const } : t,
  );

  await prisma.thesis.update({
    where: { id: thesis.id },
    data: { triggers: nextTriggers as unknown as object },
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: `Principal set ${thesis.ticker} trigger fire mode → ${fireMode}`,
    rationale: `[USER] Set the "${target.action}" trigger (${predicateSentence(target.predicate)}) to fire mode ${fireMode}${fireMode === "DIRECT" ? " — close directly on fire, no tactical run (still approval-gated)." : " — wake a tactical run on fire."}`,
    fieldChanges: {
      source: { from: null, to: "USER" },
      fireMode: { from: prevMode, to: fireMode },
    },
    runId: null,
  });

  return { ok: true, thesisId: thesis.id, triggerId, fireMode };
}
