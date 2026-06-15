/**
 * closeTrade.thesis-flip.test.ts — P1-18 coverage.
 *
 * Before this fix, `closeOpenPosition` closed the Position but never flipped
 * the paired Thesis. A price-monitor trailing-stop close (`source="price_
 * monitor"`) on an approval-OFF book therefore left an ACTIVE thesis with no
 * position — a desync. The fix wires the shared `closeThesisForPosition`
 * helper into the FILLED-close branch so every direct-fill close flips the
 * thesis ACTIVE → CLOSED and writes one CLOSED audit row.
 *
 * These tests pin:
 *   1. price_monitor FILLED close → paired ACTIVE thesis becomes CLOSED +
 *      exactly one CLOSED ThesisUpdate row carrying the ACTIVE→CLOSED status
 *      delta (the "STATUS_CHANGED" semantics, on the CLOSED row type that the
 *      dashboard + run-summary bucket on).
 *   2. The #390 interaction: when the close stages an AWAITING_APPROVAL
 *      proposal instead of filling, the thesis is NOT flipped here (the flip
 *      happens later via closeThesisOnApproval).
 */

// ── Prisma mock ────────────────────────────────────────────────────────────
const mockPositionFindUniqueOrThrow = jest.fn();
const mockThesisFindFirst = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockOrderCreate = jest.fn();
const mockOrderUpdate = jest.fn().mockResolvedValue({});
const mockPositionUpdateTx = jest.fn().mockResolvedValue({});
const mockPositionEventCreate = jest.fn().mockResolvedValue({});
const mockPositionManagementActionCreate = jest.fn().mockResolvedValue({});
const mockResearchRunFindUnique = jest.fn().mockResolvedValue(null);
const mockAgentConfigFindUnique = jest.fn().mockResolvedValue({ emailAlerts: false });

const mockTransaction = jest.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    order: { create: mockOrderCreate, update: mockOrderUpdate },
    position: { update: mockPositionUpdateTx },
    positionEvent: { create: mockPositionEventCreate },
    positionManagementAction: { create: mockPositionManagementActionCreate },
  }),
);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: {
      findUniqueOrThrow: mockPositionFindUniqueOrThrow,
      // used by closeThesisForPosition's audit context resolution path
      findFirst: jest.fn().mockResolvedValue(null),
    },
    thesis: {
      findFirst: mockThesisFindFirst,
      update: mockThesisUpdate,
    },
    order: { create: mockOrderCreate, update: mockOrderUpdate },
    researchRun: { findUnique: mockResearchRunFindUnique },
    agentConfig: { findUnique: mockAgentConfigFindUnique },
    $transaction: mockTransaction,
  },
}));

// ── writeThesisUpdate spy — assert the audit row shape ──────────────────────
const mockWriteThesisUpdate = jest.fn().mockResolvedValue("tu-1");
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: (...args: unknown[]) => mockWriteThesisUpdate(...args),
}));

// ── Alpaca mock — simulate an immediate FILLED close ────────────────────────
const mockPlaceMarketOrder = jest.fn();
const mockGetOrder = jest.fn();
const mockGetLatestPrice = jest.fn().mockResolvedValue(90);
jest.mock("@/lib/alpaca", () => ({
  placeMarketOrder: (...a: unknown[]) => mockPlaceMarketOrder(...a),
  getOrder: (...a: unknown[]) => mockGetOrder(...a),
  getLatestPrice: (...a: unknown[]) => mockGetLatestPrice(...a),
  cancelOrder: jest.fn(),
}));

// ── Approval gate — null = approval OFF, so the close executes ──────────────
const mockMaybeAwaitApproval = jest.fn();
jest.mock("@/lib/proposals/maybe-await-approval", () => ({
  maybeAwaitApproval: (...a: unknown[]) => mockMaybeAwaitApproval(...a),
}));

