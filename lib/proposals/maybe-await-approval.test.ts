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

// P1-39: the gate fetches a live quote to anchor the protective-exit escape.
// Default null → resolvedProposedPrice stays null → the escape fails OPEN.
const mockGetStockQuote = jest.fn().mockResolvedValue(null);
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getStockQuote: mockGetStockQuote,
}));

import {
  maybeAwaitApproval,
  ApprovalGateAccountUnresolvedError,
  UNAPPROVED_EXIT_COOLDOWN_DAYS,
  isSameOrBetterBreach,
  PROTECTIVE_REASK_WORSENING_PCT,
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
// GAPS P1-28 — unapproved-exit cooldown. The agent re-proposed the same
// discretionary CLOSE ~daily; prod showed the user mostly IGNORES the card
// (NVDA 10 expired / 0 rejected, IREN 7/0) rather than explicitly rejecting.
// The gate refuses to re-stage a discretionary close within the cooldown of a
// prior unapproved proposal — REJECTED-by-user OR EXPIRED — while ALWAYS
// letting risk-management exits (STOP/TARGET, price_monitor) through and
// ignoring systemic tombstones.
// ─────────────────────────────────────────────────────────────────────────────
describe("maybeAwaitApproval — unapproved-exit cooldown (P1-28)", () => {
  it("suppresses a discretionary CLOSE the user recently REJECTED", async () => {
    mockOrderFindFirst.mockResolvedValue(null); // no pending twin
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // within window
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", status: "REJECTED", expiresAt, rejectionMessage: "no thanks" },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(result?.state).toBe("suppressed_recent_rejection");
    if (result?.state !== "suppressed_recent_rejection") throw new Error("unreachable");
    expect(result.lastUnapprovedOrderId).toBe("order-rejected");
    expect(result.lastUnapprovedOutcome).toBe("REJECTED");
    expect(result.unapprovedExitCount).toBe(1);

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

  it("suppresses when the user IGNORED the prior proposal to EXPIRY (the dominant case)", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    const expiresAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // expired 2d ago
    // No explicit rejection — just an expired card. This is the NVDA/IREN shape
    // the rejection-only design missed entirely.
    mockOrderFindMany.mockResolvedValue([
      { id: "order-expired", status: "EXPIRED", expiresAt, rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(result?.state).toBe("suppressed_recent_rejection");
    if (result?.state !== "suppressed_recent_rejection") throw new Error("unreachable");
    expect(result.lastUnapprovedOutcome).toBe("EXPIRED");
    expect(result.unapprovedExitCount).toBe(1);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("re-surfaces a protective STOP when the breach materially WORSENED vs the last decline (P1-39)", async () => {
    // The principal declined a stop at $3.95 and held. Days later the position
    // has broken down to $3.50 — materially worse than what they held through.
    // That is new information, so the protective exit re-stages rather than
    // being suppressed. (LONG: worse = a materially LOWER price.)
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({
      symbol: "MNKD",
      closeReason: "STOP",
      closeSource: "agent",
      position: { direction: "LONG" },
    });
    mockGetStockQuote.mockResolvedValueOnce({ c: 3.5 }); // current — deep breach
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", status: "REJECTED", expiresAt, rejectionMessage: "keep holding", proposedPrice: 3.95 },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockOrderFindMany).toHaveBeenCalledTimes(1); // now runs the cooldown check
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSendProposalPendingEmail).toHaveBeenCalledWith("order-new");
  });

  it("SUPPRESSES a re-proposed protective STOP the principal held through when price hasn't materially worsened (P1-39, the MU/MNKD fix)", async () => {
    // The core fatigue fix: declined the stop at $3.95, price is now $3.93 —
    // the SAME breach they already held through, not a new event. The protective
    // exit is suppressed exactly like a discretionary re-pitch, instead of the
    // pre-P1-39 behavior where any STOP tag bypassed the cooldown and re-nagged.
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({
      symbol: "MNKD",
      closeReason: "STOP",
      closeSource: "agent",
      position: { direction: "LONG" },
    });
    mockGetStockQuote.mockResolvedValueOnce({ c: 3.93 }); // ~same breach
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", status: "REJECTED", expiresAt, rejectionMessage: "keep holding", proposedPrice: 3.95 },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(result?.state).toBe("suppressed_recent_rejection");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSendProposalPendingEmail).not.toHaveBeenCalled();
  });

  it("STILL suppresses a discretionary MANUAL close after a REJECTION (anti-nag preserved)", async () => {
    // Counter-case to the protective exemption above: same recent REJECTION,
    // but a MANUAL close (ctx.protectiveExitReason undefined — a daily-run
    // rebalance or a judgment EXIT trigger). The P1-28 cooldown MUST still
    // suppress it; only price-triggered protective exits are exempt.
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({ closeReason: "MANUAL", closeSource: "agent" });
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // rejection inside window
    mockOrderFindMany.mockResolvedValue([
      { id: "order-rejected", status: "REJECTED", expiresAt, rejectionMessage: "keep holding" },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(result?.state).toBe("suppressed_recent_rejection");
    expect(mockOrderFindMany).toHaveBeenCalledTimes(1); // did NOT short-circuit
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSendProposalPendingEmail).not.toHaveBeenCalled();
  });

  it("fails OPEN — a protective STOP re-fires when the breach can't be compared (missing price) (P1-39 safety)", async () => {
    // The safety default: if we can't PROVE it's the same breach (no stored
    // price on the prior proposal, or no live quote), a protective exit always
    // flows. We never swallow a possible real breakdown to kill a nag.
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({
      symbol: "MNKD",
      closeReason: "STOP",
      closeSource: "agent",
      position: { direction: "LONG" },
    });
    mockGetStockQuote.mockResolvedValueOnce(null); // quote unavailable
    mockOrderFindMany.mockResolvedValue([
      { id: "order-expired", status: "EXPIRED", expiresAt: new Date(), rejectionMessage: null, proposedPrice: null },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("lets a non-STOP price_monitor close through (only STOP runs the escape)", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({ closeReason: "MANUAL", closeSource: "price_monitor" });

    const result = await maybeAwaitApproval(baseArgs());

    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockOrderFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("SUPPRESSES a price_monitor STOP re-nag at the same level (the MU $860 case) (P1-39)", async () => {
    // The re-nag comes from BOTH agent and price-monitor STOP closes — MU's $860
    // floor was re-proposed by the price-monitor across many days. A STOP runs the
    // escape regardless of source, so a same-level price-monitor re-nag suppresses.
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue({
      symbol: "MU",
      closeReason: "STOP",
      closeSource: "price_monitor",
      position: { direction: "LONG" },
    });
    mockGetStockQuote.mockResolvedValueOnce({ c: 858 }); // ~same breach as $860
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockOrderFindMany.mockResolvedValue([
      { id: "order-expired", status: "EXPIRED", expiresAt, rejectionMessage: null, proposedPrice: 860 },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    expect(result?.state).toBe("suppressed_recent_rejection");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("ignores systemic tombstones — a dedup/suppression row does NOT arm the cooldown", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderFindMany.mockResolvedValue([
      { id: "t1", status: "REJECTED", expiresAt: new Date(), rejectionMessage: "Duplicate close — folded into pending proposal x" },
      { id: "t2", status: "REJECTED", expiresAt: new Date(), rejectionMessage: "Suppressed — recent unapproved CLOSE cooldown (P1-28)" },
    ]);

    const result = await maybeAwaitApproval(baseArgs());

    // No real decline in the window → stages normally.
    expect(awaiting(result).orderId).toBe("order-new");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not gate PARTIAL_CLOSE — only full CLOSE is on cooldown", async () => {
    mockOrderFindMany.mockResolvedValue([
      { id: "order-expired", status: "EXPIRED", expiresAt: new Date(), rejectionMessage: null },
    ]);

    const result = await maybeAwaitApproval({ ...baseArgs(), intent: "PARTIAL_CLOSE" });

    // Cooldown query never runs for a trim; it stages.
    expect(mockOrderFindMany).not.toHaveBeenCalled();
    expect(awaiting(result).orderId).toBe("order-new");
    expect(UNAPPROVED_EXIT_COOLDOWN_DAYS).toBeGreaterThan(0);
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

describe("isSameOrBetterBreach — the P1-39 protective re-ask predicate", () => {
  const PCT = PROTECTIVE_REASK_WORSENING_PCT;

  it("LONG: same-ish price ⇒ same breach ⇒ suppress (true)", () => {
    expect(isSameOrBetterBreach(3.93, 3.95, "LONG")).toBe(true);
  });
  it("LONG: materially lower price ⇒ worse breach ⇒ re-ask (false)", () => {
    expect(isSameOrBetterBreach(3.5, 3.95, "LONG")).toBe(false);
  });
  it("LONG: price recovered above prior ⇒ definitely not worse ⇒ suppress (true)", () => {
    expect(isSameOrBetterBreach(4.1, 3.95, "LONG")).toBe(true);
  });
  it("SHORT: materially higher price ⇒ worse breach ⇒ re-ask (false)", () => {
    expect(isSameOrBetterBreach(110, 100, "SHORT")).toBe(false);
  });
  it("SHORT: same-ish price ⇒ suppress (true)", () => {
    expect(isSameOrBetterBreach(101, 100, "SHORT")).toBe(true);
  });
  it("fails safe (false ⇒ re-ask) when either price is missing or invalid", () => {
    expect(isSameOrBetterBreach(null, 3.95, "LONG")).toBe(false);
    expect(isSameOrBetterBreach(3.5, null, "LONG")).toBe(false);
    expect(isSameOrBetterBreach(undefined, undefined, "LONG")).toBe(false);
    expect(isSameOrBetterBreach(3.5, 0, "LONG")).toBe(false);
  });
  it("honors the threshold boundary (just inside = suppress, just past = re-ask)", () => {
    const prior = 100;
    const justInside = prior * (1 - PCT / 100) + 0.01; // not yet materially worse
    const justPast = prior * (1 - PCT / 100) - 0.01; // materially worse
    expect(isSameOrBetterBreach(justInside, prior, "LONG")).toBe(true);
    expect(isSameOrBetterBreach(justPast, prior, "LONG")).toBe(false);
  });
});
