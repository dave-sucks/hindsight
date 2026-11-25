/**
 * A buy that fills in the order check makes the stock a holding, from the
 * check's own entry point (applyFill) on a real approved buy.
 *
 * KEYS (PEAD Specialist, LIVE): approved 2026-11-23 at 3:58 PM ET, 28 shares
 * (order cmwtqwl1r001d08jvgagirprf, position cmwtqwl17001c08jvumgnma1g),
 * proposed at $288.905 with a $257.93 sale, filled at $289.6286. Stop when
 * buying is on at 6%. In production the send came back clean, so the approval
 * made KEYS a holding. Replayed here as if the send had timed out: the approval
 * stops before it moves the stock, and the order check applies the fill. Before
 * this fix the stock stayed on Watching with its buy and Stop watching lines, no
 * sale was read for the 28 shares, and After the buy skipped it. Only the
 * database, the broker and the event sender are doubled.
 */
import { prismaDouble, thesisRow, positionRow, agentConfigRow, accountRow, triggerSentences, REPLAY_USER_ID, type PrismaDouble, type Row } from "@/lib/replay";
import { inngest } from "@/lib/inngest/client";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/alpaca", () => ({ getOrder: jest.fn(), getOrderByClientOrderId: jest.fn() }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => undefined }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn(async () => undefined) } }));

import { __test__ as reconcile } from "./reconcile-orders";
import { MANUAL_RATIONALE } from "@/lib/trading/manual-order-rules";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const THESIS = "cmwocoypj001108lj8o7pngyo";
const POSITION = "cmwtqwl17001c08jvumgnma1g";
const ORDER = "cmwtqwl1r001d08jvgagirprf";
const PAID = 289.6286;
const FILLED_AT = new Date("2026-11-23T20:58:14.615Z");

/** KEYS's watch triggers as the fill found them (the three the approval took off). */
const WATCH: Trigger[] = [
  { id: "8af1804c-c91c-476e-89ce-8e06e56ed08c", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", playbook: "WATCH", predicate: { watch: "repeat", value: 7 }, rationale: "A look each week." },
  { id: "a44eb398-5301-43f0-aa2d-66853b475832", action: "STOP_WATCHING", source: "AGENT", fireMode: "ASK_NOW", playbook: "WATCH", predicate: { watch: "price", is: "below", value: 257.93, settings: { close: true } }, rationale: "The Nov. 5 swing low." },
  { id: "6534d3e1-1499-4192-81a8-f4aa93a057be", action: "ENTER", source: "AGENT", fireMode: "ASK_NOW", playbook: "WATCH", predicate: { match: "all", conditions: [{ watch: "price", is: "above", value: 281.42 }, { watch: "volume", value: 2 }] }, rationale: "The gap day's high on volume." },
] as unknown as Trigger[];

/** The order as the check loads it: PENDING, adopted by its key after the send timed out. */
const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER,
  userId: REPLAY_USER_ID,
  environment: "LIVE",
  positionId: POSITION,
  symbol: "KEYS",
  side: "BUY",
  quantity: 28,
  alpacaOrderId: "da6fd51d-37f1-48d0-b793-cad6cf77987f",
  idempotencyKey: "bee96be8-6697-471e-9a8b-e749826a8a8d",
  intent: "OPEN",
  closeReason: null,
  closeSource: null,
  rationale: "The analyst's note on the buy.",
  closeBeliefSurvived: null,
  thesisId: THESIS,
  triggerIds: [],
  ...over,
});