// ── Side-effect modules (non-fatal; stub to no-ops) ─────────────────────────
jest.mock("@/lib/inngest/client", () => ({
  inngest: { send: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  getUserEmail: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth/account", () => ({
  getOwnerUserId: jest.fn().mockResolvedValue("user-1"),
}));
jest.mock("@/lib/emails/trade-closed", () => ({
  tradeClosedHtml: jest.fn().mockReturnValue("<html></html>"),
}));
jest.mock("@/lib/email-suppression", () => ({
  isInsideMorningBatch: jest.fn().mockReturnValue(false),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({
  resolveAlpacaCredentials: jest.fn().mockResolvedValue(undefined),
}));

import { closeOpenPosition } from "./closeTrade.actions";

const OPEN_POSITION = {
  id: "pos-1",
  analystId: "analyst-1",
  userId: "user-1",
  accountId: "acct-1",
  environment: "PAPER",
  symbol: "NVDA",
  direction: "LONG",
  status: "OPEN",
  quantity: 10,
  avgCost: 100,
  stopLoss: 95,
  targetPrice: 130,
  openedAt: new Date("2026-06-03T14:30:00Z"),
};

const ACTIVE_THESIS = { id: "thesis-1", status: "ACTIVE" };

beforeEach(() => {
  jest.clearAllMocks();
  mockPositionFindUniqueOrThrow.mockResolvedValue({ ...OPEN_POSITION });
  mockThesisFindFirst.mockResolvedValue({ ...ACTIVE_THESIS });
  mockOrderCreate.mockResolvedValue({ id: "order-1" });
  mockPlaceMarketOrder.mockResolvedValue({ id: "alpaca-1" });
  // Immediate fill on first poll.
  mockGetOrder.mockResolvedValue({
    status: "filled",
    filled_avg_price: "92.00",
    filled_at: "2026-06-05T15:00:00Z",
  });
  // approval OFF by default → close executes (the desync-prone path).
  mockMaybeAwaitApproval.mockResolvedValue(null);
});

describe("closeOpenPosition — P1-18 paired-thesis flip", () => {
  it("price_monitor FILLED close retires the held thesis (RETIRED + SOLD) + writes one CLOSED audit row", async () => {
    const result = await closeOpenPosition(
      "pos-1",
      "STOP",
      undefined,
      "price_monitor",
    );

    // The position actually closed now (FILLED), not a pending/proposed path.
    expect(result.kind).toBe("closed");
    if (result.kind === "closed") {
      expect(result.fillStatus).toBe("FILLED");
    }

    // Thesis flipped held → RETIRED (retiredReason SOLD).
    expect(mockThesisFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ticker: "NVDA",
          status: { in: ["ACTIVE", "HOLDING"] },
          researchRun: { agentConfigId: "analyst-1" },
        }),
      }),
    );
    expect(mockThesisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "thesis-1" },
        data: expect.objectContaining({ status: "RETIRED", retiredReason: "SOLD" }),
      }),
    );

    // Exactly one audit row, type CLOSED (event kind unchanged), carrying the
    // ACTIVE→RETIRED status delta + the retiredReason.
    expect(mockWriteThesisUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteThesisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        thesisId: "thesis-1",
        type: "CLOSED",
        fieldChanges: {
          status: { from: "ACTIVE", to: "RETIRED" },
          retiredReason: { from: null, to: "SOLD" },
        },
      }),
    );
  });

  it("no-ops the flip when there is no matching ACTIVE thesis (idempotent)", async () => {
    mockThesisFindFirst.mockResolvedValue(null);

    const result = await closeOpenPosition(
      "pos-1",
      "STOP",
      undefined,
      "price_monitor",
    );

    expect(result.kind).toBe("closed");
    // Position still closes; thesis side simply no-ops — no update, no audit row.
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });

  it("#390 interaction: an AWAITING_APPROVAL proposal does NOT flip the thesis here", async () => {
    // approval ON → maybeAwaitApproval stages a proposal and returns early.
    mockMaybeAwaitApproval.mockResolvedValue({
      orderId: "order-1",
      expiresAt: new Date("2026-06-06T15:00:00Z"),
      rationale: "Automated STOP exit — NVDA",
    });

    const result = await closeOpenPosition(
      "pos-1",
      "STOP",
      undefined,
      "price_monitor",
    );

    // Staged as a proposal — the position is NOT closed now.
    expect(result.kind).toBe("proposed");
    // The flip is deferred to closeThesisOnApproval on approval — not here.
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
    // And we never even submitted to Alpaca on the proposed path.
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });
});
