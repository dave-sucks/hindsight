"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccount } from "@/lib/alpaca";
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
};

/**
 * Read-only snapshot for the Promote/Demote dialogs: shows the analyst's
 * current env, whether live creds are usable, and what positions would
 * need closing on either side of the flip.
 */
export async function getPromotionPreview(
  analystId: string,
): Promise<PromotionPreview | { error: string }> {
  const userId = await getServerUserId();
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
    select: {
      id: true,
      name: true,
      tradingEnvironment: true,
      realMaxPosition: true,
    },
  });
  if (!analyst) return { error: "Analyst not found" };

  const [openPaper, openLive, liveKey] = await Promise.all([
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
  ]);

  return {
    analystId: analyst.id,
    analystName: analyst.name,
    currentEnvironment: (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER",
    liveCredsVerified: liveKey?.verified ?? false,
    realMaxPosition: analyst.realMaxPosition,
    openPaperPositions: openPaper,
    openLivePositions: openLive,
  };
}

export type PromotionResult =
  | { ok: true; closed: number }
  | { ok: false; error: string; failedSymbol?: string; closedBeforeFailure: number };

/**
 * Promote PAPER → LIVE. Force-closes every open paper position via the
 * paper Alpaca account (closeOpenPosition uses position.environment to
 * pick the right creds), marks each with closeReason="PROMOTED", then
 * flips AgentConfig.tradingEnvironment to LIVE. Theses stay ACTIVE in
 * the library — the agent's first live run re-evaluates each one at
 * current prices. See docs/PROD_DEPLOYMENT_PLAN.md.
 *
 * If any paper close fails mid-flight, the function aborts BEFORE the
 * env flip. Positions already closed stay closed; the dialog should
 * surface the failed symbol so the user can clean up and retry.
 */
export async function promoteAnalystToLive(
  analystId: string,
  options?: { realMaxPosition?: number },
): Promise<PromotionResult> {
  const userId = await getServerUserId();
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
    select: { id: true, name: true, tradingEnvironment: true },
  });
  if (!analyst) return { ok: false, error: "Analyst not found", closedBeforeFailure: 0 };
  if (analyst.tradingEnvironment === "LIVE") {
    return { ok: false, error: "Analyst is already live", closedBeforeFailure: 0 };
  }

  // 1. Validate live creds are reachable BEFORE we start closing paper positions.
  // A promotion that closes paper but can't trade live leaves the analyst stuck.
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

  // 2. Close every open paper position. closeOpenPosition reads
  // position.environment to resolve the matching (paper) creds.
  // After each close, write a ThesisUpdate audit row on the linked
  // ACTIVE thesis so the analyst's first live run can see "this name
  // was just exited at $X via promotion — re-enter by default unless
  // thesis target already approached or new evidence against." Stage 2
  // of the system prompt reads this signal (see lib/agent/system-prompt.ts).
  const openPaper = await prisma.position.findMany({
    where: { analystId, status: "OPEN", environment: "PAPER" },
    select: { id: true, symbol: true },
  });

  let closed = 0;
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
      await prisma.position.update({
        where: { id: pos.id },
        data: { closeReason: "PROMOTED" },
      });

      // Audit row on the linked ACTIVE thesis (if any). Best-effort —
      // failure to write the audit row should NOT roll back the close,
      // which is already done in Alpaca and persisted in the DB. Worst
      // case: the agent's re-entry default falls back to "evaluate
      // fresh" instead of "default re-buy".
      try {
        const activeThesis = await prisma.thesis.findFirst({
          where: {
            ticker: pos.symbol,
            status: "ACTIVE",
            direction: { not: "PASS" },
            researchRun: { agentConfigId: analystId },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (activeThesis) {
          const pnlSign = closeResult.realizedPnl >= 0 ? "+" : "";
          const fillNote = closeResult.fillStatus === "PENDING" ? " (close pending fill)" : "";
          await writeThesisUpdate({
            thesisId: activeThesis.id,
            type: "UPDATED",
            summary: `Paper position closed at $${closeResult.closePrice.toFixed(2)} during promotion to LIVE (P&L ${pnlSign}$${closeResult.realizedPnl.toFixed(2)})${fillNote}. Thesis preserved — re-enter by default on next live run unless target already approached or new evidence against.`,
            rationale:
              `Administrative close, not a thesis decision. The analyst was holding this name; promotion required flattening paper before flipping to LIVE.`,
            runId: null,
            priceAtTime: closeResult.closePrice,
          });
        }
      } catch (auditErr) {
        console.warn(
          `[promote] thesis audit row failed for ${pos.symbol}:`,
          auditErr instanceof Error ? auditErr.message : auditErr,
        );
      }

      closed++;
    } catch (err) {
      return {
        ok: false,
        error: `Failed to close paper position in ${pos.symbol}: ${err instanceof Error ? err.message : String(err)}`,
        failedSymbol: pos.symbol,
        closedBeforeFailure: closed,
      };
    }
  }

  // 3. Flip the env flag. Optionally update the live cap in the same write.
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
  return { ok: true, closed };
}

export type DemotionResult =
  | { ok: true }
  | { ok: false; error: string; openLiveCount: number };

/**
 * Demote LIVE → PAPER. Requires every open live position to be closed
 * first — the dialog surfaces the list and offers a "close all and
 * demote" path that calls closeAllLivePositionsAndDemote.
 */
export async function demoteAnalystToPaper(
  analystId: string,
): Promise<DemotionResult> {
  const userId = await getServerUserId();
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
    select: { id: true, tradingEnvironment: true },
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

  await prisma.agentConfig.update({
    where: { id: analystId },
    data: { tradingEnvironment: "PAPER" },
  });

  revalidatePath(`/analysts/${analystId}`);
  revalidatePath("/analysts");
  return { ok: true };
}

/**
 * "Close all and demote" — used by the demote dialog when the user
 * accepts that every live position will be flattened at market.
 */
export async function closeAllLivePositionsAndDemote(
  analystId: string,
): Promise<PromotionResult> {
  const userId = await getServerUserId();
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
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

  await prisma.agentConfig.update({
    where: { id: analystId },
    data: { tradingEnvironment: "PAPER" },
  });

  revalidatePath(`/analysts/${analystId}`);
  revalidatePath("/analysts");
  revalidatePath("/");
  return { ok: true, closed };
}
