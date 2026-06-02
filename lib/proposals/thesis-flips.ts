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
 * Promote the WATCHING / PROMOTED thesis on (analystId, ticker) to ACTIVE,
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
      data: { status: "ACTIVE", promotedAt: null },
    });
  } catch (err) {
    console.warn(
      `[promoteThesisOnApproval] PROMOTED → ACTIVE flip failed for ${opts.ticker}:`,
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
        status: "ACTIVE",
        triggers: (nextTriggers ?? []) as unknown as object,
      },
    });
    await prisma.thesisUpdate.create({
      data: {
        thesisId: watchingThesis.id,
        type: "STATUS_CHANGED",
        summary: `Promoted ${opts.ticker} ${watchingThesis.direction} WATCHING → ACTIVE on approved proposal`,
        rationale: `Proposal approved (positionId=${opts.positionId}). Triggers regenerated for HELD-side ${horizon ?? "(no-horizon)"} template.`,
        fieldChanges: {
          status: { from: "WATCHING", to: "ACTIVE" },
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
 * Flip the ACTIVE thesis on (analystId, ticker) to CLOSED on a successful
 * close proposal. Mirrors close-position.ts and manage-position.ts
 * full_close — writes the same Thesis update + ThesisUpdate(CLOSED) audit
 * row so the timeline + tactical-run close-out gate see the same shape
 * regardless of whether the close ran through approval or fired direct.
 *
 * Failures are logged but not re-thrown — the close itself was approved
 * and submitted; a thesis-flip miss is recoverable on the next agent run.
 */
export async function closeThesisOnApproval(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  closeReason: string;
  rationale: string | null;
  runId?: string | null;
}): Promise<void> {
  try {
    const activeThesis = await prisma.thesis.findFirst({
      where: {
        ticker: opts.ticker,
        status: "ACTIVE",
        direction: { not: "PASS" },
        researchRun: { agentConfigId: opts.analystId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
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
    await writeThesisUpdate({
      thesisId: activeThesis.id,
      type: "CLOSED",
      summary: `Closed ${opts.ticker} position on approved proposal — ${opts.closeReason}`,
      rationale:
        opts.rationale ??
        `Close proposal approved. Reason: ${opts.closeReason}.`,
      fieldChanges: {
        status: { from: "ACTIVE", to: "CLOSED" },
      },
      runId: opts.runId,
    });
  } catch (err) {
    console.warn(
      `[closeThesisOnApproval] ACTIVE → CLOSED flip failed for ${opts.ticker}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
