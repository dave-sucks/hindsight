"use server";

/**
 * Account-level settings — the OWNER-only switches that govern how the
 * account behaves. Currently just the two Trade-as-Proposal toggles
 * (require approval for agent-initiated buys / sells). Single chokepoint
 * so future settings (notification channel, default expiry window, etc.)
 * land in the same place.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md §6.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";

export interface AccountApprovalSettings {
  requireApprovalForBuys: boolean;
  requireApprovalForSells: boolean;
}

/**
 * Read the current approval toggles for the caller's account. Returns
 * defaults (both false) when no membership exists — never throws, so the
 * settings page can render even on partially-broken state.
 */
export async function getAccountApprovalSettings(): Promise<AccountApprovalSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { requireApprovalForBuys: false, requireApprovalForSells: false };

  const accountId = await getAccountId(user.id);
  if (!accountId) return { requireApprovalForBuys: false, requireApprovalForSells: false };

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { requireApprovalForBuys: true, requireApprovalForSells: true },
  });
  return {
    requireApprovalForBuys: account?.requireApprovalForBuys ?? false,
    requireApprovalForSells: account?.requireApprovalForSells ?? false,
  };
}

/**
 * Server action — update one of the two approval toggles. OWNER-only.
 * Returns the new state so the client can confirm + render. Throws on
 * unauthorized callers (no session, no membership, VIEWER/EDITOR role).
 *
 * The toggle takes effect on the next agent tool call — currently-in-flight
 * runs use whatever state they read at run-start. Mid-run consistency
 * isn't guaranteed (the next tool call after the flip routes through the
 * new branch); for paper-testing this is fine since runs are short.
 */
export async function setAccountApprovalToggle(input: {
  field: "requireApprovalForBuys" | "requireApprovalForSells";
  value: boolean;
}): Promise<AccountApprovalSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const accountId = await getAccountId(user.id);
  if (!accountId) throw new Error("No account");

  const role = await getUserRole(user.id, accountId);
  if (role !== "OWNER") {
    throw new Error("Only the account owner can change approval settings");
  }

  const updated = await prisma.account.update({
    where: { id: accountId },
    data: { [input.field]: input.value },
    select: { requireApprovalForBuys: true, requireApprovalForSells: true },
  });

  // Server-rendered surfaces that show the toggle state (the settings page
  // itself + any future banner) pick up the new value on next paint.
  revalidatePath("/settings");

  return {
    requireApprovalForBuys: updated.requireApprovalForBuys,
    requireApprovalForSells: updated.requireApprovalForSells,
  };
}
