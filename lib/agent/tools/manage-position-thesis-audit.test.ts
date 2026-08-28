/**
 * manage-position-thesis-audit.test.ts — plan changes land on the thesis
 * timeline (DAV-198).
 *
 * Before this, manage_position wrote PositionManagementAction / PositionEvent
 * rows but never a ThesisUpdate — so a stop move, target change, or trim was
 * invisible in the thesis activity log the analyst and the sheet read. These
 * tests prove each plan-changing action writes one UPDATED row on the paired
 * thesis (resolved via findRelatedThesisId, the same linkage the proposal
 * audit rows use), and that a position with no resolvable thesis still
 * completes the action without an audit write.
 */

const mockPositionFindFirst = jest.fn();
const mockThesisFindUnique = jest.fn().mockResolvedValue(null);
const mockOrderCreate = jest.fn();
const mockOrderUpdate = jest.fn().mockResolvedValue({});
const mockTransaction = jest.fn();
const mockWriteThesisUpdate = jest.fn().mockResolvedValue("tu_1");
const mockFindRelatedThesisId = jest.fn();
const mockMaybeAwaitApproval = jest.fn().mockResolvedValue(null);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findFirst: mockPositionFindFirst, count: jest.fn().mockResolvedValue(1) },
    thesis: { findUnique: mockThesisFindUnique, update: jest.fn() },
    order: { create: mockOrderCreate, update: mockOrderUpdate },
    $transaction: mockTransaction,
    gateRejection: { create: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock("@/lib/alpaca", () => ({
  getAccount: jest.fn().mockResolvedValue({ buying_power: "10000" }),
  getOrder: jest.fn(),
  getLatestPrice: jest.fn().mockResolvedValue(100),
  closePositionPartial: jest.fn(),
  placeMarketOrder: jest.fn(),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({
  resolveAlpacaCredentials: jest.fn().mockResolvedValue({}),
}));
jest.mock("@/lib/proposals/maybe-await-approval", () => ({
  maybeAwaitApproval: mockMaybeAwaitApproval,
  awaitingApprovalEnvelope: jest.fn().mockReturnValue({}),
}));
jest.mock("@/lib/proposals/execute", () => ({
  findRelatedThesisId: mockFindRelatedThesisId,
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: mockWriteThesisUpdate,
}));

import { managePosition } from "./manage-position";
import { getOrder, closePositionPartial } from "@/lib/alpaca";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_198",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    alpacaCreds: { apiKey: "k", apiSecret: "s" },
    groupId: (phase: string) => phase,
    ...overrides,
  } as ToolContext;
}

/** An open LONG paper position the actions operate on. */
function makeOpenPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos_1",
    userId: "user_1",
    analystId: "analyst_1",
    symbol: "NVDA",
    status: "OPEN",
    environment: "PAPER",
    direction: "LONG",
    quantity: 10,
    avgCost: 100,
    targetPrice: 120,
    stopLoss: 90,
    analyst: { name: "Test Analyst" },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTool(): { execute: (args: any) => Promise<any> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return managePosition(makeCtx()) as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: (args: any) => Promise<any>;
  };
}

const REASON =
  "Raising protection into earnings — the setup has played out faster than planned.";

describe("manage_position — plan changes write the thesis history row (DAV-198)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockThesisFindUnique.mockResolvedValue(null); // moveThesisLevels no-ops
    mockFindRelatedThesisId.mockResolvedValue("thesis_1");
    mockMaybeAwaitApproval.mockResolvedValue(null);
    // Run the tx callback against the same mocked delegates.
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        position: { update: jest.fn().mockResolvedValue({}) },
        positionEvent: { create: jest.fn().mockResolvedValue({}) },
        positionManagementAction: { create: jest.fn().mockResolvedValue({}) },
        runEvent: { create: jest.fn().mockResolvedValue({}) },
        tradeDecision: { create: jest.fn().mockResolvedValue({}) },
        order: { update: mockOrderUpdate },
      }),
    );
  });

  it("update_targets writes an UPDATED row with target and stop from → to", async () => {
    mockPositionFindFirst.mockResolvedValueOnce(makeOpenPosition());

    const result = await makeTool().execute({
      symbol: "NVDA",
      action: "update_targets",
      reason: REASON,
      new_target_price: 130,
      new_stop_loss: 95,
    });

    expect(result.data.status).toBe("UPDATED");
    expect(mockWriteThesisUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteThesisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        thesisId: "thesis_1",
        type: "UPDATED",
        rationale: REASON,
        runId: "run_test_198",
        tradeId: "pos_1",
        fieldChanges: {
          targetPrice: { from: 120, to: 130 },
          stopLoss: { from: 90, to: 95 },
        },
      }),
    );
  });

  it("update_targets with only a stop diffs only the stop", async () => {
    mockPositionFindFirst.mockResolvedValueOnce(makeOpenPosition());

    await makeTool().execute({
      symbol: "NVDA",
      action: "update_targets",
      reason: REASON,
      new_stop_loss: 95,
    });

    const call = mockWriteThesisUpdate.mock.calls[0][0];
    expect(call.fieldChanges).toEqual({ stopLoss: { from: 90, to: 95 } });
  });

  it("move_stop_to_breakeven writes an UPDATED row with the stop moving to avg cost", async () => {
    mockPositionFindFirst.mockResolvedValueOnce(makeOpenPosition());

    const result = await makeTool().execute({
      symbol: "NVDA",
      action: "move_stop_to_breakeven",
      reason: REASON,
    });

    expect(result.data.status).toBe("UPDATED");
    expect(mockWriteThesisUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteThesisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        thesisId: "thesis_1",
        type: "UPDATED",
        rationale: REASON,
        tradeId: "pos_1",
        fieldChanges: { stopLoss: { from: 90, to: 100 } },
      }),
    );
  });

  it("a filled partial close writes the trim to the thesis timeline", async () => {
    mockPositionFindFirst.mockResolvedValueOnce(makeOpenPosition());
    mockOrderCreate.mockResolvedValueOnce({ id: "order_1" });
    (closePositionPartial as jest.Mock).mockResolvedValueOnce({ id: "alp_1" });
    (getOrder as jest.Mock).mockResolvedValueOnce({
      status: "filled",
      filled_avg_price: "110",
      filled_qty: "3",
    });

    const result = await makeTool().execute({
      symbol: "NVDA",
      action: "partial_close",
      reason: REASON,
      close_pct: 30,
      close_reason: "RISK_MANAGEMENT",
    });

    expect(result.data.status).toBe("PARTIAL_CLOSE");
    expect(mockWriteThesisUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteThesisUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        thesisId: "thesis_1",
        type: "UPDATED",
        rationale: REASON,
        tradeId: "pos_1",
        priceAtTime: 110,
        fieldChanges: {
          position: { from: "10 shares", to: "7 shares" },
        },
      }),
    );
    expect(mockWriteThesisUpdate.mock.calls[0][0].summary).toContain("Trimmed NVDA 30%");
  });

  it("a position with no resolvable thesis still completes without an audit write", async () => {
    mockPositionFindFirst.mockResolvedValueOnce(makeOpenPosition());
    mockFindRelatedThesisId.mockRejectedValueOnce(new Error("no thesis"));

    const result = await makeTool().execute({
      symbol: "NVDA",
      action: "update_targets",
      reason: REASON,
      new_stop_loss: 95,
    });

    expect(result.data.status).toBe("UPDATED");
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });
});
