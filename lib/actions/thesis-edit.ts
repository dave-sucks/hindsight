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
import { getLatestPrices } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";

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
    throw new ThesisEditError("NOT_FOUND", `Trigger ${triggerId} not found on thesis.`);
  }
  if (!editableTriggerField(target.predicate)) {
    throw new ThesisEditError("INVALID", `Trigger ${triggerId} has no editable value.`);
  }

  const nextTriggers = triggers.map((t) =>
    t.id === triggerId ? { ...t, predicate: withEditedValue(t.predicate, value) } : t,
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
  // Editing a TRAILING_STOP's percent just updates the predicate — the
  // trigger-evaluator reads the new pct off the peak on its next pass. No
  // Position write (no exitStrategy side-channel; trailing is a normal trigger).

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

/** Default trail percent when the principal switches a stop to trailing without specifying one. Mirrors trade-exit.ts's `trailingStopPct ?? 5`. */
const DEFAULT_TRAIL_PCT = 5;

/** Validate a trail percent: must be (0, 100). Undefined → the default. Rejects NaN/Infinity/absurd values (a 500% trail would never protect anything). */
function resolveTrailPct(pct: number | undefined): number {
  if (pct == null) return DEFAULT_TRAIL_PCT;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    throw new ThesisEditError(
      "INVALID",
      "Trailing percent must be greater than 0 and less than 100.",
    );
  }
  return pct;
}

