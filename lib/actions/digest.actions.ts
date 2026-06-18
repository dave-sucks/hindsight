"use server";

/**
 * digest.actions.ts — read-only access to the Daily Portfolio Digest
 * (Feature A; see docs/plans/PORTFOLIO_DIGEST.md).
 *
 * The digest is written after close by the `portfolio-digest` Inngest cron,
 * one row per (accountId, date) in the PortfolioDigest table. This action
 * surfaces the most-recent row for the current user's account so the homepage
 * can render the narrative. It is strictly read-only.
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
 * Returns the most-recent PortfolioDigest for the current user's account,
 * ordered by trading date desc. Returns null when there is no signed-in user,
 * no account, or no digest has been generated yet.
 *
 * `environment` is accepted for call-site symmetry with the rest of the
 * portfolio surface and to keep room for an environment-scoped digest later;
 * the PortfolioDigest row is currently keyed on (accountId, date) only, so it
 * does not change the query today.
 */
export async function getLatestDigest(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _environment: AlpacaEnvironment = "PAPER",
): Promise<LatestDigest | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const accountId = await getAccountId(user.id);
  if (!accountId) return null;

  const row = await prisma.portfolioDigest.findFirst({
    where: { accountId },
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
