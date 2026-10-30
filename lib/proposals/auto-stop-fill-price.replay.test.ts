/**
 * Stop when buying prices its floor off the price when the buy is approved,
 * then off the price paid once the fill lands, never off the proposal's price,
 * which can be a day old. Through the approval (approveProposal) and the fill
 * job (reconcile-orders).
 *
 * IOT (PEAD Specialist), order cmv9m90hs000b06l3xlg7n6ov, 2026-10-15:
 * proposed at $42.21; approved 11:16:03 ET, when the last trade was $42.755;
 * 300 shares filled at $42.695. The ticket's floor $39.80, target $47. Stop
 * when buying on at 6%, as the account has it now. Only the database and the
 * broker are doubled.
 */

import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ANALYST_ID, REPLAY_USER_ID, type PrismaDouble } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
let quote = 42.755;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/alpaca", () => ({
  getLatestPrice: async () => quote,
  placeMarketOrder: async () => ({ id: "alpaca_order_IOT", status: "accepted" }),
  closePositionPartial: async () => null,
  getOrder: jest.fn(),
  getOrderByClientOrderId: jest.fn(),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => undefined }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));

import { approveProposal } from "./execute";
import { __test__ as reconcile } from "@/lib/inngest/functions/reconcile-orders";

const PROPOSED = 42.21;
const PAID = 42.695;
const REVIEW_7D = { id: "8fc79e5c-3682-48de-a0d9-03acce291d71", action: "REVIEW", source: "DEFAULT", fireMode: "NEXT_MORNING", predicate: { value: 7, watch: "repeat" }, rationale: "Look at this every 7 days, counting from the last real review.", cooldownDays: 7 };

async function buy(opts: { at?: number; setting?: { on: boolean; pct: number }; floor?: Record<string, unknown>; stop?: number } = {}) {
  quote = opts.at ?? 42.755;
  const setting = opts.setting ?? { on: true, pct: 6 };
  const position = positionRow({ id: "cmv9m90g0000a06l3zv45o24s", symbol: "IOT", status: "PENDING_APPROVAL", environment: "LIVE", quantity: 300, avgCost: PROPOSED, stopLoss: opts.stop ?? 39.8, targetPrice: 47 });
  db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: setting.on, autoStopPct: setting.pct, setupOverrides: {} })],
    agentConfig: [agentConfigRow({ name: "PEAD Specialist", autoStopOnBuy: null, autoStopPct: null })],
    thesis: [thesisRow({ id: "thesis_IOT", ticker: "IOT", status: "WATCHING", direction: "LONG", horizon: "TARGET", setupId: "NONE", entryPrice: PROPOSED, triggers: opts.floor ? [REVIEW_7D, opts.floor] : [REVIEW_7D] })],
    position: [position],
    // The double joins nothing: the order carries its position inline, as the approval reads it.
    order: [{ id: "cmv9m90hs000b06l3xlg7n6ov", positionId: position.id, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "IOT", side: "BUY", orderType: "MARKET", quantity: 300, status: "AWAITING_APPROVAL", intent: "OPEN", idempotencyKey: "idem-IOT-1015", expiresAt: new Date(Date.now() + 3_600_000), position }],
  });
  await approveProposal("cmv9m90hs000b06l3xlg7n6ov", REPLAY_USER_ID);
  const approved = floors();
  const order = (db.store.order as Array<Record<string, unknown>>)[0];
  await reconcile.applyFillByIntent(order as never, PAID, 300, new Date("2026-10-15T15:16:03Z"));
  return approved;
}

const thesis = () => (db.store.thesis as Array<Record<string, unknown>>)[0];
const position = () => (db.store.position as Array<Record<string, unknown>>)[0];
const floors = () => (thesis().triggers as Trigger[]).filter((t) => t.action === "EXIT").map((t) => ({ value: (t.predicate as { value: number }).value, fireMode: t.fireMode, source: t.source }));
const fillLine = () => (db.store.thesisUpdate as Array<{ summary: string; rationale: string; fieldChanges: { triggerOps?: { to: Array<{ text: string }> } } }>).find((u) => u.summary.startsWith("IOT buy price set to what was paid"));

describe("IOT 2026-10-15, stop when buying on at 6%", () => {
  it("the approval prices the floor off $42.755, the price then, not the proposal's $42.21; the fill moves it to 6% under the $42.695 paid", async () => {
    const approved = await buy();
    // The proposal's price would have put it at $39.68.
    expect(approved).toEqual([{ value: 40.19, fireMode: "DO_IT", source: "PRINCIPAL" }]);
    expect(floors()).toEqual([{ value: 40.13, fireMode: "DO_IT", source: "PRINCIPAL" }]);
    expect(thesis()).toMatchObject({ status: "HOLDING", entryPrice: PAID, stopLoss: 40.13 });
    expect(position()).toMatchObject({ avgCost: PAID, stopLoss: 40.13 });
    expect(fillLine()?.fieldChanges.triggerOps?.to.map((o) => o.text)).toEqual(["Changed: Sell if below $40.19 → Sell if below $40.13"]);
    // The change is the line; no paragraph is written for it.
    expect(fillLine()?.rationale ?? null).toBeNull();
  });

  it("made up, to show the gap: approved after it fell to $38, the floor is $35.72 under the price then, not $39.68 above it", async () => {
    const approved = await buy({ at: 38 });
    expect(approved).toEqual([{ value: 35.72, fireMode: "DO_IT", source: "PRINCIPAL" }]);
    // Filled at $42.695 in this replay, so the fill puts it 6% under that.
    expect(floors()).toEqual([{ value: 40.13, fireMode: "DO_IT", source: "PRINCIPAL" }]);
  });

  it("an owner's floor above the line, which the proposal named as its stop, is left as it is at the approval and at the fill", async () => {
    const mine = { id: "owner_floor", action: "EXIT", source: "PRINCIPAL", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 41.5 }, rationale: "Sell if below $41.50. You set this.", cooldownDays: 1 };
    await buy({ floor: mine, stop: 41.5 });
    expect(floors()).toEqual([{ value: 41.5, fireMode: "ASK_NOW", source: "PRINCIPAL" }]);
    expect(fillLine()?.fieldChanges.triggerOps).toBeUndefined();
  });

  it("off: the fill moves nothing; the ticket's $39.80 stays", async () => {
    await buy({ setting: { on: false, pct: 6 } });
    expect(floors().map((f) => f.value)).toEqual([39.8]);
    expect(fillLine()?.fieldChanges.triggerOps).toBeUndefined();
  });
});
