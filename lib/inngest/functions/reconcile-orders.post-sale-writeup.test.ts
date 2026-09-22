/**
 * reconcile-orders.post-sale-writeup.test.ts — a sale gets its write-up when
 * it fills, not at 5pm (DAV-304).
 *
 * Replay: SMMT, position cmtiwz2ua000704l7l0z60jfl, order
 * cmubdn37i000d04jv1ky7jip0, 2026-09-21.
 *   11:05 ET  close proposed (STOP)
 *   11:18 ET  the principal approves; the order goes to Alpaca
 *   11:18 ET  filled at $16.9232 — +$1,157.94, +17.9%, the best trade of the month
 *   17:01 ET  the EOD sweep finally sends `trade/closed` and the write-up lands
 *
 * `trade/closed` is what wakes the evaluator, and this job — the one that
 * applies every approval-path fill — never sent it. For five and three
 * quarter hours the sale read as a trade nobody had graded, and had the sweep
 * not run (it returns early when nothing is open) it would have read that way
 * forever.
 */
const mockSend = jest.fn().mockResolvedValue(undefined);
const mockTransaction = jest.fn();
const mockFindUnique = jest.fn();
const mockCancelOrphans = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/inngest/client", () => ({
  inngest: { createFunction: jest.fn(() => ({})), send: mockSend },
}));
jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mockTransaction, position: { findUnique: mockFindUnique } },
}));
jest.mock("@/lib/proposals/position-lock", () => ({
  lockPositionRow: jest.fn().mockResolvedValue(undefined),
  cancelOrphanedSellProposals: mockCancelOrphans,
}));
jest.mock("@/lib/alpaca", () => ({ getOrder: jest.fn(), getOrderByClientOrderId: jest.fn() }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn() }));

import { __test__ } from "./reconcile-orders";

const { applyFillByIntent, maybeEvaluateClosedPosition } = __test__;

/** SMMT's real closing order, as reconcile loads it. */
const SMMT_CLOSE = {
  id: "cmubdn37i000d04jv1ky7jip0",
  userId: "u1",
  environment: "LIVE",
  positionId: "cmtiwz2ua000704l7l0z60jfl",
  symbol: "SMMT",
  side: "SELL",
  quantity: 450,
  alpacaOrderId: "e6826779-9276-4022-8daa-5e517bf0d994",
  idempotencyKey: "63d4c566",
  intent: "CLOSE",
  closeReason: "STOP",
  closeSource: "price_monitor",
};

const SMMT_POSITION = {
  id: "cmtiwz2ua000704l7l0z60jfl",
  symbol: "SMMT",
  analystId: "a1",
  status: "OPEN",
  direction: "LONG",
  avgCost: 14.3499,
  quantity: 450,
  closeReason: null,
  closeSource: null,
};

/** A transaction client that accepts the writes the CLOSE branch makes. */
function txStub(position: Record<string, unknown> | null = SMMT_POSITION) {
  return {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    position: { findUnique: jest.fn().mockResolvedValue(position), update: jest.fn().mockResolvedValue({}) },
    positionEvent: { create: jest.fn().mockResolvedValue({}) },
    thesis: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  };
}

beforeEach(() => {
  mockSend.mockClear();
  mockFindUnique.mockReset().mockResolvedValue({ status: "CLOSED", agentEvaluation: null, events: [] });
  mockTransaction.mockReset().mockImplementation(async (fn: (tx: unknown) => Promise<boolean>) => fn(txStub()));
});

describe("SMMT 2026-09-21 — the approval-path fill asks for its write-up", () => {
  it("a reconciled CLOSE fill sends trade/closed", async () => {
    await applyFillByIntent(SMMT_CLOSE, 16.9232, 450, new Date("2026-09-21T15:18:43.963Z"));
    expect(mockSend).toHaveBeenCalledWith({
      name: "trade/closed",
      data: { positionId: "cmtiwz2ua000704l7l0z60jfl" },
    });
  });

  it("a fill the transaction did not apply asks for nothing", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<boolean>) =>
      fn({ ...txStub(), order: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } }),
    );
    await applyFillByIntent(SMMT_CLOSE, 16.9232, 450, new Date("2026-09-21T15:18:43.963Z"));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a buy fill is not a sale", async () => {
    await applyFillByIntent(
      { ...SMMT_CLOSE, intent: "OPEN", side: "BUY" },
      14.3499,
      450,
      new Date("2026-08-28T13:31:00Z"),
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("it asks once", () => {
  it("a position that already has its write-up is left alone", async () => {
    mockFindUnique.mockResolvedValue({
      status: "CLOSED",
      agentEvaluation: "### Post-Trade Evaluation of SMMT Long Position…",
      events: [],
    });
    await maybeEvaluateClosedPosition(SMMT_CLOSE);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("…or already has its EVALUATED event", async () => {
    mockFindUnique.mockResolvedValue({ status: "CLOSED", agentEvaluation: null, events: [{ id: "e1" }] });
    await maybeEvaluateClosedPosition(SMMT_CLOSE);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a partial close leaves the position open, so there is nothing to grade", async () => {
    mockFindUnique.mockResolvedValue({ status: "OPEN", agentEvaluation: null, events: [] });
    await maybeEvaluateClosedPosition(SMMT_CLOSE);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a legacy order with no intent is read off its side", async () => {
    await maybeEvaluateClosedPosition({ ...SMMT_CLOSE, intent: null });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("a failed lookup never turns a good fill into a reconcile error", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    await expect(maybeEvaluateClosedPosition(SMMT_CLOSE)).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
