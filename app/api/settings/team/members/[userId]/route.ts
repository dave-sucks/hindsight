import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";

// DELETE /api/settings/team/members/[userId]
// OWNER-only. Removes the AccountMembership for the given userId on
// the caller's account. The user's Supabase identity is left intact —
// only their access to this account is revoked. OWNER cannot remove
// themselves.

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
