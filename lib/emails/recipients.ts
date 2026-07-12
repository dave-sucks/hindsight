/**
 * Account email recipient resolution — the single place that decides WHO
 * receives an account-scoped email. Every production send site (proposal-
 * pending, trade-opened, trade-closed, daily run digest) resolves its
 * recipient list here instead of calling getOwnerUserId() directly.
 *
 * The model: every AccountMembership row carries one boolean per email
 * category (emailTradeProposals / emailTradeActivity / emailDailyDigest),
 * default TRUE. So by default every member of an account — OWNER, EDITOR,
 * VIEWER — receives every category; a member opts out per-category on
 * /settings/team. An account with all members opted out of a category
 * legitimately sends nothing for it.
 *
 * The fallbackUserId escape hatch only applies when the account has NO
 * membership rows at all (broken signup / legacy data) — it preserves the
 * old `getOwnerUserId(accountId) ?? position.userId` behavior. It is NOT
 * used when members exist but have opted out.
 */

import { prisma } from "@/lib/prisma";
import { getUserEmail } from "@/lib/email";

export type AccountEmailKind =
  | "TRADE_PROPOSALS" // proposal-pending approval requests
  | "TRADE_ACTIVITY" // trade-opened + trade-closed alerts
  | "DAILY_DIGEST"; // morning run digest

const PREF_FIELD = {
  TRADE_PROPOSALS: "emailTradeProposals",
  TRADE_ACTIVITY: "emailTradeActivity",
  DAILY_DIGEST: "emailDailyDigest",
} as const satisfies Record<AccountEmailKind, string>;

export async function getEmailRecipients(
  accountId: string,
  kind: AccountEmailKind,
  opts: { fallbackUserId?: string } = {},
): Promise<string[]> {
  const memberships = await prisma.accountMembership.findMany({
    where: { accountId },
    select: {
      userId: true,
      emailTradeProposals: true,
      emailTradeActivity: true,
      emailDailyDigest: true,
    },
  });

  const userIds =
    memberships.length === 0
      ? opts.fallbackUserId
        ? [opts.fallbackUserId]
        : []
      : memberships.filter((m) => m[PREF_FIELD[kind]]).map((m) => m.userId);

  // Emails live in Supabase auth, not public.users — one admin lookup per
  // member. Teams are small (single digits) so N sequential-ish lookups
  // via Promise.all is fine.
  const emails = await Promise.all(userIds.map((id) => getUserEmail(id)));
  return [...new Set(emails.filter((e): e is string => !!e))];
}
