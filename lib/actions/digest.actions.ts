"use server";

/**
 * digest.actions.ts — read-only access to the two digests the homepage card
 * shows (Feature A; see docs/plans/PORTFOLIO_DIGEST.md).
 *
 * The Daily Portfolio Digest is written after close by the `portfolio-digest`
 * Inngest cron, one row per (accountId, environment, date) in the
 * PortfolioDigest table. The market digest is written at 7:30 AM ET by the
 * Market Reviewer, one row per book per day in MarketDigest. Each action
 * surfaces the most-recent row for the current user's account + the requested
 * book (PAPER vs LIVE). Strictly read-only.
 */

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

export interface LatestDigest {
  id: string;
  /** Trading day the digest covers (ET), ISO string. */
  date: string;
  /** Markdown narrative with inline reference tokens. */
  narrative: string;
  /** Which LLM wrote it (or "fallback"), if recorded. */
  model: string | null;
  /** When it was written, ISO string. */
  createdAt: string;
}

/** The signed-in user's account, or null with no user or no account. */
async function currentAccountId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getAccountId(user.id);
}

/**
 * Returns the most-recent PortfolioDigest for the current user's account and the
 * requested book (`environment`), ordered by trading date desc. Returns null
 * when there is no signed-in user, no account, or no digest has been generated
 * yet for that environment.
 *
 * PAPER and LIVE share one accountId; environment is the discriminator (same as
 * Position/ResearchRun). Filtering by it is what keeps a PAPER digest from
 * rendering under the LIVE book.
 */
export async function getLatestDigest(
  environment: AlpacaEnvironment = "PAPER",
): Promise<LatestDigest | null> {
  const accountId = await currentAccountId();
  if (!accountId) return null;

  const row = await prisma.portfolioDigest.findFirst({
    where: { accountId, environment },
    orderBy: { date: "desc" },
    select: { id: true, date: true, narrative: true, model: true, createdAt: true },
  });
  if (!row) return null;

  return {
    id: row.id,
    date: row.date.toISOString(),
    narrative: row.narrative,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Returns the most-recent MarketDigest for the current user's account and the
 * requested book, ordered by date desc, in the same shape as the portfolio
 * digest (`narrative` is the row's `digest`). Null when there is no signed-in
 * user, no account, or no market digest yet for that book.
 */
export async function getLatestMarketDigest(
  environment: AlpacaEnvironment = "PAPER",
): Promise<LatestDigest | null> {
  const accountId = await currentAccountId();
  if (!accountId) return null;

  const row = await prisma.marketDigest.findFirst({
    where: { accountId, environment },
    orderBy: { date: "desc" },
    select: { id: true, date: true, digest: true, model: true, createdAt: true },
  });
  if (!row) return null;

  return {
    id: row.id,
    date: row.date.toISOString(),
    narrative: row.digest,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}
