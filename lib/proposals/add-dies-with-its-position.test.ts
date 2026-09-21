/**
 * add-dies-with-its-position.test.ts — an add proposal does not outlive the
 * position it adds to (DAV-298).
 *
 * The sequence: an add sits awaiting approval for up to 24 hours. The stock
 * is sold in the meantime — a stop fires, a tactical run closes it, or Dave
 * closes it by hand. Nothing cancelled the add, nothing checked the position
 * on approval, and `reconcile-orders` skips an ADD whose position isn't OPEN.
 * So approving it bought shares at the broker that no position row covered:
 * no stop, no trigger, no thesis, invisible to every run, to the book-health
 * numbers and to the scorecard. The Order said FILLED and nothing else in the
 * system knew the shares existed.
 *
 * Two doors, and this closes both: the approval refuses, and closing a
 * position sweeps its pending adds out of the queue the way it already swept
 * pending sales.
 *
 * SMMT's real shape — 450 shares at $14.35, bought 2026-09-01.
 */

const ACCOUNT_ID = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const POSITION_ID = "cmtiwz2ua000704l7l0z60jfl";
const ANALYST_ID = "cmmmh0wxu000004js7yoyzvlf";

jest.mock("@/lib/prisma", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  prisma: require("./__fixtures__/position-db").prismaFake,
}));

const mockPlaceMarketOrder = jest.fn();
jest.mock("@/lib/alpaca", () => ({
  placeMarketOrder: (...a: unknown[]) => mockPlaceMarketOrder(...a),
  closePositionPartial: jest.fn(),
  getOrder: jest.fn(),
  getOrderByClientOrderId: jest.fn(),
  getLatestPrice: jest.fn().mockResolvedValue(18.0),
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
import { cancelOrphanedSellProposals } from "./position-lock";

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
    side: intent === "PARTIAL_CLOSE" || intent === "CLOSE" ? "SELL" : "BUY",
    orderType: "MARKET",
    quantity,
    status,
    intent,
    idempotencyKey: `idem-${id}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    rationale: "pressing the winner on the pullback",
    createdAt: new Date(),
  };
}

const byId = (id: string) => db.orders.find((o) => o.id === id)!;

beforeEach(() => {
  jest.clearAllMocks();
  resetDb(openPosition());
  mockPlaceMarketOrder.mockImplementation(async () => ({ id: `alpaca-${Math.random()}` }));
});

describe("approving an add after the stock was sold", () => {
  it("is refused and the proposal cancelled — nothing is bought", async () => {
    db.orders.push(order("add-1", "ADD", 100));
    // The stop fires overnight; the position closes by another path.
    db.positions.get(POSITION_ID)!.status = "CLOSED";
    db.positions.get(POSITION_ID)!.quantity = 0;

    await expect(approveProposal("add-1", ACCOUNT_ID)).rejects.toMatchObject({
      code: "POSITION_CLOSED",
    });

    expect(byId("add-1").status).toBe("CANCELLED");
    expect(byId("add-1").rejectionMessage).toContain("closed before this add was approved");
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });

  it("a position still staged for approval is not addable either", async () => {
    db.orders.push(order("add-1", "ADD", 100));
    db.positions.get(POSITION_ID)!.status = "PENDING_APPROVAL";

    await expect(approveProposal("add-1", ACCOUNT_ID)).rejects.toMatchObject({
      code: "POSITION_CLOSED",
    });
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });

  it("an add on a position that is still open is sent as before", async () => {
    db.orders.push(order("add-1", "ADD", 100));

    await approveProposal("add-1", ACCOUNT_ID);

    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
    expect(byId("add-1").status).toBe("PENDING");
  });
});

describe("closing a position sweeps its pending adds", () => {
  it("the add disappears from the queue alongside the pending sales", async () => {
    db.orders.push(order("add-1", "ADD", 100), order("trim-1", "PARTIAL_CLOSE", 200));

    const cancelled = await cancelOrphanedSellProposals(POSITION_ID);

    expect(cancelled).toBe(2);
    expect(byId("add-1").status).toBe("CANCELLED");
    expect(byId("trim-1").status).toBe("CANCELLED");
    expect(byId("add-1").rejectionMessage).toContain("Auto-cancelled");
  });

  it("the order that did the selling is never cancelled by its own sweep", async () => {
    db.orders.push(order("add-1", "ADD", 100), order("close-1", "CLOSE", 450));

    await cancelOrphanedSellProposals(POSITION_ID, "close-1");

    expect(byId("add-1").status).toBe("CANCELLED");
    expect(byId("close-1").status).toBe("AWAITING_APPROVAL");
  });

  it("a sweep with nothing pending is a no-op", async () => {
    expect(await cancelOrphanedSellProposals(POSITION_ID)).toBe(0);
  });
});
