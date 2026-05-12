import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { sendEmail, getUserEmail } from "@/lib/email";
import { teamInviteHtml } from "@/lib/emails/team-invite";

// POST /api/settings/team/invite
// OWNER-only. Body: { email, role: "EDITOR" | "VIEWER" }.
// Creates an AccountInvite row + dispatches a team-invite email.

const bodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["EDITOR", "VIEWER"]),
});

const INVITE_TTL_DAYS = 7;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Only the account OWNER can invite members." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  // Reject if the email already corresponds to an existing membership.
  // We check by resolving the Supabase user for the email, then looking
  // up memberships. If Supabase has no such user we let it through —
  // they'll be created on accept.
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existingUser) {
    const dup = await prisma.accountMembership.findUnique({
      where: { accountId_userId: { accountId, userId: existingUser.id } },
      select: { id: true },
    });
    if (dup) {
      return NextResponse.json(
        { error: "That email is already a member of this account." },
        { status: 409 },
      );
    }
  }

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.accountInvite.create({
    data: {
      accountId,
      email: normalizedEmail,
      role: parsed.data.role,
      expiresAt,
    },
  });

  // Send the invite email (best-effort).
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });
  const ownerEmail = await getUserEmail(user.id);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    "https://hindsight-stocks.vercel.app";
  const acceptUrl = `${appUrl.startsWith("http") ? appUrl : `https://${appUrl}`}/api/settings/team/accept?token=${invite.token}`;

  await sendEmail({
    to: normalizedEmail,
    subject: "You've been invited to Hindsight",
    html: teamInviteHtml({
      accountName: account?.name ?? "Hindsight",
      inviterEmail: ownerEmail ?? "your team owner",
      role: parsed.data.role,
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
  });

  return NextResponse.json({ id: invite.id, email: invite.email, role: invite.role });
}
