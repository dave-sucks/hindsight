import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { getUserEmail } from "@/lib/email";

// GET /api/settings/team — list members + pending invites for the
// caller's account. Returned shape feeds /settings/team.

export interface TeamMemberDTO {
  userId: string;
  email: string | null;
  role: "OWNER" | "EDITOR" | "VIEWER";
  joinedAt: string;
}

export interface TeamInviteDTO {
  id: string;
  email: string;
  role: "EDITOR" | "VIEWER";
  createdAt: string;
  expiresAt: string;
}

export interface TeamSettingsData {
  accountId: string;
  accountName: string;
  myRole: "OWNER" | "EDITOR" | "VIEWER";
  members: TeamMemberDTO[];
  pendingInvites: TeamInviteDTO[];
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [account, memberships, invites] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId },
      select: { name: true },
    }),
    prisma.accountMembership.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: { userId: true, role: true, createdAt: true },
    }),
    prisma.accountInvite.findMany({
      where: { accountId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    }),
  ]);

  // Resolve emails — auth lives in Supabase, not in `public.users`.
  const members: TeamMemberDTO[] = await Promise.all(
    memberships.map(async (m) => ({
      userId: m.userId,
      email: await getUserEmail(m.userId),
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    })),
  );

  const data: TeamSettingsData = {
    accountId,
    accountName: account?.name ?? "My Account",
    myRole: role,
    members,
    pendingInvites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role as "EDITOR" | "VIEWER",
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
    })),
  };

  return NextResponse.json(data);
}
