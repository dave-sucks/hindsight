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
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import {
  editableTriggerField,
  withEditedValue,
} from "@/lib/agent/triggers/editable";
import type { Trigger } from "@/lib/agent/triggers/types";
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
