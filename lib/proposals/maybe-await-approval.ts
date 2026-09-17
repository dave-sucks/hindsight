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
 * Rejection messages the system wrote on older rows (the retired duplicate-
 * close fold and exit cooldown), NOT by a user. Excluded from "did the user
 * decline this exit" reads so a systemic tombstone never counts as a decline.
 */
const SYSTEMIC_REJECTION_PREFIXES = ["Duplicate close", "Suppressed —"] as const;

/**
 * True when this REJECTED order is a systemic tombstone, not a user
 * rejection. Read by get_theses (unapprovedExitCount) and held-through-context.
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
 * Does this trade need the principal's approval? Reads the toggle column
 * matching (intent direction × environment):
 *   OPEN / ADD            → requireApprovalBuys{Live,Paper}
 *   CLOSE / PARTIAL_CLOSE → requireApprovalSells{Live,Paper}
 *
 * So PAPER can auto-execute (toggle off) while LIVE requires review
 * (toggle on) — the split the disclosure requirement needs.
 *
 * THROWS ApprovalGateAccountUnresolvedError when the Account row can't be
 * resolved AND environment==='LIVE' → fail CLOSED, the trade is refused
 * before Alpaca (GAPS P1-19). PAPER keeps the legacy fail-open (false).
 */
export async function approvalRequired(
  args: Pick<MaybeAwaitApprovalArgs, "accountId" | "intent" | "environment">,
): Promise<boolean> {
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
  // trade BEFORE it reaches Alpaca. Answering "no approval needed" here (the
  // old behavior) meant a LIVE trade would auto-execute with NO approval on a
  // phantom account. That is the fail-OPEN bug GAPS P1-19 / incident #390
  // (2026-06-05) closes. We throw a typed error every caller surfaces as a
  // refused trade.
  //
  // PAPER is not compliance-bound, so we keep the legacy fail-open (the tool
  // auto-executes the paper order as it always has).
  if (!account) {
    if (args.environment === "LIVE") {
      throw new ApprovalGateAccountUnresolvedError(args.accountId, args.intent);
    }
    return false;
  }

  const isRiskIncreasing = args.intent === "OPEN" || args.intent === "ADD";
  const isLive = args.environment === "LIVE";
  return isRiskIncreasing
    ? isLive
      ? account.requireApprovalBuysLive
      : account.requireApprovalBuysPaper
    : isLive
      ? account.requireApprovalSellsLive
      : account.requireApprovalSellsPaper;
}

/** How long a proposal waits for the principal before it expires. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tell the principal a proposal is waiting. Fire-and-forget — call it after
 * the transaction that staged the order commits (both helpers read the row).
 */
export function notifyProposalPending(orderId: string): void {
  // The helper resolves OWNER email + skips on emailAlerts off.
  void sendProposalPendingEmail(orderId);
  // Same event, phone/desktop channel — no-ops unless NTFY_TOPIC is set. Email
  // is easy to miss; this is the high-signal nudge that a review is waiting.
  void sendProposalPendingPush(orderId);
}

/**
 * Decides whether the tool should stop here and wait for human approval, for
 * the buys that create their order first (place_trade, manage_position's
 * add). Sales do not come through here: closeOpenPosition and the trim path
 * ask approvalRequired first and create the order already staged, in the same
 * locked transaction that sizes it (lockPositionSales).
 *
 * Returns null when no approval is needed → tool continues to Alpaca submit
 * as it always has.
 * Returns an AwaitingApprovalResult when approval is needed → tool returns
 * the envelope verbatim and never reaches the Alpaca call.
 * THROWS ApprovalGateAccountUnresolvedError (see approvalRequired).
 */
export async function maybeAwaitApproval(
  args: MaybeAwaitApprovalArgs,
): Promise<AwaitingApprovalResult | null> {
  if (!(await approvalRequired(args))) return null;

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
  //   • one full close at a time per position (closeOpenPosition, under the
  //     position lock) — prevents same-tick twins, not cross-day reminders.
  //   • #381 tactical snooze (tactical-run.ts): skips re-SPAWNING a tactical run
  //     within 4h of a pending/rejected close — saves GPT cost, still ~1 alert/run.
  //
  // The proper cure for repeat-fatigue is NOT silence — it's the morning run
  // re-drawing the floor on a held-through breach (trail it to the recent low) so
  // alerts track a live line instead of a stale one. That is the follow-on build;
  // see docs/plans/PROPOSAL_FATIGUE.md. This change just stops the bleeding.

  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  // Flip the just-created rows to the awaiting-approval state. For an ADD the
  // Position is an existing OPEN holding — leave its status alone; only
  // OPEN-intent proposals flip Position to PENDING_APPROVAL because the
  // position isn't a real holding yet.
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

  notifyProposalPending(args.orderId);

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
/**
 * Mark on the run that a trade tool fired and staged a proposal. complete_run's
 * narration check credits these (`CREDITED_RUN_EVENT_TYPES` in
 * lib/agent/narration-gate.ts). Without one, a LIVE sell — always a proposal —
 * read as "said exit, never called the tool," and agents deleted true exits
 * from their run summaries to get past the check (DAV-259). Never fails the
 * trade tool.
 */
export async function recordProposalRunEvent(opts: {
  runId: string | null | undefined;
  type: "position_close_proposed" | "position_modify_proposed";
  ticker: string;
  orderId: string;
  title: string;
}): Promise<void> {
  if (!opts.runId) return;
  try {
    await prisma.runEvent.create({
      data: {
        runId: opts.runId,
        type: opts.type,
        title: opts.title,
        payload: { ticker: opts.ticker, orderId: opts.orderId },
      },
    });
  } catch (err) {
    console.warn(
      `[proposals] ${opts.type} RunEvent write failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

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
