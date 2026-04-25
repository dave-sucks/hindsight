"use client";

// Sync Health panel — renders the latest Alpaca↔DB heartbeat snapshot.
// Mounted at the top of the intelligence Health tab. Self-fetches; the
// rest of the tab loads its own data.

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SyncHealthData } from "@/app/api/intelligence/sync-health/route";

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function SyncHealthPanel() {
  const [data, setData] = useState<SyncHealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/intelligence/sync-health");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as SyncHealthData;
        if (!cancelled) setData(json);
      } catch (err) {
        console.error("[sync-health-panel] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium">Alpaca ↔ DB sync</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.latest) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium">Alpaca ↔ DB sync</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <p className="text-xs text-muted-foreground">
            No heartbeat snapshots yet. The cron runs every minute during RTH;
            it will populate within a few minutes after deploy.
          </p>
        </CardContent>
      </Card>
    );
  }

  const s = data.latest;
  const isHealthy = s.overall === "HEALTHY";
  const account = s.alpacaAccountSnapshot as {
    cash?: string;
    buyingPower?: string;
    equity?: string;
  } | null;

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium">
            Alpaca ↔ DB sync
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={isHealthy ? "secondary" : "destructive"}>
              {isHealthy ? "HEALTHY" : "DRIFT"}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {relTime(s.capturedAt)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile label="Orphans" value={s.orphans} sub="Alpaca, no DB row" />
          <StatTile label="Stale" value={s.stale} sub="DB OPEN, no Alpaca" />
          <StatTile
            label="Duplicates"
            value={s.duplicates}
            sub="Same symbol+side"
          />
          <StatTile
            label="Qty mismatch"
            value={s.qtyMismatches}
            sub="DB sum ≠ Alpaca"
          />
          <StatTile
            label="Stuck pending"
            value={s.stuckPending}
            sub="Orders past SLA"
          />
          <StatTile
            label="Cost basis Δ"
            value={fmtMoney(s.costBasisDrift)}
            sub="$1.00 tolerance"
          />
        </div>

        {account && (
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-3">
            <StatTile
              label="Cash"
              value={
                account.cash ? fmtMoney(parseFloat(account.cash)) : "—"
              }
              sub="Alpaca live"
            />
            <StatTile
              label="Buying power"
              value={
                account.buyingPower
                  ? fmtMoney(parseFloat(account.buyingPower))
                  : "—"
              }
              sub="Alpaca live"
            />
            <StatTile
              label="Equity"
              value={
                account.equity ? fmtMoney(parseFloat(account.equity)) : "—"
              }
              sub="Alpaca live"
            />
          </div>
        )}

        {!isHealthy && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Snapshot id <code className="text-xs">{s.id}</code> —
              inspect <code className="text-xs">SyncHealthSnapshot.affectedIds</code>{" "}
              for the rows involved, or run{" "}
              <code className="text-xs">
                npx tsx scripts/reconcile-alpaca-positions.ts
              </code>
              .
            </p>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          {data.timeline24h.length} snapshots in the last 24h.
        </p>
      </CardContent>
    </Card>
  );
}
