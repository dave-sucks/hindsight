"use client";

// Sync Health panel — renders the latest Alpaca↔DB heartbeat snapshot AND
// surfaces the live diff with one-click reconciliation actions per row.
// Mounted at the top of the intelligence Health tab.

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SyncHealthData } from "@/app/api/intelligence/sync-health/route";
import {
  getSyncDiff,
  liquidateOrphan,
  closeStaleDbRow,
  trustAlpacaQty,
  type SyncDiff,
} from "@/lib/actions/sync-reconcile.actions";

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
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, startTransition] = useTransition();

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const [snapshotRes, diffResult] = await Promise.all([
        fetch("/api/intelligence/sync-health"),
        getSyncDiff().catch((err) => {
          console.error("[sync-health-panel] live diff failed", err);
          return null;
        }),
      ]);
      if (snapshotRes.ok) {
        setData((await snapshotRes.json()) as SyncHealthData);
      }
      setDiff(diffResult);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const runAction = useCallback(
    (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      startTransition(async () => {
        const res = await fn();
        if (res.ok) {
          toast.success(`${label} — done`);
          await reload();
        } else {
          toast.error(`${label} failed: ${res.error ?? "unknown error"}`);
        }
      });
    },
    [reload],
  );

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
            No heartbeat snapshots yet. The cron runs hourly; the first row
            will appear at the top of the next hour.
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

        <ReconcileSection
          diff={diff}
          pending={pending}
          refreshing={refreshing}
          runAction={runAction}
          onRefresh={reload}
        />

        <p className="mt-3 text-xs text-muted-foreground">
          Snapshot {s.id} · {data.timeline24h.length} snapshots in the last 24h
        </p>
      </CardContent>
    </Card>
  );
}

function fmtQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function ReconcileRow({
  label,
  detail,
  buttonLabel,
  buttonVariant,
  pending,
  onClick,
}: {
  label: React.ReactNode;
  detail: string;
  buttonLabel: string;
  buttonVariant: "default" | "destructive";
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-xs">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <Button variant={buttonVariant} size="sm" disabled={pending} onClick={onClick}>
        {buttonLabel}
      </Button>
    </div>
  );
}

function ReconcileSection({
  diff,
  pending,
  refreshing,
  runAction,
  onRefresh,
}: {
  diff: SyncDiff | null;
  pending: boolean;
  refreshing: boolean;
  runAction: (
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) => void;
  onRefresh: () => Promise<void>;
}) {
  if (!diff) return null;
  const hasWork =
    diff.orphans.length + diff.stale.length + diff.qtyMismatches.length > 0;

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {hasWork ? "Reconcile" : "Live diff clean"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={refreshing || pending}
          onClick={() => void onRefresh()}
        >
          Refresh
        </Button>
      </div>
      {diff.orphans.map((o) => (
        <ReconcileRow
          key={`orphan-${o.symbol}`}
          label={<>Orphan {o.symbol} <Badge variant="outline">{o.side}</Badge></>}
          detail={`${fmtQty(o.qty)} sh · ${fmtMoney(o.marketValue)} · u-P&L ${fmtMoney(o.unrealizedPnl)}`}
          buttonLabel="Liquidate on Alpaca"
          buttonVariant="destructive"
          pending={pending}
          onClick={() =>
            runAction(`Liquidated ${o.symbol}`, () => liquidateOrphan(o.symbol))
          }
        />
      ))}
      {diff.qtyMismatches.map((m) => (
        <ReconcileRow
          key={`mismatch-${m.symbol}`}
          label={<>Qty mismatch {m.symbol} <Badge variant="outline">{m.direction}</Badge></>}
          detail={`DB ${fmtQty(m.dbQtySum)} → Alpaca ${fmtQty(m.alpacaQty)} (Δ ${fmtQty(m.alpacaQty - m.dbQtySum)})`}
          buttonLabel="Trust Alpaca qty"
          buttonVariant="default"
          pending={pending}
          onClick={() =>
            runAction(`Reconciled ${m.symbol}`, () => trustAlpacaQty(m.symbol))
          }
        />
      ))}
      {diff.stale.map((s) => (
        <ReconcileRow
          key={`stale-${s.positionId}`}
          label={<>Stale {s.symbol} <Badge variant="outline">{s.direction}</Badge></>}
          detail={`${fmtQty(s.quantity)} sh @ ${fmtMoney(s.avgCost)} · ${s.analystName ?? "no analyst"}`}
          buttonLabel="Mark CLOSED"
          buttonVariant="default"
          pending={pending}
          onClick={() =>
            runAction(`Closed ${s.symbol}`, () => closeStaleDbRow(s.positionId))
          }
        />
      ))}
    </div>
  );
}
