/**
 * buys-and-fills.test.ts — DAV-283, the buy side of one position, many writers.
 *
 * 1. The "most in one stock" limit is checked when an add is queued. Two adds
 *    that each fit then could both be approved, and together take the position
 *    past the limit.
 * 2. The background fill job overwrote the share count instead of subtracting
 *    from it: two fills landing together lost one of them, the count read high,
 *    and the next full close sold shares that were already gone.
 *
 * Both run against the shared in-memory database, whose position lock behaves
 * like Postgres: the second transaction waits for the first.
 */

const ACCOUNT_ID = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const POSITION_ID = "cmtiwz2ua000704l7l0z60jfl";
const ANALYST_ID = "cmmmh0wxu000004js7yoyzvlf";

jest.mock("@/lib/prisma", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  prisma: require("./__fixtures__/position-db").prismaFake,
}));

const mockPlaceMarketOrder = jest.fn();
const mockGetLatestPrice = jest.fn();
jest.mock("@/lib/alpaca", () => ({
  placeMarketOrder: (...a: unknown[]) => mockPlaceMarketOrder(...a),
  closePositionPartial: jest.fn(),
  getOrder: jest.fn(),
  getOrderByClientOrderId: jest.fn(),
  getLatestPrice: (...a: unknown[]) => mockGetLatestPrice(...a),
  cancelOrder: jest.fn(),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => undefined }));
jest.mock("@/lib/proposals/thesis-flips", () => ({
  promoteThesisOnApproval: jest.fn(),
  closeThesisOnApproval: jest.fn(),
  closeThesisForPosition: jest.fn(),
}));
jest.mock("@/lib/agent/thesis-updates", () => ({ writeThesisUpdate: jest.fn().mockResolvedValue("tu") }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));

import { db, resetDb, type Row } from "./__fixtures__/position-db";
import { approveProposal } from "./execute";
import { __test__ as reconcile } from "@/lib/inngest/functions/reconcile-orders";

/** 450 shares at $14.35 = $6,457.50 held, against a $10,000 most-in-one-stock. */
function openPosition(over: Row = {}): Row {
  return {
    id: POSITION_ID,
    accountId: ACCOUNT_ID,
    userId: ACCOUNT_ID,
    analystId: ANALYST_ID,
    symbol: "SMMT",
    direction: "LONG",
    status: "OPEN",
    environment: "LIVE",
    quantity: 450,
    avgCost: 14.35,
    openedAt: new Date("2026-09-01T21:15:27.803Z"),
    ...over,
  };
}

