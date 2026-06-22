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
const mockAgentConfigFindFirst = jest.fn();

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
    agentConfig: {
      findUnique: mockAgentConfigFindUnique,
      findFirst: mockAgentConfigFindFirst,
    },
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

const mockMaybeAwaitApproval = jest.fn();
jest.mock("@/lib/proposals/maybe-await-approval", () => ({
  maybeAwaitApproval: (args: unknown) => mockMaybeAwaitApproval(args),
  awaitingApprovalEnvelope: (args: { ticker: string }) => ({
    fillStatus: "AWAITING_APPROVAL" as const,
    awaitingApproval: { ticker: args.ticker },
  }),
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

/**
 * P1-24 B4 — Guardrail 0: place_trade must reject an UNRESEARCHED watchlist
 * seed. Per docs/plans/STATUS_TAXONOMY.md the seed sentinel migrated from
 * direction='PENDING' to direction=null. The gate is an ALLOWLIST on
 * LONG/SHORT, so it catches BOTH null (new) and 'PENDING' (legacy) — a
 * null-direction seed becoming trade-eligible is the catastrophic failure
 * this guards against. These tests pin that behavior; if the gate ever
 * reverts to checking only 'PENDING', the null case fails loudly here.
 *
 * Mock ordering note: the directionCheck is the FIRST prisma.thesis.findUnique
 * call inside execute() (after the enabled-gate + existing-position dedup),
 * so mockResolvedValueOnce on the thesis mock feeds exactly that lookup.
 */
describe("place_trade — Guardrail 0: unresearched-seed direction gate (P1-24 B4)", () => {
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
    mockAgentConfigFindUnique.mockResolvedValue({
      enabled: true,
      name: "Test Analyst",
    });
  });

  it("rejects a null-direction (unresearched) seed and never touches Alpaca", async () => {
    // The B4 sentinel: an unresearched user/builder/editor seed now stores
    // direction=null. The gate MUST reject it.
    mockThesisFindUnique.mockResolvedValueOnce({ direction: null });
    mockPositionFindFirst.mockResolvedValueOnce(null);

    const result = await makeTool(makeCtx()).execute({
      ticker: "NVDA",
      direction: "LONG",
      entry_price: 100,
      target_price: 120,
      stop_loss: 90,
      thesis_id: "thesis_null_seed",
      notional: 5000,
    });

    expect(result.data.success).toBe(false);
    expect(result.data.status).toBe("FAILED");
    expect(String(result.data.message)).toMatch(/not committed to LONG\/SHORT/i);
    expect(String(result.summary)).toMatch(/no committed direction/i);
    // CRITICAL: the unresearched seed must NEVER reach order submission.
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
    expect(mockPositionCreate).not.toHaveBeenCalled();
  });

  it("still rejects a legacy 'PENDING' seed (dual-read window)", async () => {
    // Pre-backfill rows still carry the legacy 'PENDING' string. The same
    // allowlist gate must reject those too.
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "PENDING" });
    mockPositionFindFirst.mockResolvedValueOnce(null);

    const result = await makeTool(makeCtx()).execute({
      ticker: "AMD",
      direction: "LONG",
      entry_price: 100,
      target_price: 120,
      stop_loss: 90,
      thesis_id: "thesis_legacy_pending",
      notional: 5000,
    });

    expect(result.data.success).toBe(false);
    expect(result.data.status).toBe("FAILED");
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
    expect(mockPositionCreate).not.toHaveBeenCalled();
  });

  it("does NOT block a committed LONG thesis at Guardrail 0 (positive control)", async () => {
    // A committed LONG must advance PAST Guardrail 0. We feed an invalid
    // target/stop so it fails at the LATER shape guard — proving the
    // direction gate let it through rather than rejecting on direction.
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "LONG" });
    mockPositionFindFirst.mockResolvedValueOnce(null);

    const result = await makeTool(makeCtx()).execute({
      ticker: "NVDA",
      direction: "LONG",
      entry_price: 100,
      target_price: 90, // invalid for LONG — trips the later shape guard
      stop_loss: 80,
      thesis_id: "thesis_committed_long",
      notional: 5000,
    });

    expect(result.data.success).toBe(false);
    // The rejection is the shape guard, NOT the direction-commitment gate.
    expect(String(result.summary)).not.toMatch(/no committed direction/i);
    expect(String(result.data.message ?? "")).not.toMatch(
      /not committed to LONG\/SHORT/i,
    );
    expect(String(result.summary)).toMatch(/invalid target\/stop/i);
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

/**
 * Order.rationale source on OPEN proposals — surfaced 2026-06-04 by the
 * NVTS 6/03 review. Pre-fix: place_trade's OPEN-side proposal path always
 * pulled `Order.rationale` from `thesis.snapshot` text — which is the
 * writer's WATCHING-side "this is a watch, not a buy" overview, not the
 * tactical agent's actual entry-decision rationale. So the principal,
 * approving a tactical-triggered entry, would read "the current setup is
 * not actionable" while clicking Approve on a real-money buy.
 *
 * Post-fix: place_trade accepts `entry_rationale` as an optional arg.
 * When the tactical agent passes it, that text is used. When it isn't
 * (principal-chat one-shot entries where the snapshot IS the entry
 * rationale), it falls back to the snapshot path. CLOSE proposals are
 * unchanged.
 *
 * These tests pin the OPEN-side rationale source so the bug can't quietly
 * regress.
 */
describe("place_trade — Order.rationale source on OPEN proposals", () => {
  function setupProposalPath(opts: { snapshot?: string; livePrice?: number } = {}): void {
    mockThesisFindUnique.mockReset();
    mockPositionFindFirst.mockReset();
    mockPositionCreate.mockReset();
    mockOrderCreate.mockReset();
    mockTransaction.mockReset();
    mockPlaceMarketOrder.mockReset();
    mockGetLatestPrice.mockReset();
    mockGetAccount.mockReset();
    mockAgentConfigFindUnique.mockReset();
    mockMaybeAwaitApproval.mockReset();

    mockAgentConfigFindUnique.mockResolvedValue({
      enabled: true,
      name: "Test Analyst",
    });
    // First findUnique call — directionCheck against thesis.direction.
    mockThesisFindUnique.mockResolvedValueOnce({ direction: "LONG" });
    // Second findUnique call — the snapshot fetch in the proposal block.
    // This is the only call that should hit IF entry_rationale is absent.
    // The V2 flat-schema `snapshot` column stores `{ text, citations }`,
    // not a raw string; getThesisSnapshotText pulls `.text` out.
    mockThesisFindUnique.mockResolvedValueOnce({
      snapshot: {
        text: opts.snapshot ?? "the current setup is not actionable; keep watching",
        citations: [],
      },
    });
    mockPositionFindFirst.mockResolvedValueOnce(null);
    // Live-price guardrail wants price between stop and target for a LONG.
    // Default 30.59 matches the NVTS test args; other tests pass a custom value.
    mockGetLatestPrice.mockResolvedValueOnce(opts.livePrice ?? 30.59);
    mockGetAccount.mockResolvedValueOnce({ cash: "10000", buying_power: "10000" });

    mockPositionCreate.mockResolvedValue({
      id: "pos_proposal_1",
      symbol: "NVTS",
      direction: "LONG",
      quantity: 130,
    });
    mockOrderCreate.mockResolvedValue({ id: "order_proposal_1" });
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

    // The chokepoint — returns a non-null envelope so the tool returns
    // from the proposal path. Whatever args we pass here are what we
    // assert against.
    mockMaybeAwaitApproval.mockResolvedValue({
      state: "awaiting_approval",
      orderId: "order_proposal_1",
      positionId: "pos_proposal_1",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }

  it("uses entry_rationale verbatim when the tactical agent passes one (NVTS 2026-06-03 shape)", async () => {
    setupProposalPath({
      snapshot: "NVTS remains a watch-only momentum candidate; the current setup is not actionable",
    });

    const tacticalEntryReason =
      "Trigger validated: $NVTS was trading ~$30.59, above the $29.50 continuation level, with the bullish SMA structure intact and no contradicting headline.";

    const result = await makeTool(makeCtx()).execute({
      ticker: "NVTS",
      direction: "LONG",
      entry_price: 30.59,
      target_price: 40,
      stop_loss: 29.06,
      thesis_id: "thesis_nvts_watching",
      notional: 4000,
      entry_rationale: tacticalEntryReason,
    });

    expect(result.data.status).toBe("PROPOSED");
    expect(mockMaybeAwaitApproval).toHaveBeenCalledTimes(1);
    const callArgs = mockMaybeAwaitApproval.mock.calls[0][0];
    expect(callArgs.rationale).toBe(tacticalEntryReason);
    // Critical anti-regression: the stale snapshot text must NOT have leaked
    // through.
    expect(callArgs.rationale).not.toMatch(/not actionable/i);
    expect(callArgs.rationale).not.toMatch(/watch-only/i);
  });

  it("trims whitespace on entry_rationale (defensive)", async () => {
    setupProposalPath();

    await makeTool(makeCtx()).execute({
      ticker: "NVTS",
      direction: "LONG",
      entry_price: 30.59,
      target_price: 40,
      stop_loss: 29.06,
      thesis_id: "thesis_nvts_watching",
      notional: 4000,
      entry_rationale: "   Trigger validated: $NVTS broke above $29.50.   ",
    });

    expect(mockMaybeAwaitApproval).toHaveBeenCalledTimes(1);
    const callArgs = mockMaybeAwaitApproval.mock.calls[0][0];
    expect(callArgs.rationale).toBe("Trigger validated: $NVTS broke above $29.50.");
  });

  it("falls back to thesis.snapshot when entry_rationale is absent (principal-chat one-shot path)", async () => {
    const fallbackSnapshot =
      "$NTNX is a watching candidate with a clean catalyst setup ahead of the print.";
    setupProposalPath({ snapshot: fallbackSnapshot, livePrice: 80 });

    await makeTool(makeCtx()).execute({
      ticker: "NTNX",
      direction: "LONG",
      entry_price: 80,
      target_price: 95,
      stop_loss: 74,
      thesis_id: "thesis_ntnx_watching",
      notional: 4000,
      // entry_rationale intentionally omitted
    });

    expect(mockMaybeAwaitApproval).toHaveBeenCalledTimes(1);
    const callArgs = mockMaybeAwaitApproval.mock.calls[0][0];
    expect(callArgs.rationale).toBe(fallbackSnapshot);
  });

  it("falls back to snapshot when entry_rationale is an empty string", async () => {
    const fallbackSnapshot = "watching candidate, snapshot text";
    setupProposalPath({ snapshot: fallbackSnapshot, livePrice: 200 });

    await makeTool(makeCtx()).execute({
      ticker: "TXN",
      direction: "LONG",
      entry_price: 200,
      target_price: 240,
      stop_loss: 184,
      thesis_id: "thesis_txn_watching",
      notional: 4000,
      entry_rationale: "",
    });

    expect(mockMaybeAwaitApproval).toHaveBeenCalledTimes(1);
    const callArgs = mockMaybeAwaitApproval.mock.calls[0][0];
    expect(callArgs.rationale).toBe(fallbackSnapshot);
  });

  it("falls back to snapshot when entry_rationale is whitespace-only", async () => {
    const fallbackSnapshot = "snapshot text";
    setupProposalPath({ snapshot: fallbackSnapshot, livePrice: 200 });

    await makeTool(makeCtx()).execute({
      ticker: "TXN",
      direction: "LONG",
      entry_price: 200,
      target_price: 240,
      stop_loss: 184,
      thesis_id: "thesis_txn_watching",
      notional: 4000,
      entry_rationale: "   \n   ",
    });

    expect(mockMaybeAwaitApproval).toHaveBeenCalledTimes(1);
    const callArgs = mockMaybeAwaitApproval.mock.calls[0][0];
    expect(callArgs.rationale).toBe(fallbackSnapshot);
  });
});

/**
 * P1-18 — analyst_id ownership guard must not block a ctx-bound run.
 *
 * place_trade takes an OPTIONAL analyst_id arg used only as the principal-chat
 * fallback (the schema says "Within an analyst run, leave undefined"). On
 * 2026-06-05, GPT-5.5 ignored that and passed analyst_id="catalyst-event-pm"
 * (the human slug, not the cuid) on a tactical run already scoped to Catalyst
 * via ctx.analystId. effectiveAnalystId = ctx.analystId ?? args.analyst_id
 * already ignores the arg, so the trade was correctly bound — but the old
 * unconditional check (`args.analyst_id && args.analyst_id !== ctx.analystId`)
 * threw "Analyst catalyst-event-pm not found or not yours" and silently dropped
 * a validated live ARQT entry. The guard must only run when ctx.analystId is
 * unset (the sole case where args.analyst_id is actually used for the trade).
 */
describe("place_trade — analyst_id ownership guard (P1-18)", () => {
  function primeProposalPath(): void {
    mockThesisFindUnique.mockReset();
    mockPositionFindFirst.mockReset();
    mockPositionCreate.mockReset();
    mockOrderCreate.mockReset();
    mockTransaction.mockReset();
    mockPlaceMarketOrder.mockReset();
    mockGetLatestPrice.mockReset();
    mockGetAccount.mockReset();
    mockAgentConfigFindUnique.mockReset();
    mockAgentConfigFindFirst.mockReset();
    mockMaybeAwaitApproval.mockReset();

    mockAgentConfigFindUnique.mockResolvedValue({
      enabled: true,
      name: "Catalyst Event PM",
    });
    mockThesisFindUnique
      .mockResolvedValueOnce({ direction: "LONG" }) // directionCheck
      .mockResolvedValueOnce({
        snapshot: { text: "watch snapshot", citations: [] },
      }); // proposal-block snapshot fetch (unused when entry_rationale present)
    mockPositionFindFirst.mockResolvedValueOnce(null);
    mockGetLatestPrice.mockResolvedValueOnce(21.96);
    mockGetAccount.mockResolvedValueOnce({ cash: "10000", buying_power: "10000" });
    mockPositionCreate.mockResolvedValue({
      id: "pos_arqt",
      symbol: "ARQT",
      direction: "LONG",
      quantity: 100,
    });
    mockOrderCreate.mockResolvedValue({ id: "order_arqt" });
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
    mockMaybeAwaitApproval.mockResolvedValue({
      state: "awaiting_approval",
      orderId: "order_arqt",
      positionId: "pos_arqt",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }

  it("ignores a stray slug-shaped analyst_id on a ctx-bound run (ARQT 2026-06-05 shape)", async () => {
    primeProposalPath();

    const result = await makeTool(
      makeCtx({ analystId: "analyst_catalyst" }),
    ).execute({
      ticker: "ARQT",
      direction: "LONG",
      entry_price: 21.95,
      target_price: 29,
      stop_loss: 18.5,
      thesis_id: "thesis_arqt_watching",
      notional: 4000,
      entry_rationale:
        "Trigger validated above $21.95 ahead of the June 29 PDUFA.",
      analyst_id: "catalyst-event-pm", // the slug the model hallucinated
    });

    // The trade must ADVANCE to the proposal path, not be blocked.
    expect(result.ok).not.toBe(false);
    expect(result.data.status).toBe("PROPOSED");
    expect(String(result.error ?? "")).not.toMatch(/not found or not yours/i);
    // The ownership lookup must be skipped entirely when ctx.analystId is set.
    expect(mockAgentConfigFindFirst).not.toHaveBeenCalled();
    // And the position was bound to ctx.analystId, never the slug.
    expect(mockPositionCreate).toHaveBeenCalledTimes(1);
    expect(mockPositionCreate.mock.calls[0][0].data.analystId).toBe(
      "analyst_catalyst",
    );
  });

  it("still validates analyst_id ownership in principal chat (ctx.analystId unset)", async () => {
    primeProposalPath();
    // The bogus id resolves to no analyst owned by the user.
    mockAgentConfigFindFirst.mockResolvedValueOnce(null);

    const result = await makeTool(makeCtx({ analystId: undefined })).execute({
      ticker: "ARQT",
      direction: "LONG",
      entry_price: 21.95,
      target_price: 29,
      stop_loss: 18.5,
      thesis_id: "thesis_arqt_watching",
      notional: 4000,
      analyst_id: "not-a-real-analyst",
    });

    // The ownership check fired and place_trade's inner catch converted the
    // throw into a graceful FAILED envelope (the same soft-fail the ARQT run
    // surfaced in production — run COMPLETE, agent narrates "not recognized").
    expect(result.data.success).toBe(false);
    expect(result.data.status).toBe("FAILED");
    expect(String(result.data.message)).toMatch(/not found or not yours/i);
    expect(mockAgentConfigFindFirst).toHaveBeenCalledTimes(1);
    // Never reached proposal submission.
    expect(mockMaybeAwaitApproval).not.toHaveBeenCalled();
  });
});
