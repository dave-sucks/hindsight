/**
 * maybeAwaitApproval — the single chokepoint for Trade-as-Proposal.
 *
 * Inserted by each trade tool at the natural seam between "DB rows
 * created" and "submit to Alpaca." When the Account toggle for this
 * side (buys vs sells) is off, returns null and the tool continues
 * its normal flow (Alpaca submit → poll → finalize). When the toggle
 * is on, flips the just-created rows to PENDING_APPROVAL / AWAITING_
 * APPROVAL, sends the proposal-pending email, and returns an
 * awaiting-approval envelope the tool returns verbatim.
 *
 * The agent code path is identical in both modes — the only thing that
 * varies is whether the tool short-circuits before reaching Alpaca.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { prisma } from "@/lib/prisma";
import { sendProposalPendingEmail } from "@/lib/emails/proposal-pending";
import { sendProposalPendingPush } from "@/lib/notify/proposal-push";

export type ProposalIntent = "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";

export interface MaybeAwaitApprovalArgs {
  accountId: string;
  positionId: string;
  orderId: string;
  intent: ProposalIntent;
  /**
   * Which Alpaca account this trade lands in. The gate reads the toggle
   * column matching this environment — PAPER and LIVE are independent so
   * paper can auto-execute while live requires review.
   */
  environment: "PAPER" | "LIVE";
  /**
   * Agent's reasoning at proposal time — shown in the approval UI + email.
   * For buys this is typically the thesis snapshot; for closes/adds/trims
   * it's the manage_position / close_position `reason` arg.
   */
  rationale: string | null;
}

export interface AwaitingApprovalResult {
  state: "awaiting_approval";
  orderId: string;
  positionId: string;
  expiresAt: Date;
  rationale: string | null;
}

/**
 * Returned when a discretionary CLOSE proposal is suppressed because the user
 * recently saw this same exit proposal and did NOT approve it — whether they
 * explicitly rejected it OR ignored it to expiry (P1-28). This gate targets
 * re-proposal ACROSS DAYS (e.g. MU was re-proposed on 5 distinct days
 * 06-09→06-16, each prior card rejected or left to expire). Same-DAY duplicate
 * bursts are a different problem already handled by the dedup block below.
 * Because the user mostly ignores cards to expiry rather than clicking Reject,
 * the cooldown arms off both outcomes. The just-created Order is tombstoned;
 * the tool surfaces this as a clean,
 * non-fatal "did not re-propose" result (NOT an error — a thrown error would
 * fail the run's narration gate). The agent also reads `unapprovedExitCount`
 * on the thesis via get_theses; this gate is the Layer-1 backstop.
 */
export interface SuppressedRecentRejectionResult {
  state: "suppressed_recent_rejection";
  positionId: string;
  /** The most recent unapproved proposal (rejected or expired) that armed it. */
  lastUnapprovedOrderId: string;
  /** How that proposal resolved. */
  lastUnapprovedOutcome: "REJECTED" | "EXPIRED";
  lastUnapprovedAt: Date;
  /** Discretionary re-proposal is gated until this instant. */
  cooldownUntil: Date;
  /** Count of recent staged closes you saw and didn't approve (rejected + ignored). */
  unapprovedExitCount: number;
}

/**
 * Days a recent UNAPPROVED close proposal (rejected OR ignored-to-expiry)
 * suppresses a discretionary re-proposal of the same exit (P1-28).
 */
export const UNAPPROVED_EXIT_COOLDOWN_DAYS = 5;

/**
 * Rejection messages written by the system (dedup fold, P1-28 suppression),
 * NOT by a user. Excluded from "did the user decline this exit" reads so a
 * systemic tombstone never counts as a decline or arms the cooldown.
 */
const SYSTEMIC_REJECTION_PREFIXES = ["Duplicate close", "Suppressed —"] as const;

/**
 * True when this REJECTED order is a systemic tombstone (dedup / cooldown),
 * not a user rejection. Used by both the L1 cooldown gate here and the L2
 * unapprovedExitCount surfacing in get_theses — keep the two in sync.
 */
