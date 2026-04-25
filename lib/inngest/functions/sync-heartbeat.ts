/**
 * Sync Heartbeat — Workstream A.
 *
 * Runs every minute during RTH (every 15 min off-hours) and asks one
 * question: do Alpaca and the DB agree right now?
 *
 * It is read-only by design. We've been burned by automated mutations on
 * the trading book (PR #185 postmortem). The heartbeat detects drift,
 * persists a SyncHealthSnapshot row, and yells in the logs. Any mutation
 * to recover lives behind a human action — for now.
 *
 * Invariants checked (see docs/ALPACA_DB_SYNC_DESIGN.md §1):
 *   I1a  orphans          — Alpaca position with no DB row (the bad one)
 *   I1b  stale            — DB OPEN row Alpaca has no record of
 *   I1c  qty mismatches   — symbol+side matches but qty doesn't
 *        duplicates       — multiple OPEN DB rows for same (symbol, direction)
 *   I2b  pending over SLA — orders stuck PENDING longer than the SLA window
 *   I3   cost basis drift — sum(qty * avgCost) vs Alpaca cost_basis ($ delta)
 *
 * Output: one SyncHealthSnapshot row per run + a CRITICAL-SYNC-DRIFT log
 * line if any invariant fails. /intelligence/health renders the latest
 * snapshot via the v_sync_health_now view.
 *
 * Multi-user: this app is single-tenant in practice, but we group by user
 * because Alpaca creds are per-user and we never want to mix two users'
 * positions into one snapshot. One snapshot row per user per run.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getAccount, getAllPositions, type AlpacaCredentials } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { isMarketOpen } from "@/lib/market-hours";

// Pending-order SLA: an order should resolve in well under 5 min during RTH.
// Off-hours we give it longer because Alpaca queues outside-RTH submits.
const PENDING_SLA_RTH_MS = 5 * 60 * 1000;
const PENDING_SLA_OFFHOURS_MS = 60 * 60 * 1000;

// $1.00 float-drift tolerance for cost basis (sum of avgCost * qty rounding).
const COST_BASIS_TOLERANCE_DOLLARS = 1.0;

const QTY_TOLERANCE = 0.0001;

const key = (symbol: string, side: string) =>
  `${symbol.toUpperCase()}:${side.toUpperCase()}`;

interface SnapshotInput {
  userId: string;
  userEmail: string | null;
  creds: AlpacaCredentials;
}

async function checkOneUser(input: SnapshotInput): Promise<{
  snapshotId: string;
  drift: boolean;
}> {
  const { userId, userEmail, creds } = input;
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
          orders: {
            select: { status: true },
          },
        },
      }),
      prisma.order.findMany({
        where: {
          userId,
          status: "PENDING",
          createdAt: { lt: slaCutoff },
        },
        select: {
          id: true,
          symbol: true,
          side: true,
          createdAt: true,
          alpacaOrderId: true,
          idempotencyKey: true,
        },
      }),
    ]);

  // Exclude positions whose only orders are still PENDING — those are
  // Workstream B's "DB-first commit, Alpaca fill in flight" rows. They look
  // like I1b violations to a naive diff but are actually working as designed.
  // The pendingOrdersOverSla counter still catches anything stuck past SLA.
  const dbPositions = dbPositionsRaw.filter(
    (p) => p.orders.some((o) => o.status === "FILLED"),
  );

  // ── I1a / I1b / I1c / duplicates ──────────────────────────────────────────
  const alpacaBy = new Map<string, (typeof alpacaPositions)[number]>();
  for (const p of alpacaPositions) alpacaBy.set(key(p.symbol, p.side), p);

  const dbBy = new Map<string, Array<(typeof dbPositions)[number]>>();
  for (const p of dbPositions) {
    const k = key(p.symbol, p.direction);
    const arr = dbBy.get(k);
    if (arr) arr.push(p);
    else dbBy.set(k, [p]);
  }

  const orphanIds: string[] = [];   // I1a — Alpaca side ids
  const staleIds: string[] = [];    // I1b — DB position ids
  const duplicateIds: string[] = []; // duplicate DB rows
  const qtyMismatchIds: string[] = []; // I1c — DB position ids in mismatched groups

  for (const [k, alpacaPos] of alpacaBy) {
    const group = dbBy.get(k);
    if (!group || group.length === 0) {
      orphanIds.push(alpacaPos.symbol); // Alpaca has no stable id we keep — symbol is the handle
      continue;
    }
    if (group.length > 1) {
      for (const r of group) duplicateIds.push(r.id);
    }
    const dbQty = group.reduce((n, r) => n + r.quantity, 0);
    if (Math.abs(parseFloat(alpacaPos.qty) - dbQty) > QTY_TOLERANCE) {
      for (const r of group) qtyMismatchIds.push(r.id);
    }
  }

  for (const [k, group] of dbBy) {
    if (!alpacaBy.has(k)) {
      for (const r of group) staleIds.push(r.id);
    }
  }

  // ── I3: cost basis drift ──────────────────────────────────────────────────
  const dbCostBasis = dbPositions.reduce(
    (n, p) => n + p.quantity * p.avgCost,
    0,
  );
  const alpacaCostBasis = alpacaPositions.reduce(
    (n, p) => n + Math.abs(parseFloat(p.cost_basis)),
    0,
  );
  const costBasisDrift = Math.abs(dbCostBasis - alpacaCostBasis);

  // ── I2b: pending orders over SLA ──────────────────────────────────────────
  const stuckIds = stuckOrders.map((o) => o.id);

  const orphanCount = orphanIds.length;
  const staleCount = staleIds.length;
  const duplicateCount = duplicateIds.length;
  const qtyCount = qtyMismatchIds.length;
  const stuckCount = stuckIds.length;

  const drift =
    orphanCount + staleCount + duplicateCount + qtyCount + stuckCount > 0 ||
    costBasisDrift > COST_BASIS_TOLERANCE_DOLLARS;

  const snapshot = await prisma.syncHealthSnapshot.create({
    data: {
      orphansAlpacaNotInDb: orphanCount,
      staleDbNotInAlpaca: staleCount,
      duplicateDbRows: duplicateCount,
      quantityMismatches: qtyCount,
      pendingOrdersOverSla: stuckCount,
      costBasisDriftDollars: costBasisDrift,
      affectedIds: {
        userId,
        userEmail,
        orphans: orphanIds,
        stale: staleIds,
        duplicates: duplicateIds,
        qtyMismatches: qtyMismatchIds,
        stuckPending: stuckIds,
      },
      alpacaAccountSnapshot: {
        cash: alpacaAccount.cash,
        buyingPower: alpacaAccount.buying_power,
        equity: alpacaAccount.equity,
        portfolioValue: alpacaAccount.portfolio_value,
        longMarketValue: alpacaAccount.long_market_value ?? null,
        shortMarketValue: alpacaAccount.short_market_value ?? null,
      },
    },
  });

  if (drift) {
    console.error(
      `CRITICAL-SYNC-DRIFT user=${userEmail ?? userId} orphans=${orphanCount} stale=${staleCount} duplicates=${duplicateCount} qtyMismatches=${qtyCount} stuckPending=${stuckCount} costBasisDrift=$${costBasisDrift.toFixed(2)} snapshot=${snapshot.id}`,
    );
  }

  return { snapshotId: snapshot.id, drift };
}

// Two crons feeding the same handler: one for RTH (1 min), one for off-hours
// (15 min). Inngest doesn't support a "different cadence inside the same
// cron expression" so we register the handler with two triggers and let
// each fire on its own schedule. We still gate by isMarketOpen so the RTH
// cron is a no-op outside RTH and the off-hours one is a no-op during it.

async function runHeartbeat(): Promise<{
  ranAt: string;
  users: number;
  drift: number;
  snapshotIds: string[];
}> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });

  if (users.length === 0) {
    return { ranAt: new Date().toISOString(), users: 0, drift: 0, snapshotIds: [] };
  }

  const snapshotIds: string[] = [];
  let driftCount = 0;

  for (const user of users) {
    const creds = await resolveAlpacaCredentials(user.id);
    if (!creds) continue;
    try {
      const { snapshotId, drift } = await checkOneUser({
        userId: user.id,
        userEmail: user.email,
        creds,
      });
      snapshotIds.push(snapshotId);
      if (drift) driftCount++;
    } catch (err) {
      console.error(
        `[sync-heartbeat] check failed for user=${user.email ?? user.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    ranAt: new Date().toISOString(),
    users: users.length,
    drift: driftCount,
    snapshotIds,
  };
}

export const syncHeartbeatRth = inngest.createFunction(
  {
    id: "sync-heartbeat-rth",
    name: "Sync Heartbeat (RTH)",
    retries: 0,
  },
  { cron: "TZ=America/New_York */1 9-16 * * 1-5" },
  async () => {
    if (!isMarketOpen()) {
      return { skipped: "outside-rth" };
    }
    return runHeartbeat();
  },
);

export const syncHeartbeatOffHours = inngest.createFunction(
  {
    id: "sync-heartbeat-offhours",
    name: "Sync Heartbeat (off-hours)",
    retries: 0,
  },
  { cron: "TZ=America/New_York */15 * * * *" },
  async () => {
    if (isMarketOpen()) {
      return { skipped: "rth-handled-by-other-cron" };
    }
    return runHeartbeat();
  },
);
