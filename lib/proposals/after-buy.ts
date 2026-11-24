/**
 * The run after a buy or an add fills: one per filled order, whatever brought
 * it (an approved proposal, a buy with approvals off, an Auto buy, an add, a
 * Trade-ticket buy). The fill puts on only the floor (thesis-flips.ts); this
 * run puts on the playbook's holding triggers, tailored to the stock, and
 * writes the trade's note when nobody has. lib/inngest/functions/after-buy-run.ts
 * runs it; its agent is lib/agent/engine/agents/after-buy.ts.
 */
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { levelSlotOf } from "@/lib/agent/triggers/price-levels";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { autoTradeLine } from "@/lib/agent/triggers/do-it";
import type { Trigger } from "@/lib/agent/triggers/types";
import { sendRunLostEmail } from "@/lib/emails/run-lost";

/** Sent once a buy or an add has filled. */
export const BUY_FILLED = "app/buy.filled";

/** Asks for the run after this fill. Never throws: a fill is never undone for its run. */
export async function sendBuyFilled(orderId: string): Promise<void> {
  try {
    await inngest.send({ name: BUY_FILLED, data: { orderId } });
  } catch (err) {
    console.warn(`[after-buy] could not send ${BUY_FILLED} for ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

/** Model runs one fill may spend before the owner is told. */
export const AFTER_BUY_TRIES = 3;
const MINUTE = 60_000;
/** A run still marked running after this long has died (a run's limit is under 14 minutes). */
const RUN_DIED_AFTER = 20 * MINUTE;
/** The fill's own event gets this long before the sweep steps in. */
const SWEEP_WAITS = 5 * MINUTE;
/** A fill with no finished run by now reaches the owner, however few runs started. */
const TELL_AFTER = 120 * MINUTE;
/** How far back the sweep looks: across a weekend, when it doesn't run. */
const SWEEP_LOOKS_BACK = 4 * 24 * 60 * MINUTE;

export interface AfterBuyRunRow {
  status: string;
  startedAt: Date;
  parameters: unknown;
}

function readRuns(runs: AfterBuyRunRow[], now: Date) {
  const isTold = (r: AfterBuyRunRow) => (r.parameters as { ownerTold?: boolean } | null)?.ownerTold === true;
  const tries = runs.filter((r) => !isTold(r));
  const died = (r: AfterBuyRunRow) => r.status === "RUNNING" && now.getTime() - new Date(r.startedAt).getTime() >= RUN_DIED_AFTER;
  return {
    finished: tries.some((r) => r.status === "COMPLETE"),
    running: tries.some((r) => r.status === "RUNNING" && !died(r)),
    failed: tries.filter((r) => r.status === "FAILED" || died(r)).length,
    told: runs.some(isTold),
  };
}

/** Whether a run may start on this fill: none finished or going, and tries left. */
export function mayRunAfterBuy(runs: AfterBuyRunRow[], now: Date): boolean {
  const r = readRuns(runs, now);
  return !r.finished && !r.running && r.failed < AFTER_BUY_TRIES;
}

/** What the sweep owes this fill. */
export function afterBuyOwed(runs: AfterBuyRunRow[], filledAt: Date, now: Date): "no" | "run" | "tell" {
  const r = readRuns(runs, now);
  if (r.finished || r.running || r.told) return "no";
  return r.failed >= AFTER_BUY_TRIES || now.getTime() - filledAt.getTime() >= TELL_AFTER ? "tell" : "run";
}

/** Every filled buy or add with no finished run: asked for again, then the owner is told, once. */
export async function sweepAfterBuys(now: Date = new Date()): Promise<{ sent: number; told: number }> {
  const since = new Date(now.getTime() - SWEEP_LOOKS_BACK);
  const orders = await prisma.order.findMany({
    where: { status: "FILLED", intent: { in: ["OPEN", "ADD"] }, thesisId: { not: null }, filledAt: { gte: since, lte: new Date(now.getTime() - SWEEP_WAITS) } },
    select: { id: true, filledAt: true },
  });
  if (orders.length === 0) return { sent: 0, told: 0 };
  const runs = await prisma.researchRun.findMany({ where: { mode: "AFTER_BUY", startedAt: { gte: since } }, select: { status: true, startedAt: true, parameters: true } });
  let sent = 0;
  let told = 0;
  for (const order of orders) {
    const owed = afterBuyOwed(runs.filter((r) => (r.parameters as { orderId?: string } | null)?.orderId === order.id), order.filledAt!, now);
    if (owed === "no") continue;
    const facts = await loadAfterBuyFacts(order.id);
    if (!facts) continue;
    if (owed === "run") {
      await sendBuyFilled(order.id);
      sent += 1;
      continue;
    }
    const emailed = await sendRunLostEmail({
      accountId: facts.accountId,
      userId: facts.userId,
      ticker: facts.ticker,
      subject: `${facts.ticker}: After the buy didn't run`,
      body: `${facts.ticker} filled at $${facts.fillPrice.toFixed(2)}, but After the buy didn't finish, so its holding triggers aren't on. ${facts.floor ? `It still has "${facts.floor.sentence}".` : "It has no floor."}`,
    });
    if (!emailed) continue;
    // The record that the owner was told, on the Runs page with the failed runs.
    await prisma.researchRun.create({
      data: {
        userId: facts.userId,
        accountId: facts.accountId,
        agentConfigId: facts.analystId,
        source: "AGENT",
        status: "FAILED",
        mode: "AFTER_BUY",
        environment: facts.environment,
        completedAt: now,
        parameters: { ticker: facts.ticker, thesisId: facts.thesisId, orderId: order.id, ownerTold: true, error: "After the buy didn't finish; the owner was emailed." },
      },
    });
    told += 1;
  }
  return { sent, told };
}

