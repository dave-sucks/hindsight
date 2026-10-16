"use server";

/**
 * Protect gains — the owner's account setting (lib/agent/triggers/protect-gains.ts).
 * OWNER-only to change. Turning it on, or changing how the high is counted,
 * starts every open position's high over: the next trigger check takes the
 * tracked high since the buy ("BUY") or the price then ("NOW").
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { nextProtectHigh, protectBreached, protectLine } from "@/lib/agent/triggers/protect-gains";

export interface ProtectGainsSettings {
  on: boolean;
  startPct: number;
  giveBackPct: number;
  from: "NOW" | "BUY";
  /** When it was last turned on or recounted (ISO). */
  since: string | null;
}

/** A holding that would sell at once, counted from its buy at today's price. */
export interface ImmediateSale {
  ticker: string;
  shares: number;
  price: number;
  line: number;
  buyPrice: number;
  /** Dollars the sale would realize against the buy price. */
  result: number;
}

async function owner(): Promise<{ accountId: string; isOwner: boolean } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const accountId = await getAccountId(user.id);
  if (!accountId) return null;
  return { accountId, isOwner: (await getUserRole(user.id, accountId)) === "OWNER" };
}

const read = (a: { protectGainsOn: boolean; protectGainsStartPct: number; protectGainsGiveBackPct: number; protectGainsFrom: string; protectGainsSince: Date | null }): ProtectGainsSettings => ({
  on: a.protectGainsOn,
  startPct: a.protectGainsStartPct,
  giveBackPct: a.protectGainsGiveBackPct,
  from: a.protectGainsFrom === "BUY" ? "BUY" : "NOW",
  since: a.protectGainsSince?.toISOString() ?? null,
});
const SELECT = { protectGainsOn: true, protectGainsStartPct: true, protectGainsGiveBackPct: true, protectGainsFrom: true, protectGainsSince: true } as const;

export async function getProtectGains(): Promise<{ settings: ProtectGainsSettings | null; canEdit: boolean }> {
  const who = await owner();
  if (!who) return { settings: null, canEdit: false };
  const a = await prisma.account.findUnique({ where: { id: who.accountId }, select: SELECT });
  return { settings: a ? read(a) : null, canEdit: who.isOwner };
}

function check(n: { startPct: number; giveBackPct: number }) {
  if (!Number.isFinite(n.startPct) || n.startPct <= 0 || n.startPct > 50) throw new Error("Start once up: a number above 0 and at most 50.");
  // Under 1% fires on noise the moment a high is set (the same bound as a trail).
  if (!Number.isFinite(n.giveBackPct) || n.giveBackPct < 1 || n.giveBackPct >= 50) throw new Error("Give back at most: a number from 1 to under 50.");
}

/** Every open holding that would sell at once if the high were counted from its buy, at today's price. */
export async function previewProtectGains(input: { startPct: number; giveBackPct: number }): Promise<ImmediateSale[]> {
  const who = await owner();
  if (!who?.isOwner) throw new Error("Only the account owner can change Protect gains");
  check(input);
  const rule = { ...input, from: "BUY" as const };
  const open = await prisma.position.findMany({
    where: { accountId: who.accountId, status: "OPEN" },
    select: { symbol: true, direction: true, quantity: true, avgCost: true, peakPrice: true },
    orderBy: { symbol: "asc" },
  });
  const quotes = await getLiveQuotes(open.map((p) => p.symbol), { caller: "other" });
  const out: ImmediateSale[] = [];
  for (const p of open) {
    const price = quotes[p.symbol.toUpperCase()]?.quote?.c;
    if (price == null) continue;
    const isLong = p.direction !== "SHORT";
    const high = nextProtectHigh({ protectHigh: null, peakPrice: p.peakPrice, isLong }, price, true, rule);
    const line = protectLine({ avgCost: p.avgCost, isLong }, high, rule);
    if (line == null || !protectBreached(price, line, isLong)) continue;
    out.push({ ticker: p.symbol, shares: p.quantity, price, line, buyPrice: p.avgCost, result: (isLong ? price - p.avgCost : p.avgCost - price) * p.quantity });
  }
  return out;
}

export async function setProtectGains(input: { on: boolean; startPct: number; giveBackPct: number; from: "NOW" | "BUY" }): Promise<ProtectGainsSettings> {
  const who = await owner();
  if (!who?.isOwner) throw new Error("Only the account owner can change Protect gains");
  check(input);
  const from = input.from === "BUY" ? "BUY" : "NOW";
  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.account.findUniqueOrThrow({ where: { id: who.accountId }, select: SELECT });
    // Turned on, or counted another way: every open position's high starts over.
    const recount = input.on === true && (!before.protectGainsOn || before.protectGainsFrom !== from);
    if (recount) {
      await tx.position.updateMany({ where: { accountId: who.accountId, status: "OPEN" }, data: { protectHigh: null, protectHighAt: null } });
    }
    return tx.account.update({
      where: { id: who.accountId },
      data: {
        protectGainsOn: input.on === true,
        protectGainsStartPct: input.startPct,
        protectGainsGiveBackPct: input.giveBackPct,
        protectGainsFrom: from,
        ...(recount ? { protectGainsSince: new Date() } : {}),
      },
      select: SELECT,
    });
  });
  revalidatePath("/settings/triggers");
  return read(saved);
}
