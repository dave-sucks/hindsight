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
const mockOrderFindUnique = jest.fn();
const mockOrderFindMany = jest.fn();
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
    order: {
      findFirst: mockOrderFindFirst,
      findUnique: mockOrderFindUnique,
      findMany: mockOrderFindMany,
      update: mockOrderUpdate,
    },
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
  REJECTED_EXIT_COOLDOWN_DAYS,
  type AwaitingApprovalResult,
} from "./maybe-await-approval";

/** Narrow the union to the awaiting_approval branch for assertions. */
function awaiting(
  r: Awaited<ReturnType<typeof maybeAwaitApproval>>,
): AwaitingApprovalResult {
  if (!r || r.state !== "awaiting_approval") {
    throw new Error(`expected awaiting_approval, got ${r?.state ?? "null"}`);
  }
  return r;
}

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
  // Default: a discretionary agent close with no prior rejections → the
  // P1-28 cooldown gate is a no-op and the call stages/folds as before.
  mockOrderFindUnique.mockResolvedValue({
    closeReason: "MANUAL",
    closeSource: "agent",
  });
  mockOrderFindMany.mockResolvedValue([]);
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
    expect(awaiting(result).orderId).toBe("order-existing");
    expect(awaiting(result).expiresAt).toBe(existingExpiry);
    expect(awaiting(result).rationale).toBe("first close");

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
    expect(awaiting(result).orderId).toBe("order-new");
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
    expect(awaiting(result).orderId).toBe("order-new");
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
// GAPS P1-28 — rejected-exit cooldown. The user kept re-rejecting the same
// discretionary CLOSE every run (prod 2026-06-18: MU 17×, NVDA 19×). The L1
// gate refuses to re-stage a discretionary close within the cooldown of a
// prior USER rejection — but ALWAYS lets risk-management exits (STOP/TARGET,
// price_monitor) through, and ignores systemic tombstones.
// ─────────────────────────────────────────────────────────────────────────────
describe("maybeAwaitApproval — rejected-exit cooldown (P1-28)", () => {
  it("suppresses a discretionary CLOSE when the user recently rejected this exit", async () => {
    mockOrderFindFirst.mockResolvedValue(null); // no pending twin
    const rejectedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1d ago
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", createdAt: rejectedAt, rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(result?.state).toBe("suppressed_recent_rejection");
    if (result?.state !== "suppressed_recent_rejection") throw new Error("unreachable");
    expect(result.rejectedOrderId).toBe("order-rejected");
    expect(result.rejectedExitCount).toBe(1);

    // The just-created order is tombstoned with a systemic message (so it
    // never counts as a future rejection), and we never stage/email.
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-new" },
        data: expect.objectContaining({
          status: "REJECTED",
          rejectionMessage: expect.stringContaining("Suppressed —"),
        }),
      }),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSendProposalPendingEmail).not.toHaveBeenCalled();
  });

  it("lets a STOP close through (risk exit bypasses the cooldown)", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({ closeReason: "STOP", closeSource: "agent" });
    // Even with a recent rejection on file, a STOP is material → not gated.
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", createdAt: new Date(), rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockOrderFindMany).not.toHaveBeenCalled(); // short-circuits on risk exit
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("lets a price_monitor close through (trailing-stop cron bypasses)", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({ closeReason: "MANUAL", closeSource: "price_monitor" });

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockOrderFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("ignores systemic tombstones — a dedup/suppression row does NOT arm the cooldown", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindMany.mockResolvedValue([
      { id: "t1", createdAt: new Date(), rejectionMessage: "Duplicate close — folded into pending proposal x" },
      { id: "t2", createdAt: new Date(), rejectionMessage: "Suppressed — recent CLOSE rejection cooldown (P1-28)" },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    // No USER rejection in the window → stages normally.
    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not gate PARTIAL_CLOSE — only full CLOSE is on cooldown", async () => {
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", createdAt: new Date(), rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval({ ...baseArgs(), intent: "PARTIAL_CLOSE" });

    // Cooldown query never runs for a trim; it stages.
    expect(mockOrderFindMany).not.toHaveBeenCalled();
    expect(awaiting(result).orderId).toBe("order-new");
    expect(REJECTED_EXIT_COOLDOWN_DAYS).toBeGreaterThan(0);
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
