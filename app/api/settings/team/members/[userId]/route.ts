import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";

// PATCH  /api/settings/team/members/[userId] — update a member's email
//        notification preferences. Members can update their own; OWNER
//        can update anyone's.
// DELETE /api/settings/team/members/[userId]
// OWNER-only. Removes the AccountMembership for the given userId on
// the caller's account. The user's Supabase identity is left intact —
// only their access to this account is revoked. OWNER cannot remove
// themselves.

const PREF_KEYS = [
  "emailTradeProposals",
  "emailTradeActivity",
  "emailDailyDigest",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: targetUserId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  if (targetUserId !== user.id) {
    const role = await getUserRole(user.id, accountId);
    if (role !== "OWNER") {
      return NextResponse.json(
        { error: "Only the account OWNER can change another member's notifications." },
        { status: 403 },
      );
    }
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const data: Partial<Record<(typeof PREF_KEYS)[number], boolean>> = {};
  for (const key of PREF_KEYS) {
    if (key in body) {
      if (typeof body[key] !== "boolean") {
        return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
      }
      data[key] = body[key];
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No preference fields provided" }, { status: 400 });
  }

  const membership = await prisma.accountMembership.findUnique({
    where: { accountId_userId: { accountId, userId: targetUserId } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const updated = await prisma.accountMembership.update({
    where: { id: membership.id },
    data,
    select: {
      userId: true,
      emailTradeProposals: true,
      emailTradeActivity: true,
      emailDailyDigest: true,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: targetUserId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role !== "OWNER") {
    return NextResponse.json(
      { error: "Only the account OWNER can remove members." },
      { status: 403 },
    );
  }

  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: "OWNER cannot remove themselves." },
      { status: 400 },
    );
  }

  const membership = await prisma.accountMembership.findUnique({
    where: { accountId_userId: { accountId, userId: targetUserId } },
    select: { id: true, role: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }
  if (membership.role === "OWNER") {
    return NextResponse.json(
      { error: "Another OWNER cannot be removed via this endpoint." },
      { status: 403 },
    );
  }

  await prisma.accountMembership.delete({ where: { id: membership.id } });
  return NextResponse.json({ removed: true });
}
