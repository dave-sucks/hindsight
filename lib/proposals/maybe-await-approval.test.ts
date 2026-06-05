/**
 * maybe-await-approval.test.ts — dedup guard for duplicate CLOSE proposals.
 *
 * 2026-06-02 MRVL: two REVIEW triggers ($215 + $270) fired on the same
 * evaluator tick while MRVL sat at ~$281 (above both). Each fire spawned a
 * tactical run that independently decided to close, and each close created
 * an AWAITING_APPROVAL order on the same position — the user had to reject
 * the same close twice (1.3s apart). These tests pin the fix: a second
 * pending full-CLOSE on a position folds into the first instead of staging
 * a twin, and the fold is success-shaped (returns the existing proposal),
 * not an error.
 */

const mockAccountFindUnique = jest.fn();
const mockOrderFindFirst = jest.fn();
const mockOrderUpdate = jest.fn().mockResolvedValue({});
const mockPositionUpdate = jest.fn().mockResolvedValue({});
const mockTransaction = jest.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    position: { update: mockPositionUpdate },
    order: { update: mockOrderUpdate },
  }),
);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUnique: mockAccountFindUnique },
    order: { findFirst: mockOrderFindFirst, update: mockOrderUpdate },
    position: { update: mockPositionUpdate },
    $transaction: mockTransaction,
  },
}));

const mockSendProposalPendingEmail = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/emails/proposal-pending", () => ({
  sendProposalPendingEmail: mockSendProposalPendingEmail,
}));

import {
  maybeAwaitApproval,
  ApprovalGateAccountUnresolvedError,
} from "./maybe-await-approval";

const ALL_TOGGLES_ON = {
  requireApprovalBuysLive: true,
  requireApprovalSellsLive: true,
  requireApprovalBuysPaper: true,
  requireApprovalSellsPaper: true,
};

function baseArgs() {
  return {
    accountId: "acct-1",
    positionId: "pos-1",
    orderId: "order-new",
    intent: "CLOSE" as const,
    environment: "LIVE" as const,
    rationale: "second close",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountFindUnique.mockResolvedValue(ALL_TOGGLES_ON);
});

describe("maybeAwaitApproval — duplicate CLOSE dedup", () => {
  it("folds a 2nd pending CLOSE on the same position into the existing proposal", async () => {
    const existingExpiry = new Date("2026-06-03T16:47:32.595Z");
    mockOrderFindFirst.mockResolvedValue({
      id: "order-existing",
      expiresAt: existingExpiry,
      rationale: "first close",
    });

    const result = await maybeAwaitApproval(baseArgs());

    // Returns the EXISTING proposal, not the just-created twin.
    expect(result).not.toBeNull();
    expect(result?.orderId).toBe("order-existing");
    expect(result?.expiresAt).toBe(existingExpiry);
    expect(result?.rationale).toBe("first close");

    // The just-created duplicate is tombstoned, not left dangling.
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-new" },
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );

    // It folds BEFORE the stage transaction + email — no twin proposal,
    // no second "proposal pending" email.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSendProposalPendingEmail).not.toHaveBeenCalled();
  });

  it("stages normally when there is no existing pending CLOSE", async () => {
    mockOrderFindFirst.mockResolvedValue(null);

    const result = await maybeAwaitApproval(baseArgs());

    // Stages the just-created order as the proposal.
    expect(result?.orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The just-created order is flipped to AWAITING_APPROVAL (not REJECTED).
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-new" },
        data: expect.objectContaining({ status: "AWAITING_APPROVAL" }),
      }),
    );
    expect(mockSendProposalPendingEmail).toHaveBeenCalledWith("order-new");
  });

  it("does NOT dedup PARTIAL_CLOSE — scale-outs can legitimately stack", async () => {
    const result = await maybeAwaitApproval({
      ...baseArgs(),
      intent: "PARTIAL_CLOSE",
    });

    // The CLOSE-only dedup query is never even run for a trim.
    expect(mockOrderFindFirst).not.toHaveBeenCalled();
    expect(result?.orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns null (no proposal) when the sells toggle is off", async () => {
    mockAccountFindUnique.mockResolvedValue({
      ...ALL_TOGGLES_ON,
      requireApprovalSellsLive: false,
    });

    const result = await maybeAwaitApproval(baseArgs());

    expect(result).toBeNull();
    // Never reaches the dedup query or the stage transaction.
    expect(mockOrderFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAPS P1-19 / compliance incident #390 (2026-06-05).
//
// A syntactically-valid accountId that fails to resolve to an Account row
// (deleted account, cross-env mismatch, race) used to return null from the
// gate. A null return means "no approval required → submit the order to
// Alpaca." For LIVE that auto-executed a real trade with NO approval. The gate
// must fail CLOSED for LIVE: refuse the trade before Alpaca. PAPER is not
// compliance-bound and keeps the legacy fail-open (returns null).
// ─────────────────────────────────────────────────────────────────────────────
describe("maybeAwaitApproval — unresolved account fails CLOSED on LIVE", () => {
  it("does NOT return null when LIVE + account unresolved — it throws (fail closed)", async () => {
    // Account row can't be resolved (deleted / cross-env / race).
    mockAccountFindUnique.mockResolvedValue(null);

    // A throw is the safe outcome: the just-created order never reaches the
    // Alpaca submit below the seam. Critically, it must NOT resolve to null —
    // null would tell the calling tool "no approval needed, submit it."
    await expect(
      maybeAwaitApproval({ ...baseArgs(), environment: "LIVE" }),
    ).rejects.toBeInstanceOf(ApprovalGateAccountUnresolvedError);

    // Provably unreachable-to-Alpaca: no proposal staged, no order mutated,
    // no email — the gate bailed before any of that.
    expect(mockOrderFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSendProposalPendingEmail).not.toHaveBeenCalled();
  });

  it("fails closed on a LIVE OPEN (buy) too, not just closes", async () => {
    mockAccountFindUnique.mockResolvedValue(null);

    await expect(
      maybeAwaitApproval({
        ...baseArgs(),
        intent: "OPEN",
        environment: "LIVE",
      }),
    ).rejects.toBeInstanceOf(ApprovalGateAccountUnresolvedError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("PAPER + account unresolved still returns null (paper is not compliance-bound)", async () => {
    mockAccountFindUnique.mockResolvedValue(null);

    const result = await maybeAwaitApproval({
      ...baseArgs(),
      environment: "PAPER",
    });

    // Legacy fail-open is preserved for paper: null → tool auto-executes.
    expect(result).toBeNull();
    expect(mockOrderFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSendProposalPendingEmail).not.toHaveBeenCalled();
  });
});