export function isSystemicRejection(rejectionMessage: string | null): boolean {
  if (!rejectionMessage) return false;
  return SYSTEMIC_REJECTION_PREFIXES.some((p) => rejectionMessage.startsWith(p));
}

/**
 * Thrown when the approval gate cannot resolve the Account row for a LIVE
 * trade. A money/compliance gate MUST fail CLOSED: an unresolved account
 * means we cannot read the require-approval toggles, so we cannot prove the
 * trade is pre-cleared — the only safe outcome is to refuse the trade before
 * it reaches Alpaca.
 *
 * Every caller `await`s maybeAwaitApproval strictly BEFORE its Alpaca submit,
 * so an unhandled throw here is provably unreachable-to-Alpaca:
 *   - agent tools (place_trade, manage_position, close_position) run inside
 *     defineTool's try/catch → surfaces as a refused `{ ok: false }` trade.
 *   - the price-monitor trailing-stop cron (`trade-exit.ts` → closeOpenPosition)
 *     lets it bubble to the Inngest step → the position simply isn't closed.
 *
 * PAPER is not compliance-bound, so an unresolved PAPER account keeps the
 * legacy fail-open (returns null → auto-execute). See the split at the
 * `if (!account)` branch below.
 */
export class ApprovalGateAccountUnresolvedError extends Error {
  readonly accountId: string;
  readonly intent: ProposalIntent;
  constructor(accountId: string, intent: ProposalIntent) {
    super(
      `Approval gate failed CLOSED: could not resolve Account ${accountId} ` +
        `for a LIVE ${intent} trade. Refusing the trade — a LIVE order can ` +
        `never auto-execute on an unresolved account (GAPS P1-19, compliance ` +
        `incident #390 2026-06-05).`,
    );
    this.name = "ApprovalGateAccountUnresolvedError";
    this.accountId = accountId;
    this.intent = intent;
  }
}

/**
 * Decides whether the tool should stop here and wait for human approval.
 *
 * Reads the toggle column matching (intent direction × environment):
 *   OPEN / ADD            → requireApprovalBuys{Live,Paper}
 *   CLOSE / PARTIAL_CLOSE → requireApprovalSells{Live,Paper}
 *
 * So PAPER can auto-execute (toggle off) while LIVE requires review
 * (toggle on) — the split the disclosure requirement needs.
 *
 * Returns null when no approval is needed → tool continues to Alpaca submit
 * as it always has.
 * Returns an AwaitingApprovalResult when approval is needed → tool returns
 * the envelope verbatim and never reaches the Alpaca call.
 * THROWS ApprovalGateAccountUnresolvedError when the Account row can't be
 * resolved AND environment==='LIVE' → fail CLOSED, the trade is refused
 * before Alpaca (GAPS P1-19). PAPER keeps the legacy fail-open (returns null).
 */
export async function maybeAwaitApproval(
  args: MaybeAwaitApprovalArgs,
): Promise<
  AwaitingApprovalResult | SuppressedRecentRejectionResult | null
