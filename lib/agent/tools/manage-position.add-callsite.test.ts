/**
 * manage-position.add-callsite.test.ts — the add's ORDER carries the share
 * count the live price implies, not the entry-era one.
 *
 * The sibling test covers the arithmetic; this one covers the wiring, which
 * is where the bug actually lived. Reverting the call site to
 * `Math.floor(notional / position.avgCost)` leaves the arithmetic test green
 * and turns these red (QB review, 2026-09-19).
 *
 * SMMT's real shape: bought at $14.35, trading at $18.00.
 */
const mockPositionFindFirst = jest.fn();
const mockOrderCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findFirst: mockPositionFindFirst, count: jest.fn().mockResolvedValue(1) },
    thesis: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    order: { create: mockOrderCreate, update: jest.fn().mockResolvedValue({}) },
    $transaction: mockTransaction,
    gateRejection: { create: jest.fn().mockResolvedValue({}) },
    agentConfig: { findUnique: jest.fn().mockResolvedValue({ name: "Catalyst Event PM", enabled: true, maxPositionSize: 50000, maxPositionTotal: 200000 }) },
    account: { findUnique: jest.fn().mockResolvedValue({ setupOverrides: {} }) },
    tradeDecision: { create: jest.fn().mockResolvedValue({}) },
    positionEvent: { create: jest.fn().mockResolvedValue({}) },
    thesisUpdate: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
  },
}));
const mockGetLatestPrice = jest.fn();
jest.mock("@/lib/alpaca", () => ({
  getAccount: jest.fn().mockResolvedValue({ buying_power: "1000000" }),
  getOrder: jest.fn(),
  getLatestPrice: mockGetLatestPrice,
  closePositionPartial: jest.fn(),
  placeMarketOrder: jest.fn().mockResolvedValue({ id: "alp_1", status: "accepted" }),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/proposals/maybe-await-approval", () => ({
  approvalRequired: jest.fn().mockResolvedValue(false),
  maybeAwaitApproval: jest.fn().mockResolvedValue(null),
  awaitingApprovalEnvelope: jest.fn().mockReturnValue({}),
  notifyProposalPending: jest.fn(),
  PROPOSAL_TTL_MS: 24 * 60 * 60 * 1000,
}));
jest.mock("@/lib/proposals/execute", () => ({ findRelatedThesisId: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/thesis-updates", () => ({ writeThesisUpdate: jest.fn().mockResolvedValue("tu_1") }));

import { managePosition } from "./manage-position";
import type { ToolContext } from "@/lib/agent/tool-context";

const SMMT = {
  id: "pos_smmt", userId: "user_1", analystId: "analyst_1", symbol: "SMMT",
  status: "OPEN", environment: "PAPER", direction: "LONG",
  quantity: 100, avgCost: 14.35, targetPrice: 26, stopLoss: 12,
  analyst: { name: "Catalyst Event PM" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tool = () =>
  managePosition({
    runId: "run_1", userId: "user_1", accountId: "account_1", analystId: "analyst_1",
    alpacaCreds: { keyId: "k", secretKey: "s" },
    maxPositionSize: 50_000, maxPositionTotal: 200_000,
    groupId: (p: string) => p,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as ToolContext) as unknown as { execute: (a: any) => Promise<any> };

beforeEach(() => {
  mockPositionFindFirst.mockReset().mockResolvedValue(SMMT);
  mockOrderCreate.mockReset().mockImplementation(async ({ data }) => ({ id: "ord_1", ...data }));
  mockTransaction.mockReset().mockImplementation(async (fn) => (typeof fn === "function" ? fn({ position: { update: jest.fn() }, order: { update: jest.fn() }, positionEvent: { create: jest.fn() } }) : []));
  mockGetLatestPrice.mockReset().mockResolvedValue(18.0);
});

const orderQty = () => {
  if (!mockOrderCreate.mock.calls.length) throw new Error("no order created — last result: " + JSON.stringify(lastResult).slice(0, 400));
  return mockOrderCreate.mock.calls[0][0].data.quantity as number;
};

let lastResult: unknown = null;

describe("add_to_position writes the order at today's price", () => {
  it("$5,000 into SMMT at $18.00 is 277 shares, not the 348 its $14.35 cost implies", async () => {
    lastResult = await tool().execute({ symbol: "SMMT", action: "add_to_position", add_notional: 5000, reason: "Pressing the winner on the pullback into the rising 20-day, per the seat's add rule." });
    expect(orderQty()).toBe(277);
  });

  it("when the quote fails it falls back to the average cost, never to zero", async () => {
    mockGetLatestPrice.mockRejectedValue(new Error("vendor down"));
    lastResult = await tool().execute({ symbol: "SMMT", action: "add_to_position", add_notional: 5000, reason: "Pressing the winner on the pullback into the rising 20-day, per the seat's add rule." });
    expect(orderQty()).toBe(348);
  });
});
