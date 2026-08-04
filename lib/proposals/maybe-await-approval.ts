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
import { getStockQuote } from "@/lib/actions/finnhub.actions";

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
  /**
   * Market price at proposal time (the "Est. exit" in the approval UI). Stored
   * on the staged Order and used by the P1-39 protective-exit fatigue escape:
   * a re-proposed STOP/TARGET close is only re-surfaced when the breach
   * materially WORSENED vs this price at the last unapproved proposal. Omit /
   * null on paths that don't have a price → the gate fails OPEN (flows), never
   * suppressing a protective exit on uncertainty. See docs/plans/PROPOSAL_FATIGUE.md.
   */
  proposedPrice?: number | null;
}

/**
 * How much deeper (further into the losing direction) the breach must be, vs.
 * the price at the last unapproved protective proposal, to re-surface a close
 * the principal already held through. Below this, it's the same breach they
 * declined — stay quiet. Above it, the situation materially worsened — re-ask.
 */
export const PROTECTIVE_REASK_WORSENING_PCT = 3;

/**
 * Can we PROVE this re-proposed protective exit is NOT materially worse than the
 * one the principal already declined? Only then do we suppress it. Returns false
 * whenever we can't tell (either price missing) — the safe default is to flow a
 * protective exit, never to swallow a possible real breakdown.
 *
 * `direction` is the POSITION direction: a LONG stop worsens as price falls, a
 * SHORT stop worsens as price rises.
 */
