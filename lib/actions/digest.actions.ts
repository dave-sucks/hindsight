"use server";

/**
 * digest.actions.ts — read-only access to the Daily Portfolio Digest
 * (Feature A; see docs/plans/PORTFOLIO_DIGEST.md).
 *
 * The digest is written after close by the `portfolio-digest` Inngest cron,
 * one row per (accountId, environment, date) in the PortfolioDigest table. This
 * action surfaces the most-recent row for the current user's account + the
 * requested book (PAPER vs LIVE) so the homepage renders the right narrative.
 * It is strictly read-only.
 */

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";
import { latestMarketDigest } from "@/lib/agent/market-reviewer/latest";

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
  /** The run that wrote it (the Market Reviewer's; the Portfolio Digest has none). */
  runId?: string | null;
  /** The market brief, the Market tab's teaser (the Market Reviewer's; the Portfolio Digest has none). */
  brief?: string | null;
  /** The market numbers, printed by code above the Market tab's digest (the Market Reviewer's; the Portfolio Digest has none). */
  numbers?: string[];
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const accountId = await getAccountId(user.id);
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
 * The most-recent Market Digest for the current user's account and book,
 * written at 7:30 AM ET by the Market Reviewer. Null when there is no signed-in
 * user, no account, or none has been written for that book yet.
 */
export async function getLatestMarketDigest(
  environment: AlpacaEnvironment = "PAPER",
): Promise<LatestDigest | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const accountId = await getAccountId(user.id);
  if (!accountId) return null;

  return latestMarketDigest(accountId, environment);
}