/** Best-effort latest price for peak-seeding a trail. Returns null on any failure (the price-monitor corrects the peak within the hour). */
async function currentPriceFor(
  ticker: string,
  environment: string,
  userId: string,
): Promise<number | null> {
  try {
    const creds =
      (await resolveAlpacaCredentials(userId, environment as "PAPER" | "LIVE")) ??
      undefined;
    const prices = await getLatestPrices([ticker], creds);
    const p = prices[ticker];
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

export interface TriggerTypeChangeResult {
  ok: true;
  thesisId: string;
  triggerId: string;
  kind: "TRAILING_STOP" | "PRICE_BELOW" | "PRICE_ABOVE";
}

/**
 * applyTriggerTypeChange — the principal flips the STOP trigger between a fixed
 * price stop and a trailing stop, from the trigger popover ("Switch to
 * trailing"). Only the stop EXIT trigger is convertible.
 *
 *   → trailing: predicate becomes TRAILING_STOP(trailPct) and the Position's
 *     peakPrice is seeded to the current high-water mark so the trail anchors
 *     from here. Enforcement is the trigger-evaluator (it fires the normal
 *     close-proposal pipeline) — NOT a price-monitor exitStrategy side-channel.
 *   → fixed: predicate reverts to PRICE_BELOW/PRICE_ABOVE at the thesis stop
 *     level (or, if none, the trail's current implied price so you're never
 *     trapped).
 *
 * No Alpaca. Writes one [USER] ThesisUpdate.
 */
export async function applyTriggerTypeChange(
  thesisId: string,
  triggerId: string,
  opts: { trailing: boolean; trailPct?: number },
  ctx: ThesisEditContext,
): Promise<TriggerTypeChangeResult> {
  const thesis = await prisma.thesis.findUnique({
    where: { id: thesisId },
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      accountId: true,
      userId: true,
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
    throw new ThesisEditError("NOT_FOUND", `Trigger ${triggerId} not found on thesis.`);
  }

  const isLong = thesis.direction !== "SHORT";
  const stopKind = isLong ? "PRICE_BELOW" : "PRICE_ABOVE";
  const k = target.predicate.kind;
  // Convertible only if it's the stop EXIT (a fixed price stop) or an EXIT
  // trailing stop. A TRAILING_STOP on a non-EXIT trigger (e.g. a REVIEW) must
  // NOT be able to drive Position.exitStrategy — that would turn a notify-only
  // trail into a hard auto-exit.
  const convertible =
    target.action === "EXIT" && (k === stopKind || k === "TRAILING_STOP");
  if (!convertible) {
    throw new ThesisEditError(
      "INVALID",
      `Only the stop (EXIT) trigger can switch to/from trailing (got ${target.action} ${k}).`,
    );
  }

  // Resolve the paired open position up front — trailing is enforced off its
  // peakPrice, so we need it both to reject trailing on an unheld name and to
  // seed the peak / freeze the trail on revert.
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
          select: { id: true, avgCost: true, peakPrice: true, environment: true },
        })
      : null;

  let newPredicate: Trigger["predicate"];
  let newRationale: string;
  let newKind: TriggerTypeChangeResult["kind"];
  let seedPeak: number | null = null;
  // The fixed level when reverting (null when switching to trailing). Tracked
  // explicitly so we don't have to re-narrow newPredicate's union later.
  let revertLevel: number | null = null;

  if (opts.trailing) {
    if (!position) {
      throw new ThesisEditError(
        "INVALID",
        "A trailing stop needs an open position to trail — this thesis isn't held.",
      );
    }
    const trailPct = resolveTrailPct(opts.trailPct);
    newPredicate = { kind: "TRAILING_STOP", trailPct };
    newRationale = `Trailing stop ${trailPct}% from peak (set by principal).`;
    newKind = "TRAILING_STOP";
    // Seed peakPrice to the high-water mark AS OF NOW so the trail locks in
    // gains from here — not from entry. Without this, a position already up
    // from cost with a null/stale peak would trail off avgCost. Quote failure
    // falls back to the existing peak / cost (the price-monitor corrects it on
    // its next pass).
    const current = await currentPriceFor(
      thesis.ticker,
      position.environment,
      thesis.userId,
    );
    seedPeak = Math.max(position.peakPrice ?? 0, current ?? 0, position.avgCost);
  } else {
    // Revert to a fixed stop. Prefer the thesis's own stop level; if there
    // isn't one, freeze the trail at its current implied price (peak × (1∓pct%))
    // so the user is never trapped in trailing with no way back.
    let level: number | null = thesis.stopLoss ?? null;
    if (level == null) {
      const pct = k === "TRAILING_STOP" ? target.predicate.trailPct : DEFAULT_TRAIL_PCT;
      const peak = position?.peakPrice ?? position?.avgCost ?? null;
      if (peak != null) {
        level = isLong
          ? +(peak * (1 - pct / 100)).toFixed(2)
          : +(peak * (1 + pct / 100)).toFixed(2);
      }
    }
    if (level == null) {
      throw new ThesisEditError(
        "INVALID",
        "Set a stop price on this thesis before reverting from trailing to a fixed stop.",
      );
    }
    newPredicate = { kind: stopKind, level };
    newRationale = `Hard stop at $${level} (set by principal).`;
    newKind = stopKind;
    revertLevel = level;
  }

  const nextTriggers = triggers.map((t) =>
    t.id === triggerId ? { ...t, predicate: newPredicate, rationale: newRationale } : t,
  );

  await prisma.$transaction(async (tx) => {
    await tx.thesis.update({
      where: { id: thesis.id },
      data: {
        triggers: nextTriggers as unknown as object,
        // Mirror the reverted fixed level onto the thesis so the chart line +
        // run-summary match the pill.
        ...(revertLevel != null ? { stopLoss: revertLevel } : {}),
      },
    });
    if (position) {
      await tx.position.update({
        where: { id: position.id },
        // Trailing is a TRIGGER (the trigger-evaluator fires it through the
        // normal proposal pipeline), NOT a price-monitor exitStrategy. So we
        // never touch exitStrategy/trailingStopPct here. Switching ON just
        // seeds the peak high-water mark so the trail anchors from the current
        // high; switching OFF restores the fixed stop level.
        data: opts.trailing
          ? seedPeak != null
            ? { peakPrice: seedPeak }
            : {}
          : revertLevel != null
            ? { stopLoss: revertLevel }
            : {},
      });
      await tx.positionEvent.create({
        data: {
          positionId: position.id,
          eventType: "MODIFIED",
          description: `Principal switched stop to ${opts.trailing ? newRationale.toLowerCase() : "a fixed price stop"}.`,
          priceAt: null,
        },
      });
    }
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: `Principal switched ${thesis.ticker} stop ${opts.trailing ? "→ trailing" : "→ fixed"}`,
    rationale: `[USER] ${newRationale} Honor it; don't re-propose against it unless the thesis materially changes.`,
    fieldChanges: { source: { from: null, to: "USER" }, stopType: { from: opts.trailing ? "fixed" : "trailing", to: opts.trailing ? "trailing" : "fixed" } },
    runId: null,
    tradeId: position?.id,
  });

  return { ok: true, thesisId: thesis.id, triggerId, kind: newKind };
}

// ── Add / delete / fire-mode ────────────────────────────────────────────
//
// The trigger popover edits existing triggers (value + fixed↔trailing).
// applyTriggerAdd / applyTriggerDelete extend that to full UI management:
// mint a NEW Price/Trailing trigger on any action group, or remove one.
// Same invariants the agent write-paths protect — every added trigger is
// validated by the same Zod schema (invalid triggers are silently dropped
// at evaluation, so we reject them up front), cooldown-defaulted (the
// `cooldownDays:0`-reserved-for-EXIT rule), and — when it's the canonical
// price stop / target — mirrored onto Thesis + the open Position so the
// chart line, run-summary, and evaluator never drift from the pill.

/** Predicate kinds the UI add-form can mint. (A new predicate KIND would
 *  touch the ~6 exhaustive switches; these three already exist everywhere.) */
const ADDABLE_PREDICATE_KINDS = new Set<TriggerPredicate["kind"]>([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "TRAILING_STOP",
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
      return predicate.kind === "TRAILING_STOP"
        ? `${predicateSentence(predicate)} — exit on the pullback (set by principal).`
        : `Exit when ${cond} (set by principal).`;
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
      `Can only add price or trailing triggers (got ${input.predicate.kind}).`,
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
  const isTrailing = input.predicate.kind === "TRAILING_STOP";

  // A trailing stop is inherently an EXIT off a live position's peak — reject
  // it on any other action (a notify-only trail can't drive a real exit) and
  // on an unheld name (no position ⇒ no peak ⇒ it could never fire).
  if (isTrailing && input.action !== "EXIT") {
    throw new ThesisEditError(
      "INVALID",
      "A trailing stop must be an EXIT trigger.",
    );
  }

  // Resolve the paired open position once — needed for the stop/target mirror,
  // the trailing peak seed, and the trailing held-only guard.
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
          select: {
            id: true,
            avgCost: true,
            peakPrice: true,
            environment: true,
          },
        })
      : null;

  if (isTrailing && !position) {
    throw new ThesisEditError(
      "INVALID",
      "A trailing stop needs an open position to trail — this thesis isn't held.",
    );
  }

  // DIRECT (close without an agent) is only coherent on an EXIT of a held
  // position. Anywhere else, fall back to the judgment-bearing TACTICAL path.
  let fireMode = input.fireMode ?? defaultFireModeForAction(input.action);
  if (fireMode === "DIRECT" && (input.action !== "EXIT" || !position)) {
    fireMode = "TACTICAL";
  }

  // Validate the single trigger through the same Zod gate the agent uses —
  // generates a stable id, normalizes the enum, rejects out-of-range trail %.
  const candidate = {
    predicate: input.predicate,
    action: input.action,
    rationale:
      input.rationale?.trim() || addedTriggerRationale(input.action, input.predicate),
    ...(input.cooldownDays != null ? { cooldownDays: input.cooldownDays } : {}),
    fireMode,
  };
  const parsedOne = triggerSchema.safeParse(candidate);
  if (!parsedOne.success) {
    throw new ThesisEditError(
      "INVALID",
      `Invalid trigger: ${parsedOne.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  // Cooldown discipline (0-on-non-EXIT → per-kind default; same as the agent
  // write path). applyTriggerCooldownDefaults returns a fresh array.
  const newTrigger = applyTriggerCooldownDefaults([parsedOne.data as Trigger])[0];

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

  // Seed the peak high-water mark AS OF NOW when adding a trailing stop, so the
  // trail locks in from here, not from entry. Mirrors applyTriggerTypeChange.
  let seedPeak: number | null = null;
  if (isTrailing && position) {
    const current = await currentPriceFor(
      thesis.ticker,
      position.environment,
      thesis.userId,
    );
    seedPeak = Math.max(position.peakPrice ?? 0, current ?? 0, position.avgCost);
  }

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
      const posData: { stopLoss?: number; targetPrice?: number; peakPrice?: number } = {};
      if (synced.stopLoss != null) posData.stopLoss = synced.stopLoss;
      if (synced.targetPrice != null) posData.targetPrice = synced.targetPrice;
      if (seedPeak != null) posData.peakPrice = seedPeak;
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
    throw new ThesisEditError("NOT_FOUND", `Trigger ${triggerId} not found on thesis.`);
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
    throw new ThesisEditError("NOT_FOUND", `Trigger ${triggerId} not found on thesis.`);
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
  const nextTriggers = triggers.map((t) =>
    t.id === triggerId ? { ...t, fireMode } : t,
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
