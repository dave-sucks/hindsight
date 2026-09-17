/**
 * maybe-await-approval.test.ts — the approval gate for tools that create their
 * order first (place_trade, manage_position). The one-close-per-position fold
 * that used to live here moved into closeOpenPosition, under a row lock — see
 * one-close-per-position.test.ts.
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

describe("maybeAwaitApproval — staging", () => {
  it("stages the just-created order when approval is on", async () => {
    const result = await maybeAwaitApproval(baseArgs());

    // Stages the just-created order as the proposal.
    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The just-created order is flipped to AWAITING_APPROVAL.
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-new" },
        data: expect.objectContaining({ status: "AWAITING_APPROVAL" }),
      }),
    );
    expect(mockSendProposalPendingEmail).toHaveBeenCalledWith("order-new");
  });

  it("stages a PARTIAL_CLOSE — scale-outs can legitimately stack", async () => {
    const result = await maybeAwaitApproval({
      ...baseArgs(),
      intent: "PARTIAL_CLOSE",
    });

    // No "is a sale already under way" read here — trims stack.
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
    // Never reaches the stage transaction.
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAPS P1-28 — unapproved-exit cooldown. The agent re-proposed the same
// discretionary CLOSE ~daily; prod showed the user mostly IGNORES the card
// (NVDA 10 expired / 0 rejected, IREN 7/0) rather than explicitly rejecting.
// The gate refuses to re-stage a discretionary close within the cooldown of a
// prior unapproved proposal — REJECTED-by-user OR EXPIRED — while ALWAYS
// letting risk-management exits (STOP/TARGET, price_monitor) through and
// ignoring systemic tombstones.
// ─────────────────────────────────────────────────────────────────────────────
describe("maybeAwaitApproval — NO cross-day exit suppression (P1-39 emergency)", () => {
  // The P1-28 cross-day cooldown was REMOVED 2026-08-10: it went silent on
  // positions the agent wanted out of (MU + CYTK, both LIVE), which the principal
  // ruled unacceptable — an unwanted repeat is fine, silence never is. Every
  // exit the agent decides on now surfaces; repeat-fatigue is cured later by the
  // morning run re-drawing the floor, not by suppression. The #379 same-tick
  // dedup (separate describe above) is untouched.

  it("re-stages a discretionary CLOSE even after a recent REJECTION (never goes silent)", async () => {
    mockOrderFindFirst.mockResolvedValue(null); // no pending twin
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", status: "REJECTED", expiresAt, rejectionMessage: "no thanks" },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSendProposalPendingEmail).toHaveBeenCalledWith("order-new");
  });

  it("re-stages after an ignored EXPIRY (the MU/CYTK silence case) — reminds again", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    const expiresAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // expired 2d ago
    mockOrderFindMany.mockResolvedValue([
      { id: "order-expired", status: "EXPIRED", expiresAt, rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("re-stages a MANUAL judgment close after a recent decline (the bug that silenced MU/CYTK)", async () => {
    // Previously a cooldown swallowed this exit and went dark. Now the
    // agent's judgment exit always reaches the principal.
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({ closeReason: "MANUAL", closeSource: "agent" });
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", status: "REJECTED", expiresAt, rejectionMessage: "keep holding" },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSendProposalPendingEmail).toHaveBeenCalledWith("order-new");
  });

  it("still stages a PARTIAL_CLOSE normally", async () => {
    mockOrderFindMany.mockResolvedValue([
      { id: "order-expired", status: "EXPIRED", expiresAt: new Date(), rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval({ ...baseArgs(), intent: "PARTIAL_CLOSE" });

    expect(awaiting(result).orderId).toBe("order-new");
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
