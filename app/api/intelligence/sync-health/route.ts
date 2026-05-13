import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

// /api/intelligence/sync-health
// Returns the latest sync heartbeat snapshot + last-24h timeline so the
// Health tab can answer "is Alpaca↔DB in sync right now?" at a glance.
// See docs/ALPACA_DB_SYNC_DESIGN.md §5.

export interface SyncHealthSnapshotDTO {
  id: string;
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

export interface SyncHealthData {
  latest: SyncHealthSnapshotDTO | null;
  timeline24h: Array<{
    capturedAt: string;
    drift: number; // sum of all violation counts (excluding cost-basis $)
    costBasisDrift: number;
  }>;
}

const HEALTHY = (s: {
  orphansAlpacaNotInDb: number;
  staleDbNotInAlpaca: number;
  duplicateDbRows: number;
  quantityMismatches: number;
  pendingOrdersOverSla: number;
  costBasisDriftDollars: number;
}) =>
  s.orphansAlpacaNotInDb +
    s.staleDbNotInAlpaca +
    s.duplicateDbRows +
    s.quantityMismatches +
    s.pendingOrdersOverSla ===
    0 && Math.abs(s.costBasisDriftDollars) < 1.0;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [latest, last24h] = await Promise.all([
    prisma.syncHealthSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
    }),
    prisma.syncHealthSnapshot.findMany({
      where: { capturedAt: { gte: since } },
      orderBy: { capturedAt: "asc" },
      select: {
        capturedAt: true,
        orphansAlpacaNotInDb: true,
        staleDbNotInAlpaca: true,
        duplicateDbRows: true,
        quantityMismatches: true,
        pendingOrdersOverSla: true,
        costBasisDriftDollars: true,
      },
    }),
  ]);

  const data: SyncHealthData = {
    latest: latest
      ? {
          id: latest.id,
          capturedAt: latest.capturedAt.toISOString(),
          orphans: latest.orphansAlpacaNotInDb,
          stale: latest.staleDbNotInAlpaca,
          duplicates: latest.duplicateDbRows,
          qtyMismatches: latest.quantityMismatches,
          stuckPending: latest.pendingOrdersOverSla,
          costBasisDrift: latest.costBasisDriftDollars,
          overall: HEALTHY(latest) ? "HEALTHY" : "DRIFT",
          affectedIds: latest.affectedIds,
          alpacaAccountSnapshot: latest.alpacaAccountSnapshot,
        }
      : null,
    timeline24h: last24h.map((s) => ({
      capturedAt: s.capturedAt.toISOString(),
      drift:
        s.orphansAlpacaNotInDb +
        s.staleDbNotInAlpaca +
        s.duplicateDbRows +
        s.quantityMismatches +
        s.pendingOrdersOverSla,
      costBasisDrift: s.costBasisDriftDollars,
    })),
  };

  return NextResponse.json(data);
}
