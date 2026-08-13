"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccount } from "@/lib/alpaca";
import { getAccountId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { closeOpenPosition } from "@/lib/actions/closeTrade.actions";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { inngest } from "@/lib/inngest/client";
import {
  defaultTriggersForHorizon,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";
import { revalidatePath } from "next/cache";

async function getServerUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export type PromotionPreview = {
  analystId: string;
  analystName: string;
  currentEnvironment: "PAPER" | "LIVE";
  liveCredsVerified: boolean;
  realMaxPosition: number;
  openPaperPositions: Array<{
    id: string;
    symbol: string;
    direction: string;
    quantity: number;
    avgCost: number;
  }>;
  openLivePositions: Array<{
    id: string;
    symbol: string;
    direction: string;
    quantity: number;
    avgCost: number;
  }>;
  /** ACTIVE theses with no open position — also become PROMOTED at promotion time. */
  orphanActiveTheses: Array<{ id: string; ticker: string }>;
  /** PROMOTED theses already waiting (e.g. a prior promotion partially completed). */
  existingPromoted: Array<{ id: string; ticker: string }>;
};

/**
 * Read-only snapshot for the Promote/Demote dialogs.
 */
export async function getPromotionPreview(
  analystId: string,
): Promise<PromotionPreview | { error: string }> {
  const userId = await getServerUserId();
  const accountId = await getAccountId(userId);
  if (!accountId) return { error: "Account not found" };

  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
    select: {
      id: true,
      name: true,
      tradingEnvironment: true,
      realMaxPosition: true,
    },
  });
  if (!analyst) return { error: "Analyst not found" };

  const [openPaper, openLive, liveKey, activeTheses, promotedTheses] = await Promise.all([
    prisma.position.findMany({
      where: { analystId, status: "OPEN", environment: "PAPER" },
      select: { id: true, symbol: true, direction: true, quantity: true, avgCost: true },
      orderBy: { openedAt: "asc" },
    }),
    prisma.position.findMany({
      where: { analystId, status: "OPEN", environment: "LIVE" },
      select: { id: true, symbol: true, direction: true, quantity: true, avgCost: true },
      orderBy: { openedAt: "asc" },
    }),
    prisma.userApiKey.findUnique({
      where: {
        userId_provider_environment: { userId, provider: "ALPACA", environment: "LIVE" },
      },
      select: { verified: true },
    }),
    prisma.thesis.findMany({
      where: {
        status: { in: ["HOLDING"] },
        // Only promote committed directional theses. This is an explicit
        // ALLOWLIST (LONG/SHORT) rather than a denylist — it excludes PASS
        // (institutional memory, never traded), unresearched seeds (legacy
        // 'PENDING' or P1-24 B4 direction=null — no conviction, no paper
        // position), and is robust to NULL (a `notIn` denylist would exclude
        // NULL only by Postgres three-valued-logic accident). The status
        // filter above already restricts to held theses; this makes the
        // direction intent unambiguous.
        direction: { in: ["LONG", "SHORT"] },
        researchRun: { agentConfigId: analystId },
      },
      select: { id: true, ticker: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.thesis.findMany({
      where: {
        status: "PROMOTED",
        researchRun: { agentConfigId: analystId },
      },
      select: { id: true, ticker: true },
      orderBy: { promotedAt: "desc" },
    }),
  ]);

  // Orphan = ACTIVE thesis with no open position in the analyst's portfolio.
  // Rare but real (stale state after a stop fired without the agent closing
  // the thesis). At promotion these still become PROMOTED — same conviction,
  // just nothing to close.
  const openPaperTickers = new Set(openPaper.map((p) => p.symbol));
  const orphanActiveTheses = activeTheses.filter((t) => !openPaperTickers.has(t.ticker));

  return {
    analystId: analyst.id,
    analystName: analyst.name,
    currentEnvironment: (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER",
    liveCredsVerified: liveKey?.verified ?? false,
    realMaxPosition: analyst.realMaxPosition,
    openPaperPositions: openPaper,
    openLivePositions: openLive,
    orphanActiveTheses,
    existingPromoted: promotedTheses,
  };
}

export type DispatchedRewrite = {
  thesisId: string;
  ticker: string;
  childRunId: string;
};

export type PromotionResult =
  | {
      ok: true;
      closed: number;
      promoted: number;
      dispatchedRewrites: DispatchedRewrite[];
    }
  | { ok: false; error: string; failedSymbol?: string; closedBeforeFailure: number };

/**
 * Promote PAPER → LIVE.
 *
 * 1. Validate live creds reachable (fail before touching anything).
 * 2. Refuse if a RUNNING run exists for this analyst (race protection).
 * 3. Close every open paper position. After each close, mark the linked
 *    thesis PROMOTED with conviction context (tenure, P&L, review count).
 *    Each (close, position update, thesis update) is committed before
 *    moving to the next ticker — so a partial failure leaves a
 *    coherent state: already-closed positions stay closed, their
 *    theses are PROMOTED, and the user retries to finish the rest.
 * 4. Mark any ACTIVE-orphan theses (no position) PROMOTED too — the
 *    conviction is the same shape.
 * 5. Flip AgentConfig.tradingEnvironment to LIVE.
 *
 * Promotion is idempotent under retry: step 3 only acts on remaining
 * OPEN paper positions, step 4 only acts on remaining ACTIVE theses,
 * step 5 only fires when steps 3+4 complete with no failures.
 */
export async function promoteAnalystToLive(
  analystId: string,
  options?: { realMaxPosition?: number },
): Promise<PromotionResult> {
  const userId = await getServerUserId();
  const accountId = await getAccountId(userId);
  if (!accountId) return { ok: false, error: "Account not found", closedBeforeFailure: 0 };

  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
    select: { id: true, name: true, tradingEnvironment: true },
  });
  if (!analyst) return { ok: false, error: "Analyst not found", closedBeforeFailure: 0 };
  if (analyst.tradingEnvironment === "LIVE") {
    return { ok: false, error: "Analyst is already live", closedBeforeFailure: 0 };
  }

  // 0. Race protection — no concurrent runs allowed during promotion.
  // The morning cron / manual run flow each acquires its own RUNNING row
  // before any tool call; if one is in flight we wait it out rather than
  // promoting against a moving target.
  const runningRun = await prisma.researchRun.findFirst({
    where: { agentConfigId: analystId, status: "RUNNING" },
    select: { id: true },
  });
  if (runningRun) {
    return {
      ok: false,
      error: "A research run is currently in progress for this analyst. Wait for it to finish, then promote.",
      closedBeforeFailure: 0,
    };
  }

  // 1. Validate live creds are reachable BEFORE we start closing paper positions.
  const liveCreds = await resolveAlpacaCredentials(userId, "LIVE");
  if (!liveCreds) {
    return {
      ok: false,
      error: "No live Alpaca credentials saved. Add them in Settings before promoting.",
      closedBeforeFailure: 0,
    };
  }
  try {
    await getAccount(liveCreds);
  } catch (err) {
    return {
      ok: false,
      error: `Live Alpaca account not reachable: ${err instanceof Error ? err.message : String(err)}`,
      closedBeforeFailure: 0,
    };
  }

  // 2. Close every open paper position + transition its thesis to PROMOTED.
  const openPaper = await prisma.position.findMany({
    where: { analystId, status: "OPEN", environment: "PAPER" },
    select: { id: true, symbol: true },
  });

  let closed = 0;
  const promotedTheses: PromotedThesisRecord[] = [];
  for (const pos of openPaper) {
    try {
      const closeOutcome = await closeOpenPosition(
        pos.id,
        "MANUAL",
        undefined,
        "user",
        `Closed as part of promoting analyst ${analyst.name} from PAPER to LIVE.`,
        undefined,
      );
      // promote-analyst always passes source="user" — the Trade-as-Proposal
      // gate never fires on this path. Narrow the union for downstream
      // field access. See docs/plans/TRADE_AS_PROPOSAL.md.
      if (closeOutcome.kind !== "closed") {
        throw new Error(
          `promote-analyst: closeOpenPosition returned unexpected proposal outcome for ${pos.symbol}`,
        );
      }
      const closeResult = closeOutcome;
      // Mark position with closeReason=PROMOTED so the trade ledger UI
      // can distinguish promotion-closes from stops/targets/manual.
      await prisma.position.update({
        where: { id: pos.id },
        data: { closeReason: "PROMOTED" },
      });
      closed++;

      // Transition the linked ACTIVE thesis → PROMOTED with conviction context.
      const promoted = await transitionThesisToPromoted({
        ticker: pos.symbol,
        analystId,
        promotionRealizedPnl: closeResult.realizedPnl,
        promotionClosePrice: closeResult.closePrice,
        promotionFillStatus: closeResult.fillStatus,
        // Link the audit row to the position we just closed so the
        // thesis timeline can render a "View trade" deeplink. Lets the
        // user click through from the PROMOTED entry to the closed
        // paper trade with its final P&L.
        tradeId: pos.id,
      });
      if (promoted) promotedTheses.push(promoted);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to close paper position in ${pos.symbol}: ${err instanceof Error ? err.message : String(err)}`,
        failedSymbol: pos.symbol,
        closedBeforeFailure: closed,
      };
    }
  }

  // 3. Mark any ACTIVE-orphan theses (no position to close) as PROMOTED too.
  // Same conviction shape; the "close paper position" step is just a no-op.
  const orphanActive = await prisma.thesis.findMany({
    where: {
      status: { in: ["HOLDING"] },
      // P1-24 PASS-off-direction: explicit ALLOWLIST (LONG/SHORT), matching
      // the primary promote query above. Robust to direction=null; the
      // status filter already excludes passes (PASS → status=PASSED). Was
      // `{ not: "PASS" }`.
      direction: { in: ["LONG", "SHORT"] },
      researchRun: { agentConfigId: analystId },
    },
    select: { id: true, ticker: true },
  });
  for (const t of orphanActive) {
    const promoted = await transitionThesisToPromoted({
      thesisId: t.id,
      ticker: t.ticker,
      analystId,
      promotionRealizedPnl: 0,
      promotionClosePrice: null,
      promotionFillStatus: "FILLED",
      isOrphan: true,
    });
    if (promoted) promotedTheses.push(promoted);
  }

  // 4. Flip the env flag. Optionally update the live cap in the same write.
  await prisma.agentConfig.update({
    where: { id: analystId },
    data: {
      tradingEnvironment: "LIVE",
      ...(options?.realMaxPosition !== undefined
        ? { realMaxPosition: options.realMaxPosition }
        : {}),
    },
  });

  // 5. Fan out thesis-writer rewrites for every PROMOTED thesis. Fire-and-
  // forget — the worker runs async (~3-4 min each). Promotion is already
  // complete at this point; missing a rewrite means the first live daily
  // run will read the pre-promotion research. The Phase-2 staleness gate
  // (see docs/plans/THESIS_LIFECYCLE_FIX.md) will let the daily agent
  // self-heal by dispatching a refresh in-band; until Phase 2 ships, the
  // user should watch the rewrite deep-links in the promotion dialog and
  // confirm they all land before triggering the first live run. Parallel
  // via Promise.all.
  const dispatchedRewrites = await fanOutPromotionRewrites({
    userId,
    accountId,
    analystId,
    analystName: analyst.name,
    promoted: promotedTheses,
    runEnvironment: "LIVE",
  });

  revalidatePath(`/analysts/${analystId}`);
  revalidatePath("/analysts");
  revalidatePath("/");
  revalidatePath("/trades");
  return {
    ok: true,
    closed,
    promoted: promotedTheses.length,
    dispatchedRewrites,
  };
}

type PromotedThesisRecord = {
  thesisId: string;
  ticker: string;
  paperTenureDays: number;
  paperRealizedPnl: number;
  paperReviewCount: number;
  promotedAt: Date;
};

/**
 * Move a thesis ACTIVE → PROMOTED with conviction context frozen in.
 *
 * Looks up the most recent ACTIVE thesis on this ticker for this analyst.
 * Computes paperTenureDays from the analyst's first ACTIVE Position on
 * this ticker, paperRealizedPnl from the sum of realizedPnl on closed
 * positions for this ticker on this analyst, and paperReviewCount from
 * ThesisUpdate rows of type UPDATED/REVIEWED.
 *
 * Writes a single ThesisUpdate audit row of type STATUS_CHANGED for the
 * timeline. The status flip + context fields + audit row land in one tx.
 *
 * Returns the promoted thesis record (id + ticker + conviction context) so
 * the caller can fan out a thesis-writer refresh; null if no matching
 * thesis was found (idempotency / pre-condition mismatch).
 */
async function transitionThesisToPromoted(input: {
  ticker: string;
  analystId: string;
  promotionRealizedPnl: number;
  promotionClosePrice: number | null;
  promotionFillStatus: "FILLED" | "PENDING";
  thesisId?: string;
  isOrphan?: boolean;
  /** Position id of the paper trade just closed at promotion (null for orphans). */
  tradeId?: string;
}): Promise<PromotedThesisRecord | null> {
  // Pull the structural fields we need both for conviction context
  // and for regenerating the trigger array against the PROMOTED template
  // (P1-21). Without the regen, PROMOTED inherits the predecessor
  // ACTIVE row's HELD-template EXIT triggers — orphan tactical EXIT
  // runs the moment price crosses the old stop on a thesis that has no
  // open position to close.
  const thesisSelect = {
    id: true,
    createdAt: true,
    ticker: true,
    direction: true,
    horizon: true,
    entryPrice: true,
    targetPrice: true,
    stopLoss: true,
    maxHoldDays: true,
    catalystDate: true,
  };
  const thesis = input.thesisId
    ? await prisma.thesis.findUnique({
        where: { id: input.thesisId },
        select: thesisSelect,
      })
    : await prisma.thesis.findFirst({
        where: {
          ticker: input.ticker,
          status: { in: ["HOLDING"] },
          // P1-24 PASS-off-direction: explicit ALLOWLIST (LONG/SHORT). Robust
          // to direction=null; the status filter already excludes passes
          // (PASS → status=PASSED). Was `{ not: "PASS" }`.
          direction: { in: ["LONG", "SHORT"] },
          researchRun: { agentConfigId: input.analystId },
        },
        orderBy: { createdAt: "desc" },
        select: thesisSelect,
      });
  if (!thesis) return null;

  // Conviction context — frozen at promotion time so it never goes stale.
  const [allClosedPositions, reviewCount] = await Promise.all([
    prisma.position.findMany({
      where: { analystId: input.analystId, symbol: input.ticker, status: "CLOSED" },
      select: { realizedPnl: true, openedAt: true },
    }),
    prisma.thesisUpdate.count({
      where: { thesisId: thesis.id, type: { in: ["UPDATED", "REVIEWED"] } },
    }),
  ]);
  const cumulativePaperPnl = allClosedPositions.reduce(
    (sum, p) => sum + (p.realizedPnl ?? 0),
    0,
  ) + (input.promotionRealizedPnl ?? 0);
  const firstOpenedAt = allClosedPositions
    .map((p) => p.openedAt.getTime())
    .reduce<number | null>((acc, t) => (acc === null || t < acc ? t : acc), null);
  const paperTenureDays = firstOpenedAt
    ? Math.max(1, Math.round((Date.now() - firstOpenedAt) / 86_400_000))
    : 0;

  const summary = input.isOrphan
    ? `Thesis ACTIVE→PROMOTED during analyst promotion to LIVE. No open paper position to close; conviction preserved for first-live-run review.`
    : `Thesis ACTIVE→PROMOTED during analyst promotion to LIVE. Paper position closed at $${(input.promotionClosePrice ?? 0).toFixed(2)} (final P&L ${input.promotionRealizedPnl >= 0 ? "+" : ""}$${input.promotionRealizedPnl.toFixed(2)}). Cumulative paper P&L on this name: ${cumulativePaperPnl >= 0 ? "+" : ""}$${cumulativePaperPnl.toFixed(2)} over ${paperTenureDays}d; reaffirmed ${reviewCount}× by the analyst.`;

  const promotedAt = new Date();

  // Regenerate triggers against the PROMOTED template (P1-21). HELD-side
  // EXIT/TRIM/ADD/MOVE_STOP triggers carried over from the predecessor
  // ACTIVE row would otherwise spawn orphan tactical EXIT runs on a
  // thesis with no open position. The PROMOTED template emits ENTER
  // (the re-entry path — place_trade auto-flips PROMOTED→ACTIVE per
  // PR #324) + REVIEW only; no EXIT. Falls back to a conservative
  // strip of EXIT/TRIM/ADD/MOVE_STOP if horizon is missing (rare).
  const horizon = thesis.horizon as Horizon | null;
  let promotedTriggers: Trigger[] | undefined;
  if (horizon) {
    const defaults = defaultTriggersForHorizon(
      horizon,
      {
        entryPrice: thesis.entryPrice != null ? Number(thesis.entryPrice) : null,
        targetPrice: thesis.targetPrice != null ? Number(thesis.targetPrice) : null,
        stopLoss: thesis.stopLoss != null ? Number(thesis.stopLoss) : null,
        maxHoldDays: thesis.maxHoldDays ?? null,
        catalystDate: thesis.catalystDate ?? null,
        direction: thesis.direction as "LONG" | "SHORT",
      },
      "PROMOTED",
    );
    promotedTriggers = applyTriggerCooldownDefaults(defaults);
  }

  await prisma.$transaction([
    prisma.thesis.update({
      where: { id: thesis.id },
      data: {
        status: "PROMOTED",
        promotedAt,
        paperTenureDays,
        paperRealizedPnl: cumulativePaperPnl,
        paperReviewCount: reviewCount,
        ...(promotedTriggers !== undefined
          ? { triggers: promotedTriggers as unknown as object }
          : {}),
      },
    }),
  ]);

  // ThesisUpdate write is separate so writeThesisUpdate's defensive
  // position-snapshot lookup runs after the status flip (otherwise it
  // would still see the ACTIVE position about to be closed).
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "STATUS_CHANGED",
    summary,
    rationale:
      "Administrative transition, not a thesis decision. First live run is expected to call place_trade (re-enter) or update_thesis(WATCHING) (defer). Killing a PROMOTED thesis directly is forbidden by update_thesis.",
    // Structured diff — the timeline UI reads `status.to === "PROMOTED"`
    // to identify these rows; the conviction-context numbers give the
    // user a quick read on what was held without re-deriving from
    // joined Position rows.
    fieldChanges: {
      status: { from: "HOLDING", to: "PROMOTED" },
      paperRealizedPnl: { from: null, to: cumulativePaperPnl },
      paperTenureDays: { from: null, to: paperTenureDays },
      paperReviewCount: { from: null, to: reviewCount },
    },
    runId: null,
    priceAtTime: input.promotionClosePrice,
    // Linked Position id — drives the "View trade" deeplink on the
    // timeline entry. Null for orphan ACTIVE theses with no position
    // to close (the writeThesisUpdate helper handles null fine).
    tradeId: input.tradeId,
  });

  return {
    thesisId: thesis.id,
    ticker: thesis.ticker,
    paperTenureDays,
    paperRealizedPnl: cumulativePaperPnl,
    paperReviewCount: reviewCount,
    promotedAt,
  };
}

/**
 * Spawn a thesis-writer "refresh" sub-agent for each promoted thesis. Mirrors
 * dispatch_thesis_research's logic — create the child ResearchRun row, fire
 * `app/thesis.write.requested` carrying the promotion context. The worker
 * runs ~3-4 min per thesis; we return the child run IDs immediately so the
 * promote dialog can surface deep-links. Promise.all runs them in parallel.
 *
 * Failures here are non-fatal to the promotion itself — the analyst is
 * already PROMOTED on the row; missing the rewrite means the first live
 * daily run will read the pre-promotion research. Phase 2 of the lifecycle
 * fix (docs/plans/THESIS_LIFECYCLE_FIX.md) adds the in-band refresh path
 * so the daily agent can self-heal; until then, the user should confirm
 * all dispatched rewrites land via the promotion-dialog deep-links before
 * triggering the first live run.
 */
async function fanOutPromotionRewrites(input: {
  userId: string;
  accountId: string;
  analystId: string;
  analystName: string;
  promoted: PromotedThesisRecord[];
  runEnvironment: "PAPER" | "LIVE";
}): Promise<DispatchedRewrite[]> {
  if (input.promoted.length === 0) return [];

  const dispatches = await Promise.all(
    input.promoted.map(async (t): Promise<DispatchedRewrite | null> => {
      try {
        const reason =
          `PAPER→LIVE promotion. Paper context: held ${t.paperTenureDays}d, ` +
          `$${t.paperRealizedPnl.toFixed(2)} realized, ${t.paperReviewCount} reviews. ` +
          `Rewrite with promotion framing: re-enter / downgrade / invalidate.`;

        // Mode column is a String (not enum) — matches dispatch_thesis_research.
        const childRun = await prisma.researchRun.create({
          data: {
            userId: input.userId,
            accountId: input.accountId,
            agentConfigId: input.analystId,
            source: "AGENT",
            status: "RUNNING",
            mode: "THESIS_WRITER",
            environment: input.runEnvironment,
            parameters: {
              ticker: t.ticker,
              mode: "refresh",
              existingThesisId: t.thesisId,
              reason,
              dispatchedAt: new Date().toISOString(),
              promotionContext: {
                paperTenureDays: t.paperTenureDays,
                paperRealizedPnl: t.paperRealizedPnl,
                paperReviewCount: t.paperReviewCount,
                promotedAt: t.promotedAt.toISOString(),
              },
              dispatchedBy: "promote-analyst-action",
            } as object,
          },
          select: { id: true },
        });

        await inngest.send({
          name: "app/thesis.write.requested",
          data: {
            childRunId: childRun.id,
            ticker: t.ticker,
            analystId: input.analystId,
            mode: "refresh",
            existingThesisId: t.thesisId,
            reason,
            parentRunId: null,
            forceWatchingMint: false,
            promotionContext: {
              paperTenureDays: t.paperTenureDays,
              paperRealizedPnl: t.paperRealizedPnl,
              paperReviewCount: t.paperReviewCount,
              promotedAt: t.promotedAt.toISOString(),
            },
          },
        });

        return {
          thesisId: t.thesisId,
          ticker: t.ticker,
          childRunId: childRun.id,
        };
      } catch (err) {
        console.error(
          `[promote-analyst] dispatch_thesis_research failed for ${t.ticker} (thesis=${t.thesisId}):`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    }),
  );

  return dispatches.filter((d): d is DispatchedRewrite => d !== null);
}

export type DemotionResult =
  | { ok: true; reverted: number }
  | { ok: false; error: string; openLiveCount: number };

/**
 * Demote LIVE → PAPER. Requires every open live position to be closed
 * first (the demote dialog has a "close all" path that calls
 * closeAllLivePositionsAndDemote).
 *
 * Any PROMOTED theses are converted to WATCHING with a status-change
 * audit row. Conviction context (paperTenureDays / paperRealizedPnl /
 * paperReviewCount) stays on the row for later reference; promotedAt
 * is cleared since the promotion is no longer in effect.
 */
export async function demoteAnalystToPaper(
  analystId: string,
): Promise<DemotionResult> {
  const userId = await getServerUserId();
  const accountId = await getAccountId(userId);
  if (!accountId) return { ok: false, error: "Account not found", openLiveCount: 0 };

  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
    select: { id: true, tradingEnvironment: true, name: true },
  });
  if (!analyst) return { ok: false, error: "Analyst not found", openLiveCount: 0 };
  if (analyst.tradingEnvironment === "PAPER") {
    return { ok: false, error: "Analyst is already on paper", openLiveCount: 0 };
  }

  const openLive = await prisma.position.count({
    where: { analystId, status: "OPEN", environment: "LIVE" },
  });
  if (openLive > 0) {
    return {
      ok: false,
      error: `Close all ${openLive} open live position${openLive === 1 ? "" : "s"} before demoting.`,
      openLiveCount: openLive,
    };
  }

  const reverted = await revertPromotedThesesToWatching(analystId);

  await prisma.agentConfig.update({
    where: { id: analystId },
    data: { tradingEnvironment: "PAPER" },
  });

  revalidatePath(`/analysts/${analystId}`);
  revalidatePath("/analysts");
  return { ok: true, reverted };
}

/**
 * "Close all and demote" — closes every open LIVE position at market,
 * then converts any PROMOTED theses back to WATCHING, then flips env.
 */
export async function closeAllLivePositionsAndDemote(
  analystId: string,
): Promise<PromotionResult> {
  const userId = await getServerUserId();
  const accountId = await getAccountId(userId);
  if (!accountId) return { ok: false, error: "Account not found", closedBeforeFailure: 0 };

  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
    select: { id: true, tradingEnvironment: true, name: true },
  });
  if (!analyst) return { ok: false, error: "Analyst not found", closedBeforeFailure: 0 };
  if (analyst.tradingEnvironment === "PAPER") {
    return { ok: false, error: "Analyst is already on paper", closedBeforeFailure: 0 };
  }

  const openLive = await prisma.position.findMany({
    where: { analystId, status: "OPEN", environment: "LIVE" },
    select: { id: true, symbol: true },
  });

  let closed = 0;
  for (const pos of openLive) {
    try {
      await closeOpenPosition(pos.id, "MANUAL", undefined, "user", `Closed as part of demoting analyst ${analyst.name} from LIVE to PAPER.`, undefined);
      closed++;
    } catch (err) {
      return {
        ok: false,
        error: `Failed to close live position in ${pos.symbol}: ${err instanceof Error ? err.message : String(err)}`,
        failedSymbol: pos.symbol,
        closedBeforeFailure: closed,
      };
    }
  }

  const reverted = await revertPromotedThesesToWatching(analystId);

  await prisma.agentConfig.update({
    where: { id: analystId },
    data: { tradingEnvironment: "PAPER" },
  });

  revalidatePath(`/analysts/${analystId}`);
  revalidatePath("/analysts");
  revalidatePath("/");
  return { ok: true, closed, promoted: reverted, dispatchedRewrites: [] };
}

async function revertPromotedThesesToWatching(analystId: string): Promise<number> {
  const promotedTheses = await prisma.thesis.findMany({
    where: {
      status: "PROMOTED",
      researchRun: { agentConfigId: analystId },
    },
    select: { id: true, ticker: true },
  });
  for (const t of promotedTheses) {
    await prisma.thesis.update({
      where: { id: t.id },
      data: {
        status: "WATCHING",
        promotedAt: null,
      },
    });
    await writeThesisUpdate({
      thesisId: t.id,
      type: "STATUS_CHANGED",
      summary: `Thesis PROMOTED→WATCHING because the analyst was demoted to PAPER before this thesis re-entered live. Conviction preserved; the analyst will re-evaluate on its next paper run.`,
      rationale:
        "Demote-while-PROMOTED downgrade. Paper tenure + P&L + review count remain on the row for context.",
      fieldChanges: { status: { from: "PROMOTED", to: "WATCHING" } },
      runId: null,
    });
  }
  return promotedTheses.length;
}