function seed(opts: { thesis?: Partial<Row>; position?: Partial<Row>; updates?: Row[] } = {}) {
  db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: true, autoStopPct: 6 })],
    agentConfig: [agentConfigRow({ id: PEAD, name: "PEAD Specialist", autoStopOnBuy: null, autoStopPct: null })],
    thesis: [thesisRow({ id: THESIS, ticker: "KEYS", status: "WATCHING", direction: "LONG", analystId: PEAD, triggers: WATCH, ...opts.thesis })],
    // The approval's transaction made the position OPEN before the send; avgCost is still the proposal's.
    position: [
      positionRow({
        id: POSITION, analystId: PEAD, symbol: "KEYS", status: "OPEN", environment: "LIVE", quantity: 28, initialQty: 28, avgCost: 288.905,
        stopLoss: 257.93, initialStop: 257.93, stopReason: "Below the Nov. 5 swing low.", targetPrice: null, ...opts.position,
      }),
    ],
    order: [{ ...order(), status: "PENDING", orderType: "MARKET", createdAt: new Date("2026-11-23T20:55:54.231Z") }],
    thesisUpdate: opts.updates ?? [],
  });
}

const fill = (over: Record<string, unknown> = {}) => reconcile.applyFill(order(over) as never, PAID, 28, FILLED_AT);
const stock = () => (db.store.thesis as Row[])[0];
const position = () => (db.store.position as Row[])[0];
const promotions = () => ((db.store.thesisUpdate ?? []) as Row[]).filter((u) => u.type === "STATUS_CHANGED");
const afterBuySent = () => (inngest.send as jest.Mock).mock.calls.filter(([e]) => e?.name === "app/buy.filled");

beforeEach(() => (inngest.send as jest.Mock).mockClear());

describe("KEYS 2026-11-23: an approved buy whose send timed out fills in the order check", () => {
  it("the stock becomes a holding at the fill: the watch lines off, the sale on 6% under what was paid", async () => {
    seed();
    expect(await fill()).toBe(true);
    expect(stock()).toMatchObject({ status: "HOLDING" });
    expect(triggerSentences(stock())).toEqual(["Sell if below $272.25"]);
    expect((stock().triggers as Trigger[])[0]).toMatchObject({ action: "EXIT", fireMode: "DO_IT", source: "PRINCIPAL" });
    expect(position()).toMatchObject({ status: "OPEN", avgCost: PAID, stopLoss: 272.25 });
    expect(promotions()).toHaveLength(1);
    expect(promotions()[0]).toMatchObject({ thesisId: THESIS, tradeId: POSITION, priceAtTime: PAID, summary: "Promoted KEYS LONG WATCHING → HOLDING on its fill" });
    // After the buy reads a holding, so it runs.
    expect(afterBuySent()).toEqual([[{ name: "app/buy.filled", data: { orderId: ORDER } }]]);
  });

  it("as production had it, moved at its approval: the fill moves only the stop-when-buying line and writes no second promotion", async () => {
    const floor = { id: "033cc82b-499a-4969-89f7-7a68752d6102", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 272.22 }, rationale: "Sell if below $272.22. You set this." };
    seed({
      thesis: { status: "HOLDING", triggers: [floor] },
      position: { stopLoss: 272.22, avgCost: 289.6 },
      updates: [{ id: "approval_promotion", thesisId: THESIS, type: "STATUS_CHANGED", tradeId: POSITION, priceAtTime: 289.6, timestamp: new Date("2026-11-23T20:58:14.709Z"), summary: "Promoted KEYS LONG WATCHING → HOLDING on approved proposal" }],
    });
    await fill();
    expect(triggerSentences(stock())).toEqual(["Sell if below $272.25"]);
    expect(promotions()).toHaveLength(1);
    expect(promotions()[0]).toMatchObject({ id: "approval_promotion" });
  });

  it("made up: a Trade-ticket buy keeps your tighter $280 sale as yours", async () => {
    seed({ position: { stopLoss: 280, initialStop: 280, stopReason: null } });
    await fill({ rationale: MANUAL_RATIONALE });
    expect(triggerSentences(stock())).toEqual(["Sell if below $280"]);
    expect((stock().triggers as Trigger[])[0]).toMatchObject({ source: "PRINCIPAL" });
  });

  it("a fill already applied moves nothing", async () => {
    seed();
    await fill();
    await fill();
    expect(promotions()).toHaveLength(1);
  });

  it("an add's fill leaves the stock as it is", async () => {
    seed({ thesis: { status: "HOLDING", triggers: [] } });
    await fill({ intent: "ADD" });
    expect(promotions()).toHaveLength(0);
  });
});
