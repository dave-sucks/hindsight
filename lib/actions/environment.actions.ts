"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";
import { getAccountId, getOwnerUserId } from "@/lib/auth/account";

const COOKIE_NAME = "hindsight.environment";

/**
 * Read the user's currently-selected environment from the cookie.
 * Defaults to PAPER. Server components call this once per request.
 *
 * The cookie is the only source of truth — there is no per-page
 * searchParam override. Switching env from any page applies globally
 * via setCurrentEnvironment().
 */
export async function getCurrentEnvironment(): Promise<AlpacaEnvironment> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  return raw === "LIVE" ? "LIVE" : "PAPER";
}

/**
 * Whether the LIVE tab should appear in switcher UI. We only show it
 * once the user has either (a) a verified live Alpaca key, or (b) any
 * live position. Hides the affordance for the still-paper-only case.
 */
export async function shouldExposeLiveEnv(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const accountId = await getAccountId(user.id);
  if (!accountId) return false;
  const ownerUserId = await getOwnerUserId(accountId);

  const [liveKey, livePosition, liveAnalyst] = await Promise.all([
    ownerUserId
      ? prisma.userApiKey.findUnique({
          where: {
            userId_provider_environment: {
              userId: ownerUserId,
              provider: "ALPACA",
              environment: "LIVE",
            },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.position.findFirst({
      where: { accountId, environment: "LIVE" },
      select: { id: true },
    }),
    prisma.agentConfig.findFirst({
      where: { accountId, tradingEnvironment: "LIVE" },
      select: { id: true },
    }),
  ]);
  return !!(liveKey || livePosition || liveAnalyst);
}

/**
 * Set the cookie and revalidate every env-scoped path.
 * Returns the new env so the client can update local UI immediately.
 */
export async function setCurrentEnvironment(
  environment: AlpacaEnvironment,
): Promise<{ environment: AlpacaEnvironment }> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, environment, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/");
  revalidatePath("/trades");
  revalidatePath("/runs");
  revalidatePath("/performance");
  revalidatePath("/analysts");
  return { environment };
}
