import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

// /api/intelligence/sync-health
// Returns the latest sync heartbeat snapshot + last-24h timeline, split per
// trading environment (PAPER / LIVE), so the Health tab can answer "is Alpaca↔DB
// in sync right now?" for each book independently. The heartbeat writes one
// snapshot per (user, environment) pair; environment is tagged in affectedIds.
// See docs/ALPACA_DB_SYNC_DESIGN.md §5.

type Environment = "PAPER" | "LIVE";
const ENVIRONMENTS: readonly Environment[] = ["PAPER", "LIVE"];

export interface SyncHealthSnapshotDTO {
  id: string;
  environment: Environment;
  capturedAt: string;
  orphans: number;
  stale: number;
  duplicates: number;
  qtyMismatches: number;
  stuckPending: number;
  costBasisDrift: number;
  overall: "HEALTHY" | "DRIFT" | "NEVER_RAN";
  affectedIds: unknown;
  alpacaAccountSnapshot: unknown;
}

export interface SyncHealthEnvBlock {
  environment: Environment;
  latest: SyncHealthSnapshotDTO | null;
  timeline24h: Array<{
    capturedAt: string;
    drift: number; // sum of all violation counts (excluding cost-basis $)
    costBasisDrift: number;
  }>;
}

export interface SyncHealthData {
  environments: SyncHealthEnvBlock[];
}

type SnapshotRow = {
  id: string;
  capturedAt: Date;
  orphansAlpacaNotInDb: number;
  staleDbNotInAlpaca: number;
  duplicateDbRows: number;
  quantityMismatches: number;
  pendingOrdersOverSla: number;
  costBasisDriftDollars: number;
  affectedIds: unknown;
  alpacaAccountSnapshot: unknown;
};

const violationCount = (s: SnapshotRow) =>
  s.orphansAlpacaNotInDb +
  s.staleDbNotInAlpaca +
  s.duplicateDbRows +
  s.quantityMismatches +
  s.pendingOrdersOverSla;

const isHealthy = (s: SnapshotRow) =>
  violationCount(s) === 0 && Math.abs(s.costBasisDriftDollars) < 1.0;

// Environment is tagged into affectedIds by the heartbeat. Pre-fix snapshots have
// no tag — treat them as PAPER (that was the account the buggy cron compared
// against), so historical rows still surface somewhere rather than vanishing.
const environmentOf = (s: SnapshotRow): Environment => {
  const a = s.affectedIds as { environment?: string } | null;
  return a?.environment === "LIVE" ? "LIVE" : "PAPER";
};

const toDTO = (s: SnapshotRow, environment: Environment): SyncHealthSnapshotDTO => ({
  id: s.id,
  environment,
  capturedAt: s.capturedAt.toISOString(),
  orphans: s.orphansAlpacaNotInDb,
  stale: s.staleDbNotInAlpaca,
  duplicates: s.duplicateDbRows,
  qtyMismatches: s.quantityMismatches,
  stuckPending: s.pendingOrdersOverSla,
  costBasisDrift: s.costBasisDriftDollars,
  overall: isHealthy(s) ? "HEALTHY" : "DRIFT",
  affectedIds: s.affectedIds,
  alpacaAccountSnapshot: s.alpacaAccountSnapshot,
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // One hourly snapshot per environment → 24h always covers the latest of each.
  const snapshots = (await prisma.syncHealthSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: "desc" },
  })) as SnapshotRow[];

  const environments: SyncHealthEnvBlock[] = ENVIRONMENTS.map((environment) => {
    const rows = snapshots.filter((s) => environmentOf(s) === environment);
    return {
      environment,
      latest: rows.length > 0 ? toDTO(rows[0], environment) : null,
      timeline24h: [...rows].reverse().map((s) => ({
        capturedAt: s.capturedAt.toISOString(),
        drift: violationCount(s),
        costBasisDrift: s.costBasisDriftDollars,
      })),
    };
  }).filter((block) => block.latest !== null);

  const data: SyncHealthData = { environments };
  return NextResponse.json(data);
}
