/**
 * After the buy, from its entry points, on PANW's real fill.
 *
 * PANW (PEAD Specialist, LIVE), 2026-11-19: the owner's chat proposed 9 shares
 * at $362.12 with a sale at $339.92 (order cmwnosh8q000d07jmj3k3qmc4); the
 * owner approved at 11:03 ET, edited to 15 shares; 15 filled at $357.4625;
 * the floor ended "Sell if below $336.01" (the owner's, Auto); After the buy
 * ran at 11:05 (run cmwnqr7rx000308l2q71n8ac2). Its message's first lines are
 * the ones asserted below.
 *
 * - loadAfterBuyFacts reads the trade as that run was sent it, and nothing
 *   else (an unfilled order, a sale, a stock no longer held).
 * - runAfterBuy runs the agent once per order: a second run on the same order
 *   is skipped; a trade with its note gets no write_note.
 * - Every fill sends app/buy.filled once: an approved proposal (through the
 *   approval and the fill job); a fill applied a second time sends
 *   nothing. A buy, an Auto buy and an add filled at once, approvals off,
 *   are in after-buy.fills-at-once.replay.test.ts.
 * Only the database, the broker, the agent runner and the clock are doubled.
 */
import { prismaDouble, replayTool, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_USER_ID, REPLAY_ACCOUNT_ID, type PrismaDouble, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
const mockSend = jest.fn(async (_event: unknown) => undefined);
const mockRunAgentAsRun = jest.fn();
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/alpaca", () => ({
  getLatestPrice: async () => 359.42,
  placeMarketOrder: async () => ({ id: "alpaca_PANW", status: "accepted" }),
  closePositionPartial: async () => null,
  getOrder: jest.fn(),
  getOrderByClientOrderId: jest.fn(),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => undefined }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: (e: unknown) => mockSend(e as never) } }));
// The agent runner is doubled: it builds the run's arguments as the runner does, and makes no model call.
jest.mock("@/lib/agent/engine/run", () => ({ runAgentAsRun: (...a: unknown[]) => mockRunAgentAsRun(...a) }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: async () => null }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));

import { loadAfterBuyFacts, afterBuyMessage, BUY_FILLED } from "./after-buy";
import { approveProposal } from "./execute";
import { runAfterBuy } from "@/lib/inngest/functions/after-buy-run";
import { __test__ as reconcile } from "@/lib/inngest/functions/reconcile-orders";
import { doItCall } from "@/lib/agent/triggers/do-it";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const THESIS = "cmwle4m6f000l08l5ohrprdxt";
const POSITION = "cmwnosh8e000c07jmgvs54z75";
const ORDER = "cmwnosh8q000d07jmj3k3qmc4";
const PAID = 357.4625;
/** The order's note, its opening sentence (the chat's proposal reason). */
const NOTE = "Palo Alto reported FQ1'27 after the close on Nov 18: revenue $3.44B vs $3.31B expected, adj EPS $1.05 vs $0.97, and management raised full-year revenue guidance to $14.52–14.57B.";
const SALE_REASON = "The Nov 18 gap-day low — if the stock closes back below the gap, the earnings reaction has been fully rejected and the drift is over.";
const FLOOR: Trigger = { id: "16935fdc-d1df-4982-83e6-b693acfa4294", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 336.01 }, rationale: "Sell if below $336.01. You set this." } as Trigger;
const EARNINGS_REVIEW: Trigger = { id: "0741d0f1-e2e3-4a6d-8f2b-2b9de9e3144b", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { watch: "report", is: "before", value: 0 }, rationale: "Review on the day of earnings." } as unknown as Trigger;

const analyst = () => agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE", autoStopOnBuy: null, autoStopPct: null });
const account = () => accountRow({ autoStopOnBuy: false, requireApprovalBuysLive: true, requireApprovalBuysPaper: false, requireApprovalSellsPaper: false });
const sends = () => mockSend.mock.calls.map(([e]) => e as { name: string; data: { orderId: string } }).filter((e) => e.name === BUY_FILLED);

/** PANW once the fill landed: held, its floor on, the order filled. */
function afterTheFill(order: Partial<Row> = {}) {
  const position = positionRow({ id: POSITION, analystId: PEAD, symbol: "PANW", status: "OPEN", environment: "LIVE", quantity: 15, initialQty: 15, avgCost: PAID, stopLoss: 336.01 });
  db = prismaDouble({
    account: [account()],
    agentConfig: [analyst()],
    thesis: [thesisRow({ id: THESIS, ticker: "PANW", status: "HOLDING", direction: "LONG", setupId: null, analystId: PEAD, triggers: [FLOOR, EARNINGS_REVIEW] } as Partial<Row>)],
    position: [position],
    order: [{ id: ORDER, positionId: POSITION, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "PANW", side: "BUY", orderType: "MARKET", quantity: 15, status: "FILLED", intent: "OPEN", filledPrice: PAID, filledQty: 15, filledAt: new Date("2026-11-19T16:03:29Z"), rationale: NOTE, triggerIds: [], thesisId: THESIS, position, decision: null, ...order }],
  });
}

