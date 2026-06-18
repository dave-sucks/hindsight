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

export interface LatestDigest {
  id: string;
  /** Trading day the digest covers (ET), ISO string. */
  date: string;
  /** Markdown narrative with inline reference tokens. */
  narrative: string;
  /** Which LLM wrote it (or "fallback"), if recorded. */
  model: string | null;
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
    select: { id: true, date: true, narrative: true, model: true },
  });
  if (!row) return null;

  return {
    id: row.id,
    date: row.date.toISOString(),
    narrative: row.narrative,
    model: row.model,
  };
}
