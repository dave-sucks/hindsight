import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { getUserEmail } from "@/lib/email";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { TeamSettingsClient } from "@/components/settings/TeamSettingsClient";
import type {
  TeamMemberDTO,
  TeamInviteDTO,
} from "@/app/api/settings/team/route";

export default async function TeamSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/settings/profile");

  const role = await getUserRole(user.id, accountId);
  if (!role) redirect("/settings/profile");

  const [account, memberships, invites] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId },
      select: { name: true },
    }),
    prisma.accountMembership.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        emailTradeProposals: true,
        emailTradeActivity: true,
        emailDailyDigest: true,
      },
    }),
    prisma.accountInvite.findMany({
      where: { accountId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    }),
  ]);

  const members: TeamMemberDTO[] = await Promise.all(
    memberships.map(async (m) => ({
      userId: m.userId,
      email: await getUserEmail(m.userId),
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
      emailTradeProposals: m.emailTradeProposals,
      emailTradeActivity: m.emailTradeActivity,
      emailDailyDigest: m.emailDailyDigest,
    })),
  );

  const pendingInvites: TeamInviteDTO[] = invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role as "EDITOR" | "VIEWER",
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
  }));

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-8">
      <SettingsPageHeader
        title="Team"
        description={`People with access to ${account?.name ?? "this account"}.`}
      />
      <TeamSettingsClient
        accountId={accountId}
        accountName={account?.name ?? "My Account"}
        myUserId={user.id}
        myRole={role}
        initialMembers={members}
        initialInvites={pendingInvites}
      />
    </div>
  );
}
