"use server";

/**
 * Protect gains — the owner's account setting (lib/agent/triggers/protect-gains.ts).
 * OWNER-only to change. It counts from when it is turned on: turning it on
 * starts every open position's high over, so nothing sells when it is saved.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";

export interface ProtectGainsSettings {
  on: boolean;
  startPct: number;
  giveBackPct: number;
  /** When it was last turned on (ISO). */
  since: string | null;
}

async function caller(): Promise<{ accountId: string; isOwner: boolean } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const accountId = await getAccountId(user.id);
  if (!accountId) return null;
  return { accountId, isOwner: (await getUserRole(user.id, accountId)) === "OWNER" };
}

const SELECT = { protectGainsOn: true, protectGainsStartPct: true, protectGainsGiveBackPct: true, protectGainsSince: true } as const;
const read = (a: { protectGainsOn: boolean; protectGainsStartPct: number; protectGainsGiveBackPct: number; protectGainsSince: Date | null }): ProtectGainsSettings => ({
  on: a.protectGainsOn,
  startPct: a.protectGainsStartPct,
  giveBackPct: a.protectGainsGiveBackPct,
  since: a.protectGainsSince?.toISOString() ?? null,
});

export async function getProtectGains(): Promise<{ settings: ProtectGainsSettings | null; canEdit: boolean }> {
  const who = await caller();
  if (!who) return { settings: null, canEdit: false };
  const a = await prisma.account.findUnique({ where: { id: who.accountId }, select: SELECT });
  return { settings: a ? read(a) : null, canEdit: who.isOwner };
}

export async function setProtectGains(input: { on: boolean; startPct: number; giveBackPct: number }): Promise<ProtectGainsSettings> {
  const who = await caller();
  if (!who?.isOwner) throw new Error("Only the account owner can change Protect gains");
  if (!Number.isFinite(input.startPct) || input.startPct <= 0 || input.startPct > 50) throw new Error("Start once up: a number above 0 and at most 50.");
  // Under 1% fires on noise the moment a high is set (the same bound as a trail).
  if (!Number.isFinite(input.giveBackPct) || input.giveBackPct < 1 || input.giveBackPct >= 50) throw new Error("Give back at most: a number from 1 to under 50.");
  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.account.findUniqueOrThrow({ where: { id: who.accountId }, select: SELECT });
    // Turned on: every open position's high starts over at its next fresh price.
    const turnedOn = input.on === true && !before.protectGainsOn;
    if (turnedOn) {
      await tx.position.updateMany({ where: { accountId: who.accountId, status: "OPEN" }, data: { protectHigh: null, protectHighAt: null } });
    }
    return tx.account.update({
      where: { id: who.accountId },
      data: {
        protectGainsOn: input.on === true,
        protectGainsStartPct: input.startPct,
        protectGainsGiveBackPct: input.giveBackPct,
        ...(turnedOn ? { protectGainsSince: new Date() } : {}),
      },
      select: SELECT,
    });
  });
  revalidatePath("/settings/triggers");
  return read(saved);
}
