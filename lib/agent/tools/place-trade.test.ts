/**
 * place-trade.test.ts — regression guard for the deleted staleness gate.
 *
 * Pre-P1-1, place_trade carried a Layer-1 gate that refused entries on
 * WATCHING/PROMOTED theses when `classifyResearchAge(researchUpdatedAt)`
 * came back stale or missing (lib/agent/tools/place-trade.ts:160-243,
 * before the delete). The gate was the wrong layer — staleness is a
 * judgment call that belongs to the REVIEW flow, not a tool-level
 * refusal at execution time. See docs/plans/REVIEW_REFRESH_CADENCE.md.
 *
 * These tests assert the gate is gone: with a thesis whose research
 * would have failed the old gate, place_trade now advances past the
 * former gate site to subsequent guardrails (Guardrail 3 target/stop
 * shape) and ultimately to Alpaca submission. The failure modes the
 * tests observe are the LATER guardrails, never a "research is stale"
 * rejection.
 */

const mockThesisFindUnique = jest.fn();
const mockPositionFindFirst = jest.fn();
const mockPositionCreate = jest.fn();
const mockOrderCreate = jest.fn();
const mockOrderUpdate = jest.fn().mockResolvedValue({});
const mockPositionEventCreate = jest.fn().mockResolvedValue({});
const mockTradeDecisionCreate = jest.fn().mockResolvedValue({});
const mockRunEventCreate = jest.fn().mockResolvedValue({});
const mockTransaction = jest.fn();

const mockAgentConfigFindUnique = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findUnique: mockThesisFindUnique },
    position: {
      findFirst: mockPositionFindFirst,
      create: mockPositionCreate,
    },
    order: { create: mockOrderCreate, update: mockOrderUpdate },
    positionEvent: { create: mockPositionEventCreate },
    tradeDecision: { create: mockTradeDecisionCreate },
    runEvent: { create: mockRunEventCreate },
    agentConfig: { findUnique: mockAgentConfigFindUnique },
    $transaction: mockTransaction,
  },
}));

const mockPlaceMarketOrder = jest.fn();
const mockGetOrder = jest.fn();
const mockGetLatestPrice = jest.fn();
const mockGetAccount = jest.fn();

jest.mock("@/lib/alpaca", () => ({
  placeMarketOrder: mockPlaceMarketOrder,
  getOrder: mockGetOrder,
  getLatestPrice: mockGetLatestPrice,
  getAccount: mockGetAccount,
}));

jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  getUserEmail: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/auth/account", () => ({
  getOwnerUserId: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/emails/trade-opened", () => ({
  tradeOpenedHtml: jest.fn().mockReturnValue("<html />"),
}));

jest.mock("@/lib/email-suppression", () => ({
  isInsideMorningBatch: jest.fn().mockReturnValue(false),
}));

import { placeTrade } from "./place-trade";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_1",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    minConfidence: null,
    maxOpenPositions: null,
    maxPositionSize: null,
    runEnvironment: "PAPER",
    ...overrides,
  } as ToolContext;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTool(ctx: ToolContext): { execute: (args: any) => Promise<any> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return placeTrade(ctx) as unknown as { execute: (args: any) => Promise<any> };
}

describe("place_trade — staleness gate removed (P1-1)", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockPositionFindFirst.mockReset();
    mockPositionCreate.mockReset();
    mockOrderCreate.mockReset();
    mockTransaction.mockReset();
    mockPlaceMarketOrder.mockReset();
    mockGetOrder.mockReset();
    mockGetLatestPrice.mockReset();
    mockGetAccount.mockReset();
    mockAgentConfigFindUnique.mockReset();
    // Default: analyst is enabled. Tests for the disabled-gate override this.
    mockAgentConfigFindUnique.mockResolvedValue({
      enabled: true,
      name: "Test Analyst",
    });
  });

  it("does not refuse with 'research is stale' on a LONG thesis (advances past former gate site)", async () => {
    // The old gate fired at the directionCheck site, before Guardrail 3.
    // Provide args that fail Guardrail 3 (target below entry on a LONG)
    // and observe the rejection message: it is the invalid-shape one,
    // not the staleness one.
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "LONG" });
    mockPositionFindFirst.mockResolvedValueOnce(null);

    const result = await makeTool(makeCtx()).execute({
      ticker: "NVDA",
      direction: "LONG",
      entry_price: 100,
      target_price: 90, // invalid for LONG — fails Guardrail 3
      stop_loss: 80,
      thesis_id: "thesis_stale_watching",
      notional: 5000,
    });

    expect(result.data.success).toBe(false);
    expect(result.data.tickers[0].tag).not.toBe("Stale");
    expect(String(result.summary)).not.toMatch(/research is/i);
    expect(String(result.summary)).toMatch(/invalid target\/stop/i);
  });

  it("succeeds (uncertain Alpaca submit → success:true, PENDING) on what would have been a stale-research refusal", async () => {
    // Setup: a LONG thesis whose pre-P1-1 research would have failed the
    // staleness gate. We exercise the call all the way to Alpaca's
    // placeMarketOrder, then simulate a transient network error so the
    // code takes the "uncertain submit" branch which returns success:true
    // with status:PENDING. The point: the staleness gate did NOT refuse
    // and the call reached external submission.
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "LONG" });
    mockPositionFindFirst.mockResolvedValueOnce(null);

    // Live-price guardrail's quote fetch — non-fatal on throw, the live-
    // price guardrail then skips.
    mockGetLatestPrice.mockRejectedValueOnce(new Error("no creds"));

    // DB transaction: invoke the callback with our mock client and
    // return whatever the callback produces.
    mockPositionCreate.mockResolvedValue({
      id: "pos_1",
      symbol: "NVDA",
      direction: "LONG",
      quantity: 50,
    });
    mockOrderCreate.mockResolvedValue({ id: "order_1" });
    mockTransaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (arg as (tx: any) => Promise<unknown>)({
          position: { create: mockPositionCreate },
          order: { create: mockOrderCreate, update: mockOrderUpdate },
          positionEvent: { create: mockPositionEventCreate },
          tradeDecision: { create: mockTradeDecisionCreate },
          runEvent: { create: mockRunEventCreate },
        });
      }
      return arg;
    });

    // Alpaca submit: throw a network-y error (no statusCode) → classified
    // as "uncertain" → returns success:true / PENDING.
    mockPlaceMarketOrder.mockRejectedValueOnce(new Error("network timeout"));

    const result = await makeTool(makeCtx()).execute({
      ticker: "NVDA",
      direction: "LONG",
      entry_price: 100,
      target_price: 120,
      stop_loss: 90,
      thesis_id: "thesis_stale_watching",
      notional: 5000,
    });

    expect(result.data.success).toBe(true);
    expect(result.data.status).toBe("PENDING");
    expect(result.data.fillStatus).toBe("PENDING");
    expect(String(result.summary)).not.toMatch(/research is/i);
    // Confirm we actually reached Alpaca's submission path.
    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
  });
});

