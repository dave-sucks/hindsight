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
