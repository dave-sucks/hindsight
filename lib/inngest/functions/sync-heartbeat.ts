// Hourly Alpaca↔DB drift detector. Detection-only — mutations live behind
// human clicks on the Health panel (see lib/actions/sync-reconcile.actions.ts).
//
// Exports computeSyncDiff + writeSnapshot so the panel can reuse the same
// logic for the live diff and for capturing a fresh snapshot after a manual
// reconcile, without re-implementing the rules.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  getAccount,
  getAllPositions,
  type AlpacaCredentials,
  type AlpacaPosition,
} from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { isMarketOpen } from "@/lib/market-hours";

const PENDING_SLA_RTH_MS = 5 * 60 * 1000;
const PENDING_SLA_OFFHOURS_MS = 60 * 60 * 1000;
const COST_BASIS_TOLERANCE_DOLLARS = 1.0;
const QTY_TOLERANCE = 0.0001;

const key = (sym: string, side: string) =>
  `${sym.toUpperCase()}:${side.toUpperCase()}`;

export interface SyncDiffRow {
  positionId: string;
  symbol: string;
  direction: string;
  quantity: number;
  avgCost: number;
  analystName: string | null;
}

export interface SyncDiff {
  orphans: Array<{
    symbol: string;
    side: string;
    qty: number;
    avgEntry: number;
    marketValue: number;
    unrealizedPnl: number;
  }>;
  stale: SyncDiffRow[];
  qtyMismatches: Array<{
    symbol: string;
    direction: string;
    alpacaQty: number;
    dbQtySum: number;
    rows: SyncDiffRow[];
  }>;
  duplicates: Array<{
    symbol: string;
    direction: string;
    rows: SyncDiffRow[];
  }>;
  stuckPendingOrderIds: string[];
  costBasisDrift: number;
  alpacaAccount: AlpacaAccountSnap;
}

interface AlpacaAccountSnap {
  cash: string;
  buyingPower: string;
  equity: string;
  portfolioValue: string;
  longMarketValue: string | null;
  shortMarketValue: string | null;
}

export async function computeSyncDiff(
  userId: string,
  creds: AlpacaCredentials,
): Promise<SyncDiff> {
  const now = new Date();
  const slaMs = isMarketOpen(now) ? PENDING_SLA_RTH_MS : PENDING_SLA_OFFHOURS_MS;
  const slaCutoff = new Date(now.getTime() - slaMs);

  const [alpacaAccount, alpacaPositions, dbPositionsRaw, stuckOrders] =
    await Promise.all([
      getAccount(creds),
      getAllPositions(creds),
      prisma.position.findMany({
        where: { userId, status: "OPEN" },
        select: {
          id: true,
          symbol: true,
          direction: true,
          quantity: true,
          avgCost: true,
          analyst: { select: { name: true } },
          orders: { select: { status: true } },
        },
      }),
      prisma.order.findMany({
        where: { userId, status: "PENDING", createdAt: { lt: slaCutoff } },
        select: { id: true },
      }),
    ]);

  // Exclude DB rows whose only Order is still PENDING — Workstream B's
  // "DB-first commit, fill in flight" state isn't drift.
  const dbPositions = dbPositionsRaw.filter((p) =>
    p.orders.some((o) => o.status === "FILLED"),
  );

  const alpacaBy = new Map<string, AlpacaPosition>();
  for (const p of alpacaPositions) alpacaBy.set(key(p.symbol, p.side), p);

  const dbBy = new Map<string, typeof dbPositions>();
  for (const p of dbPositions) {
    const k = key(p.symbol, p.direction);
    const arr = dbBy.get(k);
    if (arr) arr.push(p);
    else dbBy.set(k, [p]);
  }

  const toRow = (p: (typeof dbPositions)[number]): SyncDiffRow => ({
    positionId: p.id,
    symbol: p.symbol,
    direction: p.direction,
    quantity: p.quantity,
    avgCost: p.avgCost,
    analystName: p.analyst?.name ?? null,
  });

  const orphans: SyncDiff["orphans"] = [];
  const qtyMismatches: SyncDiff["qtyMismatches"] = [];
  const duplicates: SyncDiff["duplicates"] = [];

  for (const [k, alpacaPos] of alpacaBy) {
    const group = dbBy.get(k);
    const alpacaQty = parseFloat(alpacaPos.qty);
    if (!group || group.length === 0) {
      orphans.push({
        symbol: alpacaPos.symbol,
        side: alpacaPos.side,
        qty: alpacaQty,
        avgEntry: parseFloat(alpacaPos.avg_entry_price),
        marketValue: parseFloat(alpacaPos.market_value),
        unrealizedPnl: parseFloat(alpacaPos.unrealized_pl),
      });
      continue;
    }
    const dbQtySum = group.reduce((n, r) => n + r.quantity, 0);
    if (Math.abs(alpacaQty - dbQtySum) > QTY_TOLERANCE) {
      qtyMismatches.push({
        symbol: alpacaPos.symbol,
        direction: group[0].direction,
        alpacaQty,
        dbQtySum,
        rows: group.map(toRow),
      });
    } else if (group.length > 1) {
      duplicates.push({
        symbol: alpacaPos.symbol,
        direction: group[0].direction,
        rows: group.map(toRow),
      });
    }
  }

  const stale: SyncDiffRow[] = [];
  for (const [k, group] of dbBy) {
    if (!alpacaBy.has(k)) for (const r of group) stale.push(toRow(r));
  }

  const dbCostBasis = dbPositions.reduce((n, p) => n + p.quantity * p.avgCost, 0);
  const alpacaCostBasis = alpacaPositions.reduce(
    (n, p) => n + Math.abs(parseFloat(p.cost_basis)),
    0,
  );

  return {
    orphans,
    stale,
    qtyMismatches,
    duplicates,
    stuckPendingOrderIds: stuckOrders.map((o) => o.id),
    costBasisDrift: Math.abs(dbCostBasis - alpacaCostBasis),
    alpacaAccount: {
      cash: alpacaAccount.cash,
      buyingPower: alpacaAccount.buying_power,
      equity: alpacaAccount.equity,
      portfolioValue: alpacaAccount.portfolio_value,
      longMarketValue: alpacaAccount.long_market_value ?? null,
      shortMarketValue: alpacaAccount.short_market_value ?? null,
    },
  };
}