> {
  const account = await prisma.account.findUnique({
    where: { id: args.accountId },
    select: {
      requireApprovalBuysLive: true,
      requireApprovalSellsLive: true,
      requireApprovalBuysPaper: true,
      requireApprovalSellsPaper: true,
    },
  });

  // ── Unresolved-account fork: fail CLOSED on LIVE, fail open on PAPER ──────
  // A syntactically-valid accountId can still fail to resolve to a row:
  // deleted account (cascade race), cross-env mismatch, or a stale ctx value.
  // When that happens we CANNOT read the require-approval toggles, so we
  // cannot prove the trade is pre-cleared.
  //
  // LIVE is money/compliance-bound: the only safe outcome is to refuse the
  // trade BEFORE it reaches Alpaca. Returning null here (the old behavior)
  // meant "no approval required → submit the order" — i.e. a LIVE trade would
  // auto-execute with NO approval on a phantom account. That is the
  // fail-OPEN bug GAPS P1-19 / incident #390 (2026-06-05) closes. We throw a
  // typed error every caller surfaces as a refused trade.
  //
  // PAPER is not compliance-bound, so we keep the legacy fail-open (return
  // null → the tool auto-executes the paper order as it always has).
  if (!account) {
    if (args.environment === "LIVE") {
      throw new ApprovalGateAccountUnresolvedError(args.accountId, args.intent);
    }
    return null;
  }

  const isRiskIncreasing = args.intent === "OPEN" || args.intent === "ADD";
  const isLive = args.environment === "LIVE";
  const need = isRiskIncreasing
    ? isLive
      ? account.requireApprovalBuysLive
      : account.requireApprovalBuysPaper
    : isLive
      ? account.requireApprovalSellsLive
      : account.requireApprovalSellsPaper;
  if (!need) return null;

  // ── Dedup: at most one pending full-CLOSE proposal per position ──────────
  // Two triggers firing on the same thesis in one evaluator tick spawn two
  // tactical runs that each independently decide to close, each creating an
  // AWAITING_APPROVAL order on the same position (MRVL 2026-06-02 — the user
  // had to reject the same close twice, 1.3s apart). A full close is terminal
  // and idempotent: a second pending close is ALWAYS redundant, so fold this
  // call into the existing proposal instead of staging a twin.
  //
  // Scope is deliberately CLOSE-only. PARTIAL_CLOSE (scale-out) and ADD/OPEN
  // have legitimate stacking cases — gating them here would be the kind of
  // over-aggressive refusal GAPS P1-2 is trying to remove.
  //
  // Returns the EXISTING proposal's envelope (success-shaped, NOT an error)
  // so the second tactical run renders the same card and completes its
  // close-out contract cleanly — a thrown error would fail the run's
  // narration gate and mark it FAILED.
  //
  // Race note: the realistic tactical-run spawn gap is ~1s, so a findFirst
  // before the flip is adequate. A partial unique index on (positionId)
  // WHERE intent='CLOSE' AND status='AWAITING_APPROVAL' would make it airtight
  // against truly-simultaneous fires — tracked as a follow-up.
  if (args.intent === "CLOSE") {
    const existingClose = await prisma.order.findFirst({
      where: {
        positionId: args.positionId,
        intent: "CLOSE",
        status: "AWAITING_APPROVAL",
        id: { not: args.orderId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiresAt: true, rationale: true },
    });
    if (existingClose?.expiresAt) {
      // Tombstone this call's just-created order so it doesn't linger as a
      // second PENDING/AWAITING row. Reuse REJECTED (a known status) with a
      // systemic message that distinguishes it from a user rejection.
      await prisma.order.update({
        where: { id: args.orderId },
        data: {
          status: "REJECTED",
          rejectionMessage: `Duplicate close — folded into pending proposal ${existingClose.id}`,
        },
      });
      return {
        state: "awaiting_approval" as const,
        orderId: existingClose.id,
        positionId: args.positionId,
        expiresAt: existingClose.expiresAt,
        rationale: existingClose.rationale,
      };
    }
  }

  // ── Cross-day exit suppression REMOVED (P1-39 emergency, 2026-08-10) ────────
  // The P1-28 cooldown used to refuse re-staging a discretionary CLOSE within 5
  // days of a prior one the principal rejected or ignored-to-expiry. In practice
  // it went SILENT on positions the agent wanted out of: MU + CYTK (both LIVE)
  // sat with an agent-wanted exit swallowed for days, unmanaged, with no alert.
  // The principal's rule is absolute: the system must NEVER go silent on an exit —
  // an unwanted repeat is acceptable (remind me daily), silence is not.
  //
  // So the cross-day cooldown is gone: every exit the agent decides on now
  // surfaces. The remaining, still-correct suppression layers stay in place:
  //   • #379 dedup (above): folds a duplicate CLOSE while one is still
  //     AWAITING_APPROVAL — prevents same-tick twins, not cross-day reminders.
  //   • #381 tactical snooze (tactical-run.ts): skips re-SPAWNING a tactical run
  //     within 4h of a pending/rejected close — saves GPT cost, still ~1 alert/run.
  //
  // The proper cure for repeat-fatigue is NOT silence — it's the morning run
  // re-drawing the floor on a held-through breach (trail it to the recent low) so
  // alerts track a live line instead of a stale one. That is the follow-on build;
  // see docs/plans/PROPOSAL_FATIGUE.md. This change just stops the bleeding.

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Flip the just-created rows to the awaiting-approval state. For ADDs /
  // CLOSE / PARTIAL_CLOSE the Position is an existing OPEN holding — leave
  // its status alone; only OPEN-intent proposals flip Position to
  // PENDING_APPROVAL because the position isn't a real holding yet.
  await prisma.$transaction(async (tx) => {
    if (args.intent === "OPEN") {
      await tx.position.update({
        where: { id: args.positionId },
        data: { status: "PENDING_APPROVAL" },
      });
    }
    await tx.order.update({
      where: { id: args.orderId },
      data: {
        status: "AWAITING_APPROVAL",
        expiresAt,
        rationale: args.rationale,
      },
    });
  });

  // Fire-and-forget — the helper resolves OWNER email + skips on emailAlerts off.
  void sendProposalPendingEmail(args.orderId);
  // Same event, phone/desktop channel — no-ops unless NTFY_TOPIC is set. Email
  // is easy to miss; this is the high-signal nudge that a review is waiting.
  void sendProposalPendingPush(args.orderId);

  return {
    state: "awaiting_approval" as const,
    orderId: args.orderId,
    positionId: args.positionId,
    expiresAt,
    rationale: args.rationale,
  };
}

/**
 * Build a tool-result envelope from an AwaitingApprovalResult. Centralizes
 * the {state, items[], tickers[], ...} shape so all four tools return the
 * same payload when a proposal is created. The chat renderer reads
 * `items` for the [Approve][Reject] ticker row; downstream surfaces
 * (TradeRow, ActivityRow, ThesisSheet) read the orderId off the linked
 * Order(AWAITING_APPROVAL) directly.
 */
export function awaitingApprovalEnvelope(opts: {
  awaiting: AwaitingApprovalResult;
  ticker: string;
  direction: "LONG" | "SHORT";
  intent: ProposalIntent;
  shares: number;
  estimatedPrice: number;
  /** Optional notional override — used by ADD where notional is the user-facing number, not shares × price */
  estimatedCost?: number;
}) {
  const verb: "BUY" | "SELL" | "CLOSE" | "MODIFY" =
    opts.intent === "OPEN" || opts.intent === "ADD"
      ? "BUY"
      : opts.intent === "CLOSE"
        ? "CLOSE"
        : "MODIFY";
  const cost = opts.estimatedCost ?? opts.shares * opts.estimatedPrice;
  const human =
    opts.intent === "OPEN"
      ? "Place"
      : opts.intent === "ADD"
        ? "Add"
        : opts.intent === "CLOSE"
          ? "Close"
          : "Trim";
  return {
    state: "awaiting_approval" as const,
    orderId: opts.awaiting.orderId,
    positionId: opts.awaiting.positionId,
    expiresAt: opts.awaiting.expiresAt.toISOString(),
    rationale: opts.awaiting.rationale,
    message: `Proposed ${human} ${opts.shares} ${opts.ticker} at ~$${opts.estimatedPrice.toFixed(2)}. Awaiting your approval (expires in 24h).`,
    items: [
      {
        kind: "proposal" as const,
        orderId: opts.awaiting.orderId,
        ticker: opts.ticker,
        direction: opts.direction,
        action: verb,
        shares: opts.shares,
        estimatedPrice: opts.estimatedPrice,
        estimatedCost: cost,
        expiresAt: opts.awaiting.expiresAt.toISOString(),
        rationale: opts.awaiting.rationale,
      },
    ],
  };
}