function order(id: string, intent: string, quantity: number, status = "AWAITING_APPROVAL"): Row {
  return {
    id,
    positionId: POSITION_ID,
    userId: ACCOUNT_ID,
    environment: "LIVE",
    symbol: "SMMT",
    side: intent === "PARTIAL_CLOSE" ? "SELL" : "BUY",
    orderType: "MARKET",
    quantity,
    status,
    intent,
    idempotencyKey: `idem-${id}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    rationale: "adding to the winner",
    createdAt: new Date(),
  };
}

const position = () => db.positions.get(POSITION_ID)!;
const heldValue = () => (position().quantity as number) * (position().avgCost as number);

beforeEach(() => {
  jest.clearAllMocks();
  resetDb(openPosition());
  mockPlaceMarketOrder.mockImplementation(async () => ({ id: `alpaca-${Math.random()}` }));
  mockGetLatestPrice.mockResolvedValue(14.35); // flat: live price = average cost
});

describe("DAV-283 — an add fits the most this analyst may hold in one stock", () => {
  it("two adds approved together stay inside the limit — the second is sized to the room left", async () => {
    db.orders.push(order("add-1", "ADD", 200), order("add-2", "ADD", 200));

    await approveProposal("add-1", ACCOUNT_ID);
    await approveProposal("add-2", ACCOUNT_ID);

    // $6,457.50 held + 200 sh ($2,870) sent leaves $672.50 — 46 shares at $14.35.
    expect(mockPlaceMarketOrder.mock.calls.map((c) => c[0].qty)).toEqual([200, 46]);
    const bought = mockPlaceMarketOrder.mock.calls.reduce((n, c) => n + c[0].qty * 14.35, 0);
    expect(heldValue() + bought).toBeLessThanOrEqual(10_000);
    expect(db.orders.find((o) => o.id === "add-2")!.quantity).toBe(46);
  });

  it("both approved at the same moment — still inside the limit", async () => {
    db.orders.push(order("add-1", "ADD", 200), order("add-2", "ADD", 200));

    await Promise.all([approveProposal("add-1", ACCOUNT_ID), approveProposal("add-2", ACCOUNT_ID)]);

    const bought = mockPlaceMarketOrder.mock.calls.reduce((n, c) => n + c[0].qty * 14.35, 0);
    expect(heldValue() + bought).toBeLessThanOrEqual(10_000);
  });

  it("an add on a position already at the limit is cancelled with a plain reason, not bought", async () => {
    resetDb(openPosition({ quantity: 700 })); // $10,045 held
    db.orders.push(order("add-1", "ADD", 200));

    await expect(approveProposal("add-1", ACCOUNT_ID)).rejects.toMatchObject({
      code: "NO_ROOM_IN_POSITION",
    });

    const add = db.orders.find((o) => o.id === "add-1")!;
    expect(add.status).toBe("CANCELLED");
    expect(add.rejectionMessage).toContain("most this analyst may hold in one stock");
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });

  it("the position's own opening buy isn't charged twice while it is still filling", async () => {
    // 450 shares held at $14.35 and its opening order still PENDING: the room
    // left is $3,542.50, not nothing.
    db.orders.push(order("open-1", "OPEN", 450, "PENDING"), order("add-1", "ADD", 100));

    await approveProposal("add-1", ACCOUNT_ID);

    expect(mockPlaceMarketOrder.mock.calls[0][0].qty).toBe(100);
  });

  it("a stock up 25% is added at what it costs now, not what we paid", async () => {
    // The QB's example: $10,000 limit, 60 sh held at $100 ($6,000 at cost),
    // price now $125, two $4,000 adds queued (32 shares each).
    resetDb(openPosition({ quantity: 60, avgCost: 100 }));
    mockGetLatestPrice.mockResolvedValue(125);
    db.orders.push(order("add-1", "ADD", 32), order("add-2", "ADD", 32));

    await approveProposal("add-1", ACCOUNT_ID);
    const second = await approveProposal("add-2", ACCOUNT_ID).catch((e) => e);

    // First buys 32 sh = $4,000; that fills the room, so the second is cancelled.
    const bought = mockPlaceMarketOrder.mock.calls.reduce((n, c) => n + c[0].qty * 125, 0);
    expect(mockPlaceMarketOrder.mock.calls.map((c) => c[0].qty)).toEqual([32]);
    expect(6_000 + bought).toBeLessThanOrEqual(10_000);
    expect(second).toMatchObject({ code: "NO_ROOM_IN_POSITION" });
  });

  it("a quote that fails falls back to average cost — the add is still sent", async () => {
    mockGetLatestPrice.mockRejectedValue(new Error("quote unavailable"));
    db.orders.push(order("add-1", "ADD", 100));

    await approveProposal("add-1", ACCOUNT_ID);

    expect(mockPlaceMarketOrder.mock.calls[0][0].qty).toBe(100);
  });

  it("an add that still fits is sent whole", async () => {
    db.orders.push(order("add-1", "ADD", 100));

    await approveProposal("add-1", ACCOUNT_ID);

    expect(mockPlaceMarketOrder.mock.calls[0][0].qty).toBe(100);
    expect(db.orders.find((o) => o.id === "add-1")!.quantity).toBe(100);
  });
});

describe("DAV-283 — a fill adds to and subtracts from the share count", () => {
  const fill = (id: string, intent: string, qty: number, price: number) =>
    reconcile.applyFillByIntent(
      { id, positionId: POSITION_ID, symbol: "SMMT", side: intent === "ADD" ? "BUY" : "SELL", intent, quantity: qty } as never,
      price,
      qty,
      new Date("2026-09-17T14:00:00Z"),
    );

  it("two trims filling at the same moment both come off the share count", async () => {
    db.orders.push(order("trim-1", "PARTIAL_CLOSE", 100, "PENDING"), order("trim-2", "PARTIAL_CLOSE", 100, "PENDING"));

    await Promise.all([fill("trim-1", "PARTIAL_CLOSE", 100, 18), fill("trim-2", "PARTIAL_CLOSE", 100, 18)]);

    expect(position().quantity).toBe(250);
  });

  it("two adds filling at the same moment both go on, and the average cost counts both", async () => {
    db.orders.push(order("add-1", "ADD", 50, "PENDING"), order("add-2", "ADD", 50, "PENDING"));

    await Promise.all([fill("add-1", "ADD", 50, 20), fill("add-2", "ADD", 50, 20)]);

    expect(position().quantity).toBe(550);
    // (450 × 14.35 + 100 × 20) ÷ 550
    expect(position().avgCost).toBeCloseTo(15.3773, 4);
  });

  it("a fill is applied once — a replayed fill leaves the count alone", async () => {
    db.orders.push(order("trim-1", "PARTIAL_CLOSE", 100, "PENDING"));

    await fill("trim-1", "PARTIAL_CLOSE", 100, 18);
    await fill("trim-1", "PARTIAL_CLOSE", 100, 18);

    expect(position().quantity).toBe(350);
  });
});
