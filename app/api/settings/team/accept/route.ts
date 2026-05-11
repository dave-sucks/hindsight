import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

// GET /api/settings/team/accept?token=xxx
//
// 1. Resolves AccountInvite by token. Rejects expired or already-accepted.
// 2. If a signed-in Supabase user matches invite.email, create the
//    AccountMembership immediately and redirect home.
// 3. If signed-in user mismatches, redirect to /sign-in with the email
//    pre-filled — they need to switch accounts.
// 4. If no session, redirect to /sign-in with email + a return-to
//    parameter that brings them back to this endpoint after auth.

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const origin = req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing-token`);
  }

  const invite = await prisma.accountInvite.findUnique({
    where: { token },
  });
  if (!invite) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`);
  }
  if (invite.acceptedAt) {
    return NextResponse.redirect(`${origin}/sign-in?error=invite-used`);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(`${origin}/sign-in?error=invite-expired`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No active session — bounce through sign-in. We pass the token back
  // via `next` so the callback returns here once auth completes.
  if (!user) {
    const next = encodeURIComponent(`/api/settings/team/accept?token=${token}`);
    return NextResponse.redirect(
      `${origin}/sign-in?email=${encodeURIComponent(invite.email)}&next=${next}`,
    );
  }

  // Signed-in user must match the invitee email. Mismatched logins are
  // a common pattern — the invitee is signed into a personal account
  // already. Direct them to switch.
  const userEmail = (user.email ?? "").toLowerCase();
  if (userEmail !== invite.email.toLowerCase()) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=email-mismatch&expected=${encodeURIComponent(invite.email)}`,
    );
  }

  // Ensure a User row exists for Prisma joins.
  await prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      email: user.email!,
      name: user.user_metadata?.full_name ?? user.email!,
    },
  });

  // Create the membership (idempotent — re-clicking a still-pending
  // invite shouldn't fail).
  await prisma.accountMembership.upsert({
    where: { accountId_userId: { accountId: invite.accountId, userId: user.id } },
    update: { role: invite.role },
    create: {
      accountId: invite.accountId,
      userId: user.id,
      role: invite.role,
    },
  });

  await prisma.accountInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });

  return NextResponse.redirect(`${origin}/?invite=accepted`);
}
