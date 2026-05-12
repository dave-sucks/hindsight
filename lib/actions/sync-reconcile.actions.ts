"use server";

// Manual reconciliation actions for the Health panel. Detection lives in
// sync-heartbeat.ts; this file is the click-to-fix side.

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId, getOwnerUserId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import {
  closePosition,
  getAllPositions,
  getLatestPrice,
  type AlpacaCredentials,
} from "@/lib/alpaca";
import { revalidatePath } from "next/cache";
import {
  computeSyncDiff,
  writeSnapshot,
  type SyncDiff,
} from "@/lib/inngest/functions/sync-heartbeat";

export type { SyncDiff } from "@/lib/inngest/functions/sync-heartbeat";

const QTY_TOLERANCE = 0.0001;

async function resolveOwner(): Promise<{
  userId: string;
  accountId: string;
  creds: AlpacaCredentials;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const accountId = await getAccountId(user.id);
  if (!accountId) throw new Error("No account membership");
  const ownerUserId = (await getOwnerUserId(accountId)) ?? user.id;
  const creds = await resolveAlpacaCredentials(ownerUserId);
  if (!creds) throw new Error("No Alpaca credentials on account");
  return { userId: ownerUserId, accountId, creds };
}

export async function getSyncDiff(): Promise<SyncDiff> {
  const { userId, creds } = await resolveOwner();
  return computeSyncDiff(userId, creds);
}

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

async function refreshSnapshot(): Promise<void> {
  try {
    const { userId, creds } = await resolveOwner();
    const diff = await computeSyncDiff(userId, creds);
    await writeSnapshot(userId, diff, "manual-reconcile");
  } catch {
    /* best-effort; the hourly cron will catch up */
  }
  revalidatePath("/intelligence");
  revalidatePath("/trades");
}

export async function liquidateOrphan(symbol: string): Promise<Result> {
  try {
    const { creds } = await resolveOwner();
    await closePosition(symbol, creds);
    console.warn(`[sync-reconcile] liquidated orphan ${symbol}`);
    await refreshSnapshot();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeStaleDbRow(positionId: string): Promise<Result> {
  try {
    const { accountId, creds } = await resolveOwner();
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: {
        id: true, accountId: true, symbol: true, direction: true,
        quantity: true, avgCost: true, status: true,
      },
    });
    if (!position) return { ok: false, error: "Position not found" };
    if (position.accountId !== accountId)
      return { ok: false, error: "Position belongs to a different account" };
    if (position.status !== "OPEN")
      return { ok: false, error: `Position is ${position.status}, not OPEN` };

    const closePrice = await getLatestPrice(position.symbol, creds).catch(
      () => position.avgCost,
    );
    const realizedPnl =
      position.direction === "LONG"
        ? (closePrice - position.avgCost) * position.quantity
        : (position.avgCost - closePrice) * position.quantity;
    const cost = position.avgCost * position.quantity;
    const outcome: "WIN" | "LOSS" | "BREAKEVEN" =
      realizedPnl > 0.01 * cost ? "WIN"
      : realizedPnl < -0.01 * cost ? "LOSS"
      : "BREAKEVEN";

    await prisma.$transaction([
      prisma.position.update({
        where: { id: position.id },
        data: {
          status: "CLOSED", closePrice, closeReason: "MANUAL",
          closeSource: "reconcile", realizedPnl, outcome, closedAt: new Date(),
        },
      }),
      prisma.positionEvent.create({
        data: {
          positionId: position.id,
          eventType: "CLOSED",
          description: `Reconciled: DB was OPEN but Alpaca had no position. Closed at $${closePrice.toFixed(2)} (P&L $${realizedPnl.toFixed(2)}).`,
          priceAt: closePrice,
          pnlAt: realizedPnl,
        },
      }),
    ]);
    await refreshSnapshot();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Snap DB qty to Alpaca's qty. Shrinking realizes a synthetic close on the
// missing shares against avgCost; padding bumps qty with no P&L impact.
// Picks the largest existing DB row to absorb the delta.
export async function trustAlpacaQty(symbol: string): Promise<Result<{ delta: number }>> {
  try {
    const { accountId, creds } = await resolveOwner();
    const alpacaPositions = await getAllPositions(creds);
    const alpacaPos = alpacaPositions.find(
      (p) => p.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    if (!alpacaPos) return { ok: false, error: `Alpaca has no position in ${symbol}` };

    const direction = alpacaPos.side.toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    const alpacaQty = parseFloat(alpacaPos.qty);
    const alpacaPrice = parseFloat(alpacaPos.current_price ?? alpacaPos.avg_entry_price);

    const dbRows = await prisma.position.findMany({
      where: { accountId, symbol: symbol.toUpperCase(), direction, status: "OPEN" },
      orderBy: { quantity: "desc" },
      select: { id: true, quantity: true, avgCost: true },
    });
    if (dbRows.length === 0) return { ok: false, error: `No OPEN DB row for ${symbol}` };
    const dbSum = dbRows.reduce((n, r) => n + r.quantity, 0);
    const delta = alpacaQty - dbSum;
    if (Math.abs(delta) <= QTY_TOLERANCE)
      return { ok: false, error: "Already in sync" };

    const target = dbRows[0];
    const newQty = Math.max(0, target.quantity + delta);

    if (delta < 0) {
      const missing = -delta;
      const partialPnl =
        direction === "LONG"
          ? (alpacaPrice - target.avgCost) * missing
          : (target.avgCost - alpacaPrice) * missing;
      await prisma.$transaction([
        prisma.position.update({ where: { id: target.id }, data: { quantity: newQty } }),
        prisma.positionEvent.create({
          data: {
            positionId: target.id,
            eventType: "PARTIAL_CLOSE",
            description: `Reconciled: DB qty ${target.quantity} → ${newQty} to match Alpaca (${alpacaQty}). Synthetic close on ${missing} sh @ $${alpacaPrice.toFixed(2)} (P&L $${partialPnl.toFixed(2)}).`,
            priceAt: alpacaPrice,
            pnlAt: partialPnl,
          },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.position.update({ where: { id: target.id }, data: { quantity: newQty } }),
        prisma.positionEvent.create({
          data: {
            positionId: target.id,
            eventType: "MODIFIED",
            description: `Reconciled: DB qty ${target.quantity} → ${newQty} to match Alpaca (${alpacaQty}). Padded by ${delta} sh.`,
            priceAt: alpacaPrice,
          },
        }),
      ]);
    }
    await refreshSnapshot();
    return { ok: true, data: { delta } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
