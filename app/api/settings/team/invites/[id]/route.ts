import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";

// DELETE /api/settings/team/invites/[id]
// OWNER-only. Revokes a pending invite (hard delete is fine — we don't
// need an audit trail here since the email it was sent to is already
// stored on the row before deletion, and the row itself never reached
// the "active membership" state).

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: inviteId } = await params;

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
      { error: "Only the account OWNER can revoke invites." },
      { status: 403 },
    );
  }

  const invite = await prisma.accountInvite.findFirst({
    where: { id: inviteId, accountId },
    select: { id: true },
  });
  if (!invite) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  await prisma.accountInvite.delete({ where: { id: invite.id } });
  return NextResponse.json({ revoked: true });
}
