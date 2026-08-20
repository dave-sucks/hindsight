/**
 * Thesis lifecycle flips at proposal-approval time.
 *
 * When the user clicks Approve on a buy proposal, the thesis should flip
 * WATCHING / PROMOTED → ACTIVE (mirroring place_trade's inline flips at
 * place-trade.ts:802-874). When the user clicks Approve on a close
 * proposal, the thesis should flip ACTIVE → CLOSED (mirroring
 * close-position.ts and manage-position.ts:full_close).
 *
 * Without these, an approved buy leaves the thesis stuck in WATCHING and
 * an approved close leaves it stuck in ACTIVE — confusing the next
 * agent run, which sees an open position with no matching thesis state.
 *
 * Both helpers mirror the existing inline logic from the non-proposal
 * path so the resulting Thesis + ThesisUpdate rows look identical
 * regardless of whether the trade ran through approval or fired direct.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import {
  defaultTriggersForHorizon,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";

/**
 * Promote the WATCHING / PROMOTED thesis on (analystId, ticker) to HOLDING,
 * regenerating HELD-side triggers based on the executed entry/target/stop.
 *
 * Mirrors place_trade.ts:802-874. Idempotent — if no WATCHING / PROMOTED
 * thesis is found (e.g. the agent already flipped it manually), no-op.
 * Failures are logged but never re-thrown — a thesis-flip miss should not
 * block the approval itself.
 */
