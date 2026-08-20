import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { seedAccountTriggers } from '@/lib/agent/triggers/seed-account'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Upsert into public.users so Prisma queries work for OAuth users
      await prisma.user.upsert({
        where: { id: data.user.id },
        update: {},
        create: {
          id: data.user.id,
          email: data.user.email!,
          name: data.user.user_metadata?.full_name ?? data.user.email!,
        },
      })

      // Ensure the new user has an Account + OWNER membership. Skipped
      // for users that already belong to an account (invited members
      // attach to the inviter's account via the invite-accept flow, not
      // here; this guard prevents the OAuth callback from minting a
      // spare OWNER account for them after acceptance).
      // Also skipped when a pending AccountInvite matches the user's email
      // — otherwise the auto-OWNER membership wins the getAccountId tiebreak
      // and the invitee never sees the inviter's data.
      const email = (data.user.email ?? '').toLowerCase()
      const [existingMembership, pendingInvite] = await Promise.all([
        prisma.accountMembership.findFirst({
          where: { userId: data.user.id },
          select: { id: true },
        }),
        email
          ? prisma.accountInvite.findFirst({
              where: {
                email,
                acceptedAt: null,
                expiresAt: { gt: new Date() },
              },
              select: { id: true },
            })
          : Promise.resolve(null),
      ])
      if (!existingMembership && !pendingInvite) {
        const account = await prisma.account.create({
          data: { name: data.user.email ?? "My Account" },
        })
        await prisma.accountMembership.create({
          data: { accountId: account.id, userId: data.user.id, role: "OWNER" },
        })
        // Standing trigger rules start as DATA on the account, not code
        // constants — see lib/agent/triggers/seed-account.
        await seedAccountTriggers(account.id)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/sign-in`)
}