/** The trade the run is sent: what filled, the floor, what led to it, and its note. */
export interface AfterBuyFacts {
  orderId: string;
  ticker: string;
  thesisId: string;
  analystId: string;
  userId: string;
  accountId: string;
  environment: "PAPER" | "LIVE";
  added: boolean;
  fillPrice: number;
  shares: number;
  /** The stock's "Sell if below" after the fill, with its reason; null when it has none. */
  floor: { sentence: string; reason: string | null } | null;
  /** The trigger that led to it, as it read when it fired. */
  trigger: string | null;
  /** The trade's note, when someone wrote it: the proposal's reason, or the chat's words. */
  note: string | null;
  /** After an add: the holding now. */
  holding: { shares: number; avgCost: number } | null;
}

/** The facts of a filled buy or add on a stock we hold; null for anything else. */
export async function loadAfterBuyFacts(orderId: string): Promise<AfterBuyFacts | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, intent: true, side: true, filledPrice: true, filledQty: true, rationale: true, triggerIds: true, thesisId: true, environment: true, position: { select: { analystId: true, avgCost: true, quantity: true } }, decision: { select: { runId: true } } },
  });
  const intent = order?.intent ?? (order?.side === "BUY" ? "OPEN" : null);
  if (!order || order.status !== "FILLED" || (intent !== "OPEN" && intent !== "ADD") || !order.thesisId || order.filledPrice == null) return null;
  const thesis = await prisma.thesis.findUnique({ where: { id: order.thesisId }, select: { id: true, ticker: true, status: true, direction: true, triggers: true, userId: true, accountId: true } });
  if (!thesis || thesis.status !== "HOLDING" || !order.position?.analystId) return null;

  const triggers = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const floor = triggers.find((t) => t.action === "EXIT" && levelSlotOf(t, thesis.direction) === "FLOOR");
  // The trigger a proposal answers is on the order; a buy sent at once is named by the fire of the run that made it.
  const firedWhere = order.triggerIds[0]
    ? { triggerId: order.triggerIds[0] }
    : order.decision?.runId
      ? { runId: order.decision.runId, triggerAction: { in: ["ENTER", "ADD"] } }
      : null;
  const fired = firedWhere
    ? await prisma.thesisUpdate.findFirst({
        where: { thesisId: thesis.id, type: "TRIGGER_FIRED", ...firedWhere },
        orderBy: { timestamp: "desc" },
        select: { summary: true, triggerAction: true, triggerCondition: true },
      })
    : null;
  // The note is the analyst's (stamped with this order), else the order's own words, unless those are the Auto trade's plain line.
  const stamped = await prisma.thesisUpdate.findFirst({ where: { tradeId: order.id, rationale: { not: null } }, orderBy: { timestamp: "desc" }, select: { rationale: true } });
  const autoLine = fired?.triggerAction ? autoTradeLine({ action: fired.triggerAction as Trigger["action"], predicate: fired.triggerCondition as unknown as Trigger["predicate"] }) : null;
  const own = order.rationale?.trim() && order.rationale.trim() !== autoLine ? order.rationale.trim() : null;
  return {
    orderId: order.id,
    ticker: thesis.ticker,
    thesisId: thesis.id,
    analystId: order.position.analystId,
    userId: thesis.userId,
    accountId: thesis.accountId,
    environment: order.environment === "LIVE" ? "LIVE" : "PAPER",
    added: intent === "ADD",
    fillPrice: order.filledPrice,
    shares: order.filledQty ?? 0,
    floor: floor ? { sentence: sentenceOf(floor), reason: floor.rationale?.trim() || null } : null,
    trigger: fired?.summary ?? null,
    note: stamped?.rationale?.trim() || own,
    holding: intent === "ADD" && order.position.quantity > 0 ? { shares: order.position.quantity, avgCost: order.position.avgCost } : null,
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const shares = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(4)} shares`;

/** The run's message: the trade's facts, one line each, then its ask. Pure. */
export function afterBuyMessage(f: AfterBuyFacts, ask: string): string {
  return [
    f.added
      ? `You added ${shares(f.shares)} of $${f.ticker} at ${money(f.fillPrice)}${f.holding ? `; you now hold ${shares(f.holding.shares)} at an average of ${money(f.holding.avgCost)}` : ""}.`
      : `You bought ${shares(f.shares)} of $${f.ticker} at ${money(f.fillPrice)}.`,
    f.floor ? `Its floor: ${f.floor.sentence}${f.floor.reason ? ` ("${f.floor.reason}")` : ""}.` : "It has no floor: no Sell if below trigger is on the stock.",
    ...(f.trigger ? [`It came from the trigger "${f.trigger}".`] : []),
    f.note ? `The trade's note: "${f.note}"` : "No one has written this trade's note yet.",
    "",
    ask,
  ].join("\n");
}