export async function promoteThesisOnApproval(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  runId?: string | null;
}): Promise<void> {
  // PROMOTED → ACTIVE — re-entered on first live-run after promotion.
  // Done as a separate query because the thesis_id may point at a
  // PROMOTED row while a WATCHING row also exists for the same ticker.
  try {
    await prisma.thesis.updateMany({
      where: {
        ticker: opts.ticker,
        status: "PROMOTED",
        researchRun: { agentConfigId: opts.analystId },
      },
      data: { status: "HOLDING", promotedAt: null },
    });
  } catch (err) {
    console.warn(
      `[promoteThesisOnApproval] PROMOTED → HOLDING flip failed for ${opts.ticker}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // WATCHING → ACTIVE — the more common path. The thesis was a watchlist
  // row; the executed buy graduates it. Regenerate HELD-side triggers
  // from the executed levels so the trigger evaluator stops firing ENTER
  // on a name we now hold (see GAPS A2 — 35/36 ENTER tactical runs in a
  // 14-day audit were on already-held tickers).
  try {
    const watchingThesis = await prisma.thesis.findFirst({
      where: {
        ticker: opts.ticker,
        status: "WATCHING",
        researchRun: { agentConfigId: opts.analystId },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        direction: true,
        horizon: true,
        maxHoldDays: true,
        catalystDate: true,
        triggers: true,
      },
    });
    if (!watchingThesis) return;

    const horizon = watchingThesis.horizon as Horizon | null;
    let nextTriggers: Trigger[] | undefined;
    if (horizon) {
      const heldDefaults = defaultTriggersForHorizon(
        horizon,
        {
          entryPrice: opts.entryPrice,
          targetPrice: opts.targetPrice,
          stopLoss: opts.stopLoss,
          maxHoldDays: watchingThesis.maxHoldDays ?? null,
          catalystDate: watchingThesis.catalystDate ?? null,
          direction: watchingThesis.direction as "LONG" | "SHORT",
        },
        "HELD",
      );
      nextTriggers = applyTriggerCooldownDefaults(heldDefaults);
    } else {
      const existing = (watchingThesis.triggers as unknown as Trigger[] | null) ?? [];
      nextTriggers = existing.filter((t) => t.action !== "ENTER");
    }

    await prisma.thesis.update({
      where: { id: watchingThesis.id },
      data: {
        status: "HOLDING",
        triggers: (nextTriggers ?? []) as unknown as object,
      },
    });
    await prisma.thesisUpdate.create({
      data: {
        thesisId: watchingThesis.id,
        type: "STATUS_CHANGED",
        summary: `Promoted ${opts.ticker} ${watchingThesis.direction} WATCHING → HOLDING on approved proposal`,
        rationale: `Proposal approved (positionId=${opts.positionId}). Triggers regenerated for HELD-side ${horizon ?? "(no-horizon)"} template.`,
        fieldChanges: {
          status: { from: "WATCHING", to: "HOLDING" },
          triggers: { from: "WATCHING-set", to: "HELD-set" },
        },
        runId: opts.runId ?? null,
        tradeId: opts.positionId,
      },
    });
  } catch (err) {
    console.warn(
      `[promoteThesisOnApproval] WATCHING → ACTIVE flip failed for ${opts.ticker}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * A take-profit close routes the paired thesis back to WATCHING for re-entry
 * (docs/plans/SCALE_INTO_WINNERS.md PR5) instead of terminal RETIRED. Signal =
 * closeReason "TARGET" — the canonical deliberate profit-take (agent/tactical
 * target-exits carry it; the price-monitor cron closes are STOP/trailing).
 * Exported for unit testing.
 *
 * NOTE: this is no longer the ONLY road back to WATCHING — see
 * {@link shouldRecycleToWatching}, which adds the belief-attested protective
 * exit (GAPS P1-35).
 */
export function isProfitTakeReentry(closeReason: string): boolean {
  return closeReason.trim().toUpperCase() === "TARGET";
}

/**
 * Does this close route the paired thesis back to WATCHING (re-entry radar)
 * rather than to terminal RETIRED(SOLD)? Two roads back — GAPS P1-35 /
 * docs/plans/SOLD_NAME_CONTINUITY.md §1:
 *
 *   1. **Profit-take** — closeReason "TARGET". Unchanged since PR5.
 *   2. **Belief-attested protective exit** — the closing agent explicitly
 *      attested that the thesis's belief SURVIVED the exit (we exited on
 *      price, not because the story broke). `beliefSurvived === true`.
 *
 * Why (2) exists: the old rule was inverted for the risk that actually
 * matters. A TARGET exit is a sale into strength — low "did we sell the dip?"
 * risk — and it recycled. A STOP/trailing exit is a sale into weakness — the
 * HIGHEST "did we sell the dip?" risk — and it went dark forever. Measured on
 * the live book 2026-08-16: 28 of 29 SOLD theses since June 1 went terminal
 * via a non-TARGET close. ARQT (+$845), VRDN (+$445), XENE (+$966) all
 * vanished off every radar on protective exits where the belief may well have
 * been intact. The Game Plan makes this worse, not better: TRAILING_FROM_HIGH
 * is *designed* to bank a give-back regardless of whether the thesis holds, so
 * a growing share of exits are "belief survived, we just protected the gain."
 *
 * Deliberately NOT a blunt "recycle every stop" rule: a genuinely broken
 * thesis should stay dead rather than clog the watchlist. The agent decides
 * (Layer 3 judgment), this function and the flip below provide the mechanism
 * (Layer 2). No attestation — the price-monitor cron, DIRECT-mode fires,
 * manual UI closes, promotion force-closes — degrades to today's terminal
 * behavior, which is the safe default.
 *
 * An INVALIDATED-flavored close can never recycle even if something upstream
 * attested: "the setup broke structurally" and "the belief survived" are
 * contradictory, and the close tools collapse THESIS_INVALIDATED into MANUAL
 * before it reaches here, so we guard on the raw text too.
 */
export function shouldRecycleToWatching(
  closeReason: string,
  beliefSurvived?: boolean | null,
): boolean {
  if (isProfitTakeReentry(closeReason)) return true;
  if (beliefSurvived !== true) return false;
  const normalized = closeReason.trim().toUpperCase();
  return !normalized.includes("INVALID");
}

/**
 * Flip the ACTIVE thesis on (analystId, ticker) to CLOSED and write the
 * status-change audit row. The single shared chokepoint for "a position
 * truly closed → reflect it on the paired thesis," used by:
 *
 *   • closeOpenPosition's FILLED-close branch (lib/actions/closeTrade.actions.ts)
 *     — every direct close that actually fills now (agent close_position,
 *     manage_position full_close, the price-monitor trailing-stop cron, and
 *     manual UI closes) routes through there, so they all flip identically.
 *   • closeThesisOnApproval (below) — the approval path, when an
 *     AWAITING_APPROVAL close proposal is later approved.
 *
 * Audit row type stays `CLOSED` (not STATUS_CHANGED): the dashboard activity
 * feed + run-summary bucket the close on `type === "CLOSED"`, and the
 * tactical-run close-out gate accepts any non-TRIGGER_FIRED row. The
 * fieldChanges payload carries the ACTIVE→CLOSED status delta.
 *
 * Idempotent — if no matching ACTIVE thesis is found (already flipped, or
 * the close path's tool already handled it), it no-ops. Failures are logged
 * but never re-thrown: a thesis-flip miss must not roll back a fill that
 * already happened. The next agent run recovers via get_theses.
 *
 * P1-18: before this was wired into closeOpenPosition, a price-monitor
 * trailing-stop close on an approval-OFF book closed the Position but left
 * the paired thesis ACTIVE forever (an ACTIVE thesis with no position).
 */
export async function closeThesisForPosition(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  /** "TARGET" | "STOP" | "TIME" | "MANUAL" or a richer free-text reason. */
  closeReason: string;
  rationale: string | null;
  /** Fill price, surfaced as priceAtTime on the audit row when known. */
  priceAtTime?: number | null;
  runId?: string | null;
  /** Distinguishes "approved proposal" vs "direct fill" in the summary. */
  summaryContext?: string;
  /**
   * GAPS P1-35 — the closing agent's attestation that the thesis BELIEF
   * survived this exit (we sold on price, not because the story broke). true
   * recycles a protective exit back to WATCHING instead of terminal RETIRED.
   * Undefined/null on every non-agent path (price-monitor cron, DIRECT fires,
   * manual UI closes) → terminal, i.e. unchanged behavior.
   */
  beliefSurvived?: boolean | null;
}): Promise<void> {
  try {
    const activeThesis = await prisma.thesis.findFirst({
      where: {
        ticker: opts.ticker,
        // P1-24 B2: held theses are HOLDING (new) or ACTIVE (legacy, pre-
        // backfill). Match both so an approved close never strands a held row.
        status: { in: ["HOLDING"] },
        // P1-24 PASS-off-direction: explicit ALLOWLIST (LONG/SHORT) replaces
        // the old `{ not: "PASS" }` denylist. A held thesis is always
        // directional; the allowlist is robust to direction=null and the
        // status filter above already excludes passes (PASS → status=PASSED).
        direction: { in: ["LONG", "SHORT"] },
        researchRun: { agentConfigId: opts.analystId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!activeThesis) return;

    const ctxSuffix = opts.summaryContext ? ` ${opts.summaryContext}` : "";

    // ── Re-entry radar (docs/plans/SCALE_INTO_WINNERS.md PR5) ──────────────
    // A take-profit on a name we still believe in returns to WATCHING rather
    // than terminal RETIRED, so the daily run keeps it on the radar and can
    // re-enter on a pullback. (A RETIRED/SOLD row is DEAD — excluded from
    // get_theses' default book, re-mintable only by Discovery.) Held-only
    // triggers (stop EXIT, scale-in rungs) are cleared since there is no
    // position; nextReviewAt=now flags it so the next run sets a fresh
    // re-entry trigger or archives it. Only profit-takes route here — stops,
    // invalidations, and risk exits stay RETIRED via the branch below.
    if (shouldRecycleToWatching(opts.closeReason, opts.beliefSurvived)) {
      // Two flavors land here: a profit-take (TARGET), and a protective exit
      // the closing agent attested the belief survived (P1-35). They get the
      // same mechanism — triggers cleared (no position, so held-side rungs are
      // meaningless) and nextReviewAt=now so the next daily run MUST resolve
      // it: arm a reclaim entry trigger, or archive it. Re-entry always runs
      // through an ENTER trigger on a reclaim, never an auto-rebuy at the
      // stop-out price.
      const isProfitTake = isProfitTakeReentry(opts.closeReason);
      await prisma.thesis.update({
        where: { id: activeThesis.id },
        data: {
          status: "WATCHING",
          retiredReason: null,
          closedAt: new Date(),
          closeReason: opts.closeReason,
          triggers: [],
          nextReviewAt: new Date(),
        },
      });
      await writeThesisUpdate({
        thesisId: activeThesis.id,
        type: "CLOSED",
        summary: isProfitTake
          ? `Took profit on ${opts.ticker}${ctxSuffix} — ${opts.closeReason}; kept on watch for re-entry`
          : `Closed ${opts.ticker}${ctxSuffix} — ${opts.closeReason}; belief intact, kept on watch for a reclaim`,
        rationale:
          opts.rationale ??
          (isProfitTake
            ? `Profit-take. Position closed; thesis kept WATCHING for a re-entry on a pullback.`
            : `Protective exit on price — the closing agent attested the belief survived. Thesis kept WATCHING for a reclaim; the next run arms a reclaim trigger or archives it.`),
        fieldChanges: {
          status: { from: activeThesis.status, to: "WATCHING" },
          ...(isProfitTake ? {} : { beliefSurvived: { from: null, to: true } }),
        },
        runId: opts.runId,
        priceAtTime: opts.priceAtTime ?? null,
      });
      return;
    }

    await prisma.thesis.update({
      where: { id: activeThesis.id },
      data: {
        // P1-24 B3: terminal collapse — a sold/closed position retires the
        // thesis with retiredReason=SOLD (was status='CLOSED'). closedAt/
        // closeReason still carry the narrative.
        status: "RETIRED",
        retiredReason: "SOLD",
        closedAt: new Date(),
        closeReason: opts.closeReason,
      },
    });
    await writeThesisUpdate({
      thesisId: activeThesis.id,
      type: "CLOSED",
      summary: `Closed ${opts.ticker} position${ctxSuffix} — ${opts.closeReason}`,
      rationale:
        opts.rationale ?? `Position closed. Reason: ${opts.closeReason}.`,
      fieldChanges: {
        status: { from: activeThesis.status, to: "RETIRED" },
        retiredReason: { from: null, to: "SOLD" },
      },
      runId: opts.runId,
      priceAtTime: opts.priceAtTime ?? null,
    });
  } catch (err) {
    console.warn(
      `[closeThesisForPosition] ACTIVE → CLOSED flip failed for ${opts.ticker}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Flip the ACTIVE thesis on (analystId, ticker) to CLOSED on a successful
 * close proposal. Thin wrapper over {@link closeThesisForPosition} so the
 * approval path and the direct-fill path produce identical Thesis +
 * ThesisUpdate shapes. See docs/plans/TRADE_AS_PROPOSAL.md.
 */
export async function closeThesisOnApproval(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  closeReason: string;
  rationale: string | null;
  runId?: string | null;
  /**
   * P1-35 — read off `Order.closeBeliefSurvived`, the attestation the agent
   * made when it PROPOSED this close. The approval can land days later, so
   * the Order row is what carries the agent's judgment across the gap.
   */
  beliefSurvived?: boolean | null;
}): Promise<void> {
  await closeThesisForPosition({
    analystId: opts.analystId,
    ticker: opts.ticker,
    positionId: opts.positionId,
    closeReason: opts.closeReason,
    rationale:
      opts.rationale ?? `Close proposal approved. Reason: ${opts.closeReason}.`,
    runId: opts.runId,
    summaryContext: "on approved proposal",
    beliefSurvived: opts.beliefSurvived,
  });
}