beforeEach(() => {
  mockSend.mockClear();
  mockRunAgentAsRun.mockReset();
});

describe("loadAfterBuyFacts and the message, PANW's fill", () => {
  it("reads the trade as the run was sent it", async () => {
    afterTheFill();
    const facts = await loadAfterBuyFacts(ORDER);
    expect(facts).toMatchObject({ orderId: ORDER, ticker: "PANW", thesisId: THESIS, analystId: PEAD, environment: "LIVE", added: false, fillPrice: PAID, shares: 15, trigger: null, note: NOTE, holding: null });
    const lines = afterBuyMessage(facts!, "ASK").split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "You bought 15 shares of $PANW at $357.46.",
      'Its floor: Sell if below $336.01 ("Sell if below $336.01. You set this.").',
      `The trade's note: "${NOTE}"`,
    ]);
  });

  it.each([
    ["an order not filled", { status: "PENDING" }],
    ["a sale", { side: "SELL", intent: "CLOSE" }],
  ])("is null for %s", async (_what, order) => {
    afterTheFill(order as Partial<Row>);
    expect(await loadAfterBuyFacts(ORDER)).toBeNull();
  });
});

describe("runAfterBuy, PANW's order", () => {
  it("runs the agent once, with the trade's message, and no write_note since the trade has its note", async () => {
    afterTheFill();
    let built: { input: { message: string }; wrapTools?: (t: Record<string, unknown>) => Record<string, unknown> } | null = null;
    mockRunAgentAsRun.mockImplementation(async (agent: { args: (t: unknown, runId: string) => Promise<typeof built> }, target: unknown) => {
      built = await agent.args(target, "run_after_buy");
      return { runId: "run_after_buy", status: "COMPLETE" };
    });
    const out = await runAfterBuy(ORDER);
    expect(out).toEqual({ runId: "run_after_buy", status: "COMPLETE", noted: false });
    expect(mockRunAgentAsRun).toHaveBeenCalledTimes(1);
    expect(mockRunAgentAsRun.mock.calls[0][0]).toMatchObject({ mode: "AFTER_BUY", parameters: { ticker: "PANW", thesisId: THESIS, orderId: ORDER } });
    expect(built!.input.message.startsWith("You bought 15 shares of $PANW at $357.46.")).toBe(true);
    expect(Object.keys(built!.wrapTools!({ write_note: {}, edit_triggers: {} }))).toEqual(["edit_triggers"]);
  });

  it("an order it already ran on is skipped", async () => {
    afterTheFill();
    db.store.researchRun = [{ id: "cmwnqr7rx000308l2q71n8ac2", mode: "AFTER_BUY", status: "COMPLETE", accountId: REPLAY_ACCOUNT_ID, parameters: { ticker: "PANW", thesisId: THESIS, orderId: ORDER } }];
    expect(await runAfterBuy(ORDER)).toEqual({ skipped: "already run (cmwnqr7rx000308l2q71n8ac2)" });
    expect(mockRunAgentAsRun).not.toHaveBeenCalled();
  });

  it("a sale is skipped", async () => {
    afterTheFill({ side: "SELL", intent: "CLOSE" });
    expect(await runAfterBuy(ORDER)).toEqual({ skipped: "not a filled buy or add on a stock we hold" });
  });
});

describe("every fill sends app/buy.filled once", () => {
  it("an approved proposal (PANW): the approval sends nothing, the fill job sends it once, and a fill applied again sends nothing", async () => {
    const position = positionRow({ id: POSITION, analystId: PEAD, symbol: "PANW", status: "PENDING_APPROVAL", environment: "LIVE", quantity: 9, avgCost: 362.12, stopLoss: 339.92, stopReason: SALE_REASON });
    db = prismaDouble({
      account: [account()],
      agentConfig: [analyst()],
      thesis: [thesisRow({ id: THESIS, ticker: "PANW", status: "WATCHING", direction: "LONG", setupId: null, analystId: PEAD, triggers: [EARNINGS_REVIEW] } as Partial<Row>)],
      position: [position],
      order: [{ id: ORDER, positionId: POSITION, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "PANW", side: "BUY", orderType: "MARKET", quantity: 9, status: "AWAITING_APPROVAL", intent: "OPEN", rationale: NOTE, proposedPrice: 362.12, thesisId: THESIS, triggerIds: [], idempotencyKey: "c0e1f2be-panw", expiresAt: new Date(Date.now() + 3_600_000), position }],
    });
    await approveProposal(ORDER, REPLAY_USER_ID, { quantity: 15 });
    expect(sends()).toEqual([]);
    const order = (db.store.order as Row[]).find((o) => o.id === ORDER)!;
    expect(await reconcile.applyFill(order as never, PAID, 15, new Date("2026-11-19T16:03:29Z"))).toBe(true);
    expect(sends()).toEqual([{ name: BUY_FILLED, data: { orderId: ORDER } }]);
    expect(await reconcile.applyFill(order as never, PAID, 15, new Date("2026-11-19T16:03:29Z"))).toBe(false);
    expect(sends()).toHaveLength(1);
  });
});
