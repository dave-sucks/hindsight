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
}): Promise<void> {
  try {
    const activeThesis = await prisma.thesis.findFirst({
      where: {
        ticker: opts.ticker,
        // P1-24 B2: held theses are HOLDING (new) or ACTIVE (legacy, pre-
        // backfill). Match both so an approved close never strands a held row.
        status: { in: ["ACTIVE", "HOLDING"] },
        direction: { not: "PASS" },
        researchRun: { agentConfigId: opts.analystId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!activeThesis) return;

    await prisma.thesis.update({
      where: { id: activeThesis.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeReason: opts.closeReason,
      },
    });
    const ctxSuffix = opts.summaryContext ? ` ${opts.summaryContext}` : "";
    await writeThesisUpdate({
      thesisId: activeThesis.id,
      type: "CLOSED",
      summary: `Closed ${opts.ticker} position${ctxSuffix} — ${opts.closeReason}`,
      rationale:
        opts.rationale ?? `Position closed. Reason: ${opts.closeReason}.`,
      fieldChanges: {
        status: { from: activeThesis.status, to: "CLOSED" },
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
  });
}