export async function writeSnapshot(
  userId: string,
  diff: SyncDiff,
  source: "cron" | "manual-reconcile",
): Promise<{ snapshotId: string; drift: boolean }> {
  const orphanCount = diff.orphans.length;
  const staleCount = diff.stale.length;
  const duplicateCount = diff.duplicates.reduce((n, d) => n + d.rows.length, 0);
  const qtyCount = diff.qtyMismatches.reduce((n, m) => n + m.rows.length, 0);
  const stuckCount = diff.stuckPendingOrderIds.length;
  const drift =
    orphanCount + staleCount + duplicateCount + qtyCount + stuckCount > 0 ||
    diff.costBasisDrift > COST_BASIS_TOLERANCE_DOLLARS;

  const snapshot = await prisma.syncHealthSnapshot.create({
    data: {
      orphansAlpacaNotInDb: orphanCount,
      staleDbNotInAlpaca: staleCount,
      duplicateDbRows: duplicateCount,
      quantityMismatches: qtyCount,
      pendingOrdersOverSla: stuckCount,
      costBasisDriftDollars: diff.costBasisDrift,
      affectedIds: {
        userId,
        source,
        orphans: diff.orphans.map((o) => o.symbol),
        stale: diff.stale.map((r) => r.positionId),
        duplicates: diff.duplicates.flatMap((d) => d.rows.map((r) => r.positionId)),
        qtyMismatches: diff.qtyMismatches.flatMap((m) => m.rows.map((r) => r.positionId)),
        stuckPending: diff.stuckPendingOrderIds,
      },
      alpacaAccountSnapshot: diff.alpacaAccount as unknown as object,
    },
  });

  if (drift && source === "cron") {
    console.error(
      `CRITICAL-SYNC-DRIFT user=${userId} orphans=${orphanCount} stale=${staleCount} duplicates=${duplicateCount} qtyMismatches=${qtyCount} stuckPending=${stuckCount} costBasisDrift=$${diff.costBasisDrift.toFixed(2)} snapshot=${snapshot.id}`,
    );
  }
  return { snapshotId: snapshot.id, drift };
}

export const syncHeartbeat = inngest.createFunction(
  { id: "sync-heartbeat", name: "Sync Heartbeat", retries: 0 },
  { cron: "0 * * * *" },
  async () => {
    // Iterate over users with Alpaca configured — the User table is unused
    // under Supabase auth, but UserApiKey is authoritative for "who has creds".
    const apiKeys = await prisma.userApiKey.findMany({
      where: { provider: "ALPACA" },
      select: { userId: true },
    });
    const snapshotIds: string[] = [];
    let driftCount = 0;
    for (const { userId } of apiKeys) {
      const creds = await resolveAlpacaCredentials(userId);
      if (!creds) continue;
      try {
        const diff = await computeSyncDiff(userId, creds);
        const { snapshotId, drift } = await writeSnapshot(userId, diff, "cron");
        snapshotIds.push(snapshotId);
        if (drift) driftCount++;
      } catch (err) {
        console.error(
          `[sync-heartbeat] failed for user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return {
      ranAt: new Date().toISOString(),
      users: apiKeys.length,
      drift: driftCount,
      snapshotIds,
    };
  },
);
