"use client";

/**
 * ThesisTimelineSection — durable activity log embedded inside ThesisSheet.
 *
 * Lazy-fetches /api/theses/:id/updates when mounted. Renders the timeline
 * newest-first as a vertical rail: small dot per entry connected by a line.
 *
 * Per-entry layout:
 *   ●  $35.27 ↑                                        Apr 27, 8:11 AM
 *   │  <heading>
 *   │  <description>
 *   │  Type · View run · N signals
 *
 * Arrow on the price compares to the next-older entry's priceAtTime so
 * reading top-down shows the direction the stock has moved between
 * thesis touches. Null prices = no arrow (and shown as —).
 *
 * Skips itself if thesisId isn't supplied (agent-run inline render before
 * persistence).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThesisUpdate {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  rationale: string | null;
  fieldChanges: Record<string, { from: unknown; to: unknown }>;
  priceAtTime: number | null;
  positionAtTime: {
    qty: number;
    avgCost: number;
    unrealizedPnL: number | null;
  } | null;
  triggerId: string | null;
  signalIds: string[];
  runId: string | null;
  tradeId: string | null;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function typeLabel(t: string): string {
  // Title-case: "SUPERSEDED" → "Superseded", "TRIGGER_FIRED" → "Trigger fired"
  return t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");
}

interface Props {
  thesisId: string;
}

export function ThesisTimelineSection({ thesisId }: Props) {
  const [updates, setUpdates] = useState<ThesisUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/theses/${thesisId}/updates?limit=50`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { updates: ThesisUpdate[] };
        if (!cancelled) setUpdates(json.updates);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [thesisId]);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Activity</p>

      {error ? (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load activity: {error}
        </p>
      ) : updates == null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : updates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <div>
          {updates.map((u, idx) => {
            // Compare to the next-older entry's price (we render
            // newest-first, so older = idx + 1).
            const olderPrice = updates[idx + 1]?.priceAtTime ?? null;
            const delta =
              u.priceAtTime != null && olderPrice != null
                ? u.priceAtTime - olderPrice
                : null;
            const isLast = idx === updates.length - 1;

            return (
              <div key={u.id} className="flex gap-3">
                {/* ── Rail (dot + line) ─────────────────────────────── */}
                <div className="flex flex-col items-center shrink-0">
                  {/* Tiny dot, vertically aligned with the price line */}
                  <div className="size-1.5 rounded-full bg-muted-foreground/50 mt-1.5" />
                  {!isLast ? (
                    <div className="w-px flex-1 bg-border mt-1" />
                  ) : null}
                </div>

                {/* ── Body ──────────────────────────────────────────── */}
                <div className={cn("flex-1 min-w-0 space-y-1", !isLast && "pb-4")}>
                  {/* Top row: Price (left) · Date (right) */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium tabular-nums flex items-center gap-1">
                      {fmtUsd(u.priceAtTime)}
                      {delta != null && delta !== 0 ? (
                        delta > 0 ? (
                          <ArrowUp className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-red-500" />
                        )
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {fmtDateTime(u.timestamp)}
                    </span>
                  </div>

                  {/* Summary (heading) */}
                  <p className="text-sm font-medium leading-snug">
                    {u.summary}
                  </p>

                  {/* Rationale (description) */}
                  {u.rationale ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {u.rationale}
                    </p>
                  ) : null}

                  {/* Footer: Type · TriggerId chip · View run · Signals */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>{typeLabel(u.type)}</span>
                    {u.type === "TRIGGER_FIRED" && u.triggerId ? (
                      <>
                        <span className="opacity-40">·</span>
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono tabular-nums"
                          title={`triggerId ${u.triggerId}`}
                        >
                          trigger {u.triggerId.slice(-6)}
                        </span>
                      </>
                    ) : null}
                    {u.runId ? (
                      <>
                        <span className="opacity-40">·</span>
                        <Link
                          href={`/runs/${u.runId}`}
                          className="hover:text-foreground underline-offset-4 hover:underline"
                        >
                          View run
                        </Link>
                      </>
                    ) : null}
                    {u.signalIds.length > 0 ? (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="tabular-nums">
                          {u.signalIds.length} signal
                          {u.signalIds.length === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