describe("place_trade — analyst enabled gate (trading-paused)", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockPositionFindFirst.mockReset();
    mockPositionCreate.mockReset();
    mockOrderCreate.mockReset();
    mockTransaction.mockReset();
    mockPlaceMarketOrder.mockReset();
    mockGetOrder.mockReset();
    mockGetLatestPrice.mockReset();
    mockGetAccount.mockReset();
    mockAgentConfigFindUnique.mockReset();
  });

  it("refuses with a clear 'analyst paused' message when AgentConfig.enabled is false", async () => {
    mockAgentConfigFindUnique.mockResolvedValueOnce({
      enabled: false,
      name: "Earnings Drift Trader",
    });

    const result = await makeTool(makeCtx()).execute({
      ticker: "AMBA",
      direction: "LONG",
      entry_price: 90,
      target_price: 115,
      stop_loss: 80,
      thesis_id: "thesis_amba_watching",
      notional: 1000,
    });

    expect(result.data.success).toBe(false);
    expect(result.data.status).toBe("FAILED");
    expect(String(result.data.message)).toMatch(/Earnings Drift Trader/);
    expect(String(result.data.message)).toMatch(/disabled/);
    expect(String(result.data.message)).toMatch(/new trades are paused/i);
    expect(String(result.summary)).toMatch(/analyst paused/i);

    // Critical: gate fired BEFORE Alpaca was touched.
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
    expect(mockPositionCreate).not.toHaveBeenCalled();
  });

  it("succeeds normally when analyst is enabled (gate does not false-positive)", async () => {
    // Default beforeEach mock has enabled: true, but be explicit here for the
    // intent of this test.
    mockAgentConfigFindUnique.mockResolvedValueOnce({
      enabled: true,
      name: "Earnings Drift Trader",
    });
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "LONG" });
    mockPositionFindFirst.mockResolvedValueOnce(null);
    mockGetLatestPrice.mockResolvedValueOnce(95);
    mockGetAccount.mockResolvedValueOnce({
      cash: "10000",
      buying_power: "10000",
    });
    mockTransaction.mockImplementation(async (arg) => {
      if (typeof arg === "function") return arg({ position: { create: mockPositionCreate }, order: { create: mockOrderCreate } });
      return arg;
    });
    mockPlaceMarketOrder.mockRejectedValueOnce(new Error("network timeout"));

    const result = await makeTool(makeCtx()).execute({
      ticker: "AMBA",
      direction: "LONG",
      entry_price: 95,
      target_price: 115,
      stop_loss: 85,
      thesis_id: "thesis_amba_watching",
      notional: 1000,
    });

    // Should not be the enabled-gate refusal — it should advance past it.
    expect(String(result.summary)).not.toMatch(/analyst paused/i);
    expect(String(result.data.message ?? "")).not.toMatch(/new trades are paused/i);
  });

  it("does NOT call agentConfig lookup when no effectiveAnalystId is in scope (defensive)", async () => {
    // Principal-chat outside an analyst scope: ctx.analystId = null AND no
    // args.analyst_id. The gate should silently skip (nothing to look up).
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "LONG" });
    mockPositionFindFirst.mockResolvedValueOnce(null);

    await makeTool(makeCtx({ analystId: undefined })).execute({
      ticker: "NVDA",
      direction: "LONG",
      entry_price: 100,
      target_price: 120,
      stop_loss: 90,
      thesis_id: "thesis_unscoped",
      notional: 5000,
    });

    expect(mockAgentConfigFindUnique).not.toHaveBeenCalled();
  });
});
