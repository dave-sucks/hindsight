"use client";

/**
 * ThesisTriggersSection — renders the structured triggers + scheduling
 * metadata for a thesis. Sits above ThesisTimelineSection in the sheet.
 *
 * Layout:
 *
 *   Triggers
 *   ─────────────────────────────────────────
 *     EXIT     PRICE_BELOW $122        Hard stop. Get out fast.
 *                                       last fired never
 *     REVIEW   EARNINGS_MISS ≥3%       Downside surprise tests core belief.
 *                                       last fired Mar 18 · cooldown 7d
 *     ...
 *
 *   Schedule
 *     Horizon          COMPOUNDER
 *     Next review      Apr 28, 2026 (in 6 days)
 *     Target size      5% of portfolio
 *     Max hold         — (open-ended)
 *
 * If the test-fire feature is enabled (NEXT_PUBLIC_ENABLE_TRIGGER_TEST_FIRE),
 * each trigger row gets a "Test fire" button that synthetically emits
 * `app/thesis.trigger.fired` so a tactical run spawns immediately —
 * lets you demo the end-to-end without waiting for a real signal.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-row";
import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";

// 2026-04-29: env-var gating removed. Single-user app; the route is
// auth-scoped and synthetic firing is harmless (creates a real auditable
// ResearchRun). Always show the button.

interface TriggerPredicate {
  kind: string;
  level?: number;
  pct?: number;
  direction?: string;
  window?: string;
  period?: number;
  threshold?: number;
  signalType?: string;
  sentiment?: string;
  minUrgency?: string;
  minSurprisePct?: number;
  formType?: string;
  days?: number;
  predicates?: TriggerPredicate[];
}

interface Trigger {
  id: string;
  predicate: TriggerPredicate;
  action: string;
  rationale: string;
  cooldownDays?: number;
  lastFiredAt?: string;
}

interface TriggersResponse {
  horizon: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  catalystDate: string | null;
  maxHoldDays: number | null;
  nextReviewAt: string | null;
  triggers: Trigger[];
}

function describePredicate(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_ABOVE":
      return `price > $${p.level}`;
    case "PRICE_BELOW":
      return `price < $${p.level}`;
    case "PRICE_MOVE_PCT":
      return `${p.direction === "UP" ? "+" : "-"}${p.pct}% over ${p.window}`;
    case "VS_SMA":
      return `${p.direction?.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction?.toLowerCase()} ${p.threshold}`;
    case "SIGNAL_TYPE": {
      const parts = [p.signalType];
      if (p.sentiment) parts.push(p.sentiment);
      if (p.minUrgency) parts.push(`≥${p.minUrgency}`);
      return parts.join(" · ");
    }
    case "EARNINGS_BEAT":
      return p.minSurprisePct ? `earnings beat ≥ ${p.minSurprisePct}%` : "earnings beat";
    case "EARNINGS_MISS":
      return p.minSurprisePct ? `earnings miss ≥ ${p.minSurprisePct}%` : "earnings miss";
    case "GUIDANCE_CHANGE":
      return `guidance ${p.direction}`;
    case "FILING":
      return `${p.formType} filed`;
    case "TIME_ELAPSED":
      return `${p.days} days elapsed`;
    case "REVIEW_DATE_HIT":
      return `review date hit`;
    case "AND":
      return `(${(p.predicates ?? []).map(describePredicate).join(" AND ")})`;
    case "OR":
      return `(${(p.predicates ?? []).map(describePredicate).join(" OR ")})`;
    default:
      return p.kind;
  }
}

function actionVariant(action: string): "negative" | "positive" | "secondary" | "outline" {
  switch (action) {
    case "EXIT":
      return "negative";
    case "ADD":
      return "positive";
    case "TRIM":
      return "secondary";
    case "MOVE_STOP":
      return "outline";
    case "REVIEW":
    default:
      return "outline";
  }
}

function fmtRelativeOrDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = Date.now();
  const diffDays = Math.round((date.getTime() - now) / 86_400_000);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffDays === 0) return `${dateStr} (today)`;
  if (diffDays > 0) return `${dateStr} (in ${diffDays}d)`;
  return `${dateStr} (${Math.abs(diffDays)}d ago)`;
}

function fmtFiredAt(iso?: string): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props {
  thesisId: string;
}

export function ThesisTriggersSection({ thesisId }: Props) {
  const router = useRouter();
  const [data, setData] = useState<TriggersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<string | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/theses/${thesisId}/triggers`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as TriggersResponse;
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [thesisId]);

  async function testFire(triggerId: string) {
    setFireError(null);
    setFiring(triggerId);
    try {
      const r = await fetch(`/api/admin/triggers/fire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesisId, triggerId }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      const out = (await r.json()) as { runId?: string };
      if (out.runId) {
        router.push(`/runs/${out.runId}`);
      }
    } catch (e) {
      setFireError(e instanceof Error ? e.message : String(e));
    } finally {
      setFiring(null);
    }
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Triggers</p>
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load triggers: {error}
        </p>
      </div>
    );
  }

  if (data == null) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Triggers</p>
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const hasSchedule =
    data.horizon != null ||
    data.nextReviewAt != null ||
    data.targetSizePct != null ||
    data.catalystDate != null ||
    data.maxHoldDays != null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Triggers</p>
        {data.triggers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No triggers attached. Run the backfill or set a horizon when minting
            this thesis to auto-attach the baseline.
          </p>
        ) : (
          <div className="space-y-2">
            {data.triggers.map((t) => (
              <div
                key={t.id}
                className="rounded-md border p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={actionVariant(t.action)} className="font-normal">
                      {t.action}
                    </Badge>
                    <span className="text-sm font-medium tabular-nums">
                      {describePredicate(t.predicate)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testFire(t.id)}
                    disabled={firing === t.id}
                  >
                    <Zap className="size-3" />
                    {firing === t.id ? "Firing…" : "Test fire"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t.rationale}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span>last fired {fmtFiredAt(t.lastFiredAt)}</span>
                  {t.cooldownDays ? (
                    <>
                      <span className="opacity-40">·</span>
                      <span>cooldown {t.cooldownDays}d</span>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {fireError ? (
          <p className="text-xs text-red-500">Test fire failed: {fireError}</p>
        ) : null}
      </div>

      {hasSchedule ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Schedule</p>
          <div className="flex flex-col gap-1">
            {data.horizon ? (
              <InfoRow label="Horizon" value={data.horizon} />
            ) : null}
            {data.nextReviewAt ? (
              <InfoRow
                label="Next review"
                value={fmtRelativeOrDate(data.nextReviewAt)}
                mono
              />
            ) : null}
            {data.targetSizePct != null ? (
              <InfoRow
                label="Target size"
                value={`${data.targetSizePct}% of portfolio`}
                mono
              />
            ) : null}
            {data.catalystDate ? (
              <InfoRow
                label="Catalyst date"
                value={fmtRelativeOrDate(data.catalystDate)}
                mono
              />
            ) : null}
            {data.maxHoldDays != null ? (
              <InfoRow
                label="Max hold"
                value={`${data.maxHoldDays} days`}
                mono
                border={false}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
