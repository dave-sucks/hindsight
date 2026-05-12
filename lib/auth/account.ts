import { prisma } from "@/lib/prisma";
import type { MemberRole } from "@/lib/generated/prisma/enums";

/**
 * Returns the accountId the current user should operate against.
 *
 * Preference order: OWNER membership (the user's own account) → any
 * other membership (EDITOR or VIEWER on an account they were invited
 * to). If a user belongs to multiple accounts in the future, an
 * "active account" cookie will pick the winner; for now we deterministically
 * return the first OWNER, otherwise the first membership.
 *
 * Returns null only for users that somehow have no membership at all —
 * indicates a broken signup flow.
 */
export async function getAccountId(userId: string): Promise<string | null> {
  const owner = await prisma.accountMembership.findFirst({
    where: { userId, role: "OWNER" },
    select: { accountId: true },
  });
  if (owner) return owner.accountId;

  const member = await prisma.accountMembership.findFirst({
    where: { userId },
    select: { accountId: true },
  });
  return member?.accountId ?? null;
}

/**
 * Returns the role the given user holds on the given account.
 * Write routes use this to gate EDITOR-only and OWNER-only actions.
 */
export async function getUserRole(
  userId: string,
  accountId: string,
): Promise<MemberRole | null> {
  const m = await prisma.accountMembership.findUnique({
    where: { accountId_userId: { accountId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

/**
 * Resolves an account's OWNER userId. Used by Inngest crons that need
 * to pick an email to send the daily digest to, or an Alpaca credential
 * to authenticate trades against.
 */
export async function getOwnerUserId(accountId: string): Promise<string | null> {
  const m = await prisma.accountMembership.findFirst({
    where: { accountId, role: "OWNER" },
    select: { userId: true },
  });
  return m?.userId ?? null;
}

export type { MemberRole };
