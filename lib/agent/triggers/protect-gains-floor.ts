/**
 * Protect gains raises the stock's own floor (./protect-gains), through the
 * write path every editor uses (./ops). Up only: a floor already at or past
 * the line is left alone. The floor is stored DIRECT — it is the stock's
 * automatic sale — and each raise is one Activity line on the stock.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { levelOf, shapeOf } from "./condition";
import { loadLevelSources, resolveThesisLadder } from "./load-levels";
import { acceptedOps, applyTriggerOps, checkLadder } from "./ops";
import { levelSlotOf } from "./price-levels";
import { raiseWords, type ProtectGains } from "./protect-gains";
import { parseTriggersResilient } from "./schema";
import type { Trigger } from "./types";

const isFloor = (t: Trigger, direction: string | null) => t.action === "EXIT" && levelSlotOf(t, direction) === "FLOOR";

/** The floor stored on a stock, as a price; null when it has none. */
export function floorOf(triggers: Trigger[], direction: string | null): { trigger: Trigger; price: number } | null {
  const t = triggers.find((x) => isFloor(x, direction));
  const w = t ? shapeOf(t.predicate) : null;
  const level = w ? levelOf(w) : null;
  return t && level ? { trigger: t, price: level.value } : null;
}

/** What a raise did: the floor as stored when it moved, or why it couldn't. */
export type FloorRaise = { floor: Trigger | null; refused: string | null };

/** Raise the floor to `line`, or create one there. Up only; a floor already there is left alone. */
export async function raiseFloorForGains(a: {
  thesisId: string;
  positionId: string;
  avgCost: number;
  high: number;
  line: number;
  price: number;
  rule: ProtectGains;
}): Promise<FloorRaise> {
  const thesis = await prisma.thesis.findUnique({
    where: { id: a.thesisId },
    select: { id: true, status: true, direction: true, horizon: true, triggers: true, triggerState: true, stopLoss: true, researchRun: { select: { agentConfigId: true } } },
  });
  if (!thesis || thesis.status !== "HOLDING") return { floor: null, refused: null };
  const isLong = thesis.direction !== "SHORT";
  const stored = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const current = floorOf(stored, thesis.direction);
  if (current && (isLong ? current.price >= a.line : current.price <= a.line)) return { floor: null, refused: null };

  const analystId = thesis.researchRun?.agentConfigId ?? null;
  const sources = analystId ? (await loadLevelSources([analystId])).get(analystId) : undefined;
  const inherited = resolveThesisLadder({ triggers: [], triggerState: {}, status: thesis.status, horizon: thesis.horizon }, sources);
  const held = { avgCost: a.avgCost, isLong };
  const applied = applyTriggerOps({
    stored,
    inherited,
    ops: [{ op: "level", slot: "FLOOR", price: a.line, rationale: raiseWords(held, a.high, a.line, a.rule).note }],
    direction: thesis.direction,
    status: thesis.status,
    actor: "SYSTEM",
    currentPrice: a.price,
    mintId: () => randomUUID(),
  });
  if (!applied.results[0]?.ok) return { floor: null, refused: applied.results[0]?.reason ?? "the floor could not be written" };
  // The floor is the stock's automatic sale: stored DIRECT.
  const triggers = applied.triggers.map((t) => (isFloor(t, thesis.direction) ? { ...t, fireMode: "DIRECT" as const } : t));
  // A winner past its target keeps its protection: the floor may pass the target, which stays a review level.
  const check = checkLadder({ triggers, inherited, direction: thesis.direction, status: thesis.status, actor: "SYSTEM", entryPrice: a.avgCost, avgCost: a.avgCost, stopMayPassTarget: true });
  if (!check.ok) return { floor: null, refused: check.message };
  const words = raiseWords(held, a.high, a.line, a.rule, check.columns.targetPrice);
  await prisma.$transaction(async (tx) => {
    await tx.thesis.update({ where: { id: thesis.id }, data: { triggers: triggers as unknown as object, stopLoss: check.columns.stopLoss } });
    await tx.position.update({ where: { id: a.positionId }, data: { stopLoss: check.columns.stopLoss } });
  });
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: words.summary,
    rationale: words.note,
    fieldChanges: {
      source: { from: null, to: "PROTECT_GAINS" },
      triggerOps: { from: null, to: acceptedOps(applied.results) },
      stopLoss: { from: thesis.stopLoss, to: check.columns.stopLoss },
    },
    triggerId: floorOf(triggers, thesis.direction)?.trigger.id,
    signalIds: [],
    runId: null,
    priceAtTime: a.price,
  });
  return { floor: floorOf(triggers, thesis.direction)?.trigger ?? null, refused: null };
}

const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** A raise that was refused, on the stock's Activity where the owner sees it: once a day per stock and reason. */
export async function reportNotProtected(a: { thesisId: string; line: number; reason: string; price: number; now: Date }): Promise<void> {
  const summary = `Not protected: the floor could not be raised to $${a.line.toFixed(2)} — ${a.reason}`;
  const today = await prisma.thesisUpdate.findFirst({
    where: { thesisId: a.thesisId, summary, timestamp: { gte: new Date(`${etDay(a.now)}T04:00:00Z`) } },
    select: { id: true },
  });
  if (today) return;
  await writeThesisUpdate({
    thesisId: a.thesisId,
    type: "UPDATED",
    summary,
    rationale: "Protect gains tried to raise this stock's floor and the write was refused. The floor stays where it was until this is fixed.",
    fieldChanges: { source: { from: null, to: "PROTECT_GAINS" } },
    signalIds: [],
    runId: null,
    priceAtTime: a.price,
  });
}