export function isSameOrBetterBreach(
  current: number | null | undefined,
  prior: number | null | undefined,
  direction: "LONG" | "SHORT",
  worseningPct: number = PROTECTIVE_REASK_WORSENING_PCT,
): boolean {
  if (current == null || prior == null || prior <= 0) return false;
  const threshold = worseningPct / 100;
  // LONG: materially worse means current is >threshold BELOW prior.
  // SHORT: materially worse means current is >threshold ABOVE prior.
  const worsened =
    direction === "LONG"
      ? current < prior * (1 - threshold)
      : current > prior * (1 + threshold);
  return !worsened;
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

  // Market price at proposal time — anchors the P1-39 protective-exit escape and
  // is stored on the staged proposal. Prefer a caller-supplied price; the CLOSE
  // block below fetches a live quote as fallback. Any failure leaves it null, and
  // the escape fails OPEN (a protective exit is never suppressed on missing data).
  let resolvedProposedPrice: number | null = args.proposedPrice ?? null;

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

  // ── Unapproved-exit cooldown: don't re-propose a discretionary CLOSE the ──
  // user recently saw and did NOT approve (P1-28 — proposal fatigue). This is
  // the THIRD and last layer of re-proposal suppression; it covers the gap the
  // other two leave:
  //   • #379 dedup (below): folds a SAME-DAY duplicate CLOSE while one is still
  //     AWAITING_APPROVAL. Does nothing once the prior card resolves.
  //   • #381 tactical snooze: bails a tactical RUN in load-context if a close is
  //     pending or REJECTED within 4h. Tactical-only, 4h, rejection-only.
  //   • THIS gate: refuses to re-stage a discretionary close ACROSS DAYS — for
  //     daily AND tactical runs — within UNAPPROVED_EXIT_COOLDOWN_DAYS of a
  //     prior staged close that resolved REJECTED-by-user OR EXPIRED.
  // The motivating case is MU: re-proposed on 5 distinct days (06-09→06-16),
  // each prior card spaced >4h apart (past #381's snooze) and already expired
  // (nothing for #379 to fold). The big 06-04 bursts (NVDA 12×/IREN 8×/NVTS 5×)
  // were the P0-14 runaway, already fixed by #379+#381 — NOT this gate's target.
  // Arming off EXPIRED as well as REJECTED matters because the user mostly
  // IGNORES cards to expiry rather than clicking Reject.
  //
  // CLOSE-only, mirroring the dedup block above: a full close is the terminal,
  // idempotent decision being re-pitched. PARTIAL_CLOSE scale-outs legitimately
  // stack, so they're intentionally NOT gated here (verified: no staged
  // PARTIAL_CLOSE/ADD proposals exist in prod — closes are the only vector).
  //
  // Carve-out (NARROWED — P1-39, see docs/plans/PROPOSAL_FATIGUE.md):
  // Only the REAL-TIME price-monitor stop (closeSource='price_monitor') always
  // flows — that cron fires only when price is below the level right now, so it
  // is a genuine live breach, never a re-derivation. Everything else runs the
  // cooldown, INCLUDING agent-sourced STOP/TARGET closes. The old carve-out
  // exempted every STOP/TARGET close; that was safe when protective exits were
  // rare, but the Game Plan (#480) put a protective floor on every holding, so
  // the exemption leaked the entire protective-exit stream past the cooldown and
  // re-nagged (MU: 49 proposals across 22 days, ~71% of all exits never approved).
  //
  // Protective (STOP/TARGET) closes keep a SAFETY escape discretionary ones don't:
  // even inside the cooldown, a re-proposal flows if the breach materially
  // WORSENED vs the price the principal last declined — we never swallow a real
  // breakdown to kill a nag. Discretionary (MANUAL/TIME/untagged) closes suppress
  // unconditionally, exactly as before.
  if (args.intent === "CLOSE") {
    const thisOrder = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: {
        symbol: true,
        closeReason: true,
        closeSource: true,
        position: { select: { direction: true } },
      },
    });
    const isStop = thisOrder?.closeReason === "STOP";
    // A STOP (protective floor/trail) — from the AGENT or the price-monitor —
    // runs the escape below; the MU/MNKD fatigue is STOP re-proposals from BOTH
    // sources. Only take-profits (TARGET) and non-STOP price-monitor closes still
    // always flow; discretionary MANUAL/TIME closes still suppress after a decline.
    const bypassCooldown =
      !isStop &&
      (thisOrder?.closeSource === "price_monitor" ||
        thisOrder?.closeReason === "TARGET");
    const direction =
      thisOrder?.position?.direction === "SHORT" ? "SHORT" : "LONG";

    // Resolve the current price (caller override, else a live quote). Only needed
    // for the protective escape + to stamp the proposal; failure → null → flow.
    if (resolvedProposedPrice == null && thisOrder?.symbol) {
      resolvedProposedPrice = (await getStockQuote(thisOrder.symbol))?.c ?? null;
    }

    if (!bypassCooldown) {
      const cooldownMs = UNAPPROVED_EXIT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const cooldownStart = new Date(Date.now() - cooldownMs);
      // Only proposals you actually SAW (staged → expiresAt set) and did NOT
      // approve. expiresAt is the resolution anchor: for an EXPIRED proposal
      // it's the moment it lapsed; for a user-REJECTED one it's after the
      // (earlier) rejection, so a recent rejection is still inside the window.
      const recent = await prisma.order.findMany({
        where: {
          positionId: args.positionId,
          side: "SELL",
          intent: "CLOSE",
          status: { in: ["REJECTED", "EXPIRED"] },
          expiresAt: { not: null, gte: cooldownStart },
          id: { not: args.orderId },
        },
        orderBy: { expiresAt: "desc" },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          rejectionMessage: true,
          proposedPrice: true,
        },
      });
      // Drop systemic tombstones (dedup folds, prior cooldown suppressions) —
      // only a real decline (your rejection or an ignored expiry) counts.
      const unapproved = recent.filter(
        (o) => !isSystemicRejection(o.rejectionMessage),
      );
      const armed = unapproved[0];
      // A protective exit re-surfaces if the breach materially worsened vs the
      // last decline; discretionary exits never do. `isSameOrBetterBreach` fails
      // safe (false ⇒ re-ask) whenever a price is unknown, so a protective exit
      // is suppressed ONLY when we can prove it's the same breach already held.
      const breachWorsened =
        isStop &&
        !isSameOrBetterBreach(resolvedProposedPrice, armed?.proposedPrice, direction);
      if (armed?.expiresAt && !breachWorsened) {
        const cooldownUntil = new Date(armed.expiresAt.getTime() + cooldownMs);
        // Tombstone this call's just-created order so it doesn't linger as a
        // PENDING/AWAITING row. Systemic message → excluded from future counts.
        await prisma.order.update({
          where: { id: args.orderId },
          data: {
            status: "REJECTED",
            rejectionMessage: `Suppressed — recent unapproved CLOSE cooldown (P1-28/P1-39); last ${armed.status.toLowerCase()} ${armed.expiresAt.toISOString()}`,
          },
        });
        return {
          state: "suppressed_recent_rejection" as const,
          positionId: args.positionId,
          lastUnapprovedOrderId: armed.id,
          lastUnapprovedOutcome: armed.status as "REJECTED" | "EXPIRED",
          lastUnapprovedAt: armed.expiresAt,
          cooldownUntil,
          unapprovedExitCount: unapproved.length,
        };
      }
    }
  }

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
        // Anchor for the P1-39 protective-exit escape: the next re-proposal
        // compares its price against this one to decide "same breach vs. worse".
        proposedPrice: resolvedProposedPrice ?? undefined,
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
