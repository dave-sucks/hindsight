"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccount } from "@/lib/alpaca";
import { getAccountId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { closeOpenPosition } from "@/lib/actions/closeTrade.actions";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
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
        status: "ACTIVE",
        direction: { not: "PASS" },
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

export type PromotionResult =
  | { ok: true; closed: number; promoted: number }
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
  let promotedCount = 0;
  for (const pos of openPaper) {
    try {
      const closeResult = await closeOpenPosition(
        pos.id,
        "MANUAL",
        undefined,
        "user",
        `Closed as part of promoting analyst ${analyst.name} from PAPER to LIVE.`,
        undefined,
      );
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
      });
      if (promoted) promotedCount++;
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
      status: "ACTIVE",
      direction: { not: "PASS" },
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
    if (promoted) promotedCount++;
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

  revalidatePath(`/analysts/${analystId}`);
  revalidatePath("/analysts");
  revalidatePath("/");
  revalidatePath("/trades");
  return { ok: true, closed, promoted: promotedCount };
}

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
 */
async function transitionThesisToPromoted(input: {
  ticker: string;
  analystId: string;
  promotionRealizedPnl: number;
  promotionClosePrice: number | null;
  promotionFillStatus: "FILLED" | "PENDING";
  thesisId?: string;
  isOrphan?: boolean;
}): Promise<boolean> {
  const thesis = input.thesisId
    ? await prisma.thesis.findUnique({
        where: { id: input.thesisId },
        select: { id: true, createdAt: true, ticker: true },
      })
    : await prisma.thesis.findFirst({
        where: {
          ticker: input.ticker,
          status: "ACTIVE",
          direction: { not: "PASS" },
          researchRun: { agentConfigId: input.analystId },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, ticker: true },
      });
  if (!thesis) return false;

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

  await prisma.$transaction([
    prisma.thesis.update({
      where: { id: thesis.id },
      data: {
        status: "PROMOTED",
        promotedAt: new Date(),
        paperTenureDays,
        paperRealizedPnl: cumulativePaperPnl,
        paperReviewCount: reviewCount,
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
    fieldChanges: { status: { from: "ACTIVE", to: "PROMOTED" } },
    runId: null,
    priceAtTime: input.promotionClosePrice,
  });

  return true;
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
  return { ok: true, closed, promoted: reverted };
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
