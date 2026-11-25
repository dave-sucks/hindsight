/**
 * A sale that fills in the order check moves the stock off Holding, from the
 * check's own entry point (applyFill) on a real Close-button order.
 *
 * CEG (Secular Compounder, PAPER): the Close button at 11:48 PM ET on
 * 2026-08-11, 44 shares (order cmspjupqq000304jrxqdebi1p, position
 * cmsn6ntgy000z04l4pxx0rkqj). The market was shut, so the close's own
 * five-second wait saw no fill and left the order PENDING; the order check
 * applied the fill at 9:32 the next morning, $281.430909 against $271.58 paid.
 * That night the promotion to LIVE had already moved the stock (PROMOTED), so
 * the stock read right. A plain Close click leaves it Holding, and before this
 * fix the check closed the position and the stock went on reading Holding.
 * Only the database, the broker and the event sender are doubled.
 */
import { prismaDouble, thesisRow, positionRow, type PrismaDouble, type Row } from "@/lib/replay";

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

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const POSITION = "cmsn6ntgy000z04l4pxx0rkqj";
const ORDER = "cmspjupqq000304jrxqdebi1p";
const FILL = 281.430909;
const FILLED_AT = new Date("2026-08-12T13:32:19.304Z");

/** The order as the check loads it: PENDING, the Close button's reason and source, no words, no attestation. */
const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER,
  userId: "u1",
  environment: "PAPER",
  positionId: POSITION,
  symbol: "CEG",
  side: "SELL",
  quantity: 44,
  alpacaOrderId: "alpaca_ceg_close",
  idempotencyKey: "ceg-close",
  intent: "CLOSE",
  closeReason: "MANUAL",
  closeSource: "user",
  rationale: null,
  closeBeliefSurvived: null,
  thesisId: "thesis_ceg",
  triggerIds: [],
  ...over,
});

function seed(opts: { thesis?: Partial<Row>; order?: Record<string, unknown>; positions?: Row[] } = {}) {
  db = prismaDouble({
    thesis: [thesisRow({ id: "thesis_ceg", ticker: "CEG", status: "HOLDING", direction: "LONG", analystId: SECULAR, ...opts.thesis })],
    position: [
      positionRow({ id: POSITION, analystId: SECULAR, symbol: "CEG", status: "OPEN", quantity: 44, initialQty: 44, avgCost: 271.58 }),
      ...(opts.positions ?? []),
    ],
    order: [{ ...order(opts.order), status: "PENDING", orderType: "MARKET", createdAt: new Date("2026-08-12T03:48:35.608Z") }],
  });
}

const fill = (over: Record<string, unknown> = {}) => reconcile.applyFill(order(over) as never, FILL, 44, FILLED_AT);
const stock = () => (db.store.thesis as Row[]).find((t) => t.id === "thesis_ceg")!;
const closedLines = () => ((db.store.thesisUpdate ?? []) as Row[]).filter((u) => u.thesisId === "thesis_ceg" && u.type === "CLOSED");

describe("CEG 2026-08-12: the Close button's sale fills at the open", () => {
  it("the stock is sold when the order check applies the fill, with one line at the fill price", async () => {
    seed();
    expect(await fill()).toBe(true);
    expect((db.store.position as Row[]).find((p) => p.id === POSITION)).toMatchObject({ status: "CLOSED", closePrice: FILL, closeReason: "MANUAL" });
    expect(stock()).toMatchObject({ status: "RETIRED", retiredReason: "SOLD", closeReason: "MANUAL" });
    expect(closedLines()).toHaveLength(1);
    expect(closedLines()[0]).toMatchObject({ priceAtTime: FILL });
  });

  it("a stock another path already moved (that night's promotion) is left as it is", async () => {
    seed({ thesis: { status: "PROMOTED" } });
    await fill();
    expect(stock()).toMatchObject({ status: "PROMOTED" });
    expect(closedLines()).toHaveLength(0);
  });

  it("an approved sale, moved at its approval, gets no second line at its fill", async () => {
    seed({ thesis: { status: "WATCHING", closeReason: "STOP" }, order: { closeSource: "agent", closeReason: "STOP", closeBeliefSurvived: true } });
    await fill({ closeSource: "agent", closeReason: "STOP", closeBeliefSurvived: true });
    expect(stock()).toMatchObject({ status: "WATCHING" });
    expect(closedLines()).toHaveLength(0);
  });

  it("an agent's sale that attested the belief survived goes back on watch at its fill", async () => {
    seed({ order: { closeSource: "agent", closeReason: "STOP", closeBeliefSurvived: true } });
    await fill({ closeSource: "agent", closeReason: "STOP", closeBeliefSurvived: true });
    expect(stock()).toMatchObject({ status: "WATCHING", retiredReason: null });
    expect(closedLines()).toHaveLength(1);
  });

  it("a stock the analyst bought again before the old sale filled stays Holding", async () => {
    seed({ positions: [positionRow({ id: "pos_ceg_again", analystId: SECULAR, symbol: "CEG", status: "OPEN", quantity: 30, avgCost: 270 })] });
    await fill();
    expect(stock()).toMatchObject({ status: "HOLDING" });
    expect(closedLines()).toHaveLength(0);
  });

  it("a trim's fill leaves the stock Holding", async () => {
    seed({ order: { intent: "PARTIAL_CLOSE", thesisId: null } });
    await fill({ intent: "PARTIAL_CLOSE", thesisId: null, quantity: 20 });
    expect(stock()).toMatchObject({ status: "HOLDING" });
    expect(closedLines()).toHaveLength(0);
  });

  it("a fill already applied moves nothing", async () => {
    seed();
    await fill();
    await fill();
    expect(closedLines()).toHaveLength(1);
  });
});
