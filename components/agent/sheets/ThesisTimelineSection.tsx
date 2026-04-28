"use client";

/**
 * ThesisTimelineSection — durable activity log embedded inside ThesisSheet.
 *
 * Lazy-fetches /api/theses/:id/updates when mounted. Renders the timeline
 * newest-first as a flat list of CoT-style entries (no rail, no big icon
 * column).
 *
 * Per-entry layout:
 *   [price + arrow]                                           [tiny dot]
 *   <heading>
 *   <description>
 *   TYPE · View run · N signals
 *
 * The arrow on the price compares to the next-older entry's
 * priceAtTime — so reading top-down you see what direction the stock has
 * moved between thesis touches.
 *
 * Designed to slot into the existing sheet without disrupting layout —
 * just append `<ThesisTimelineSection thesisId={id} />`. Skips itself if
 * thesisId isn't supplied (agent-run inline render before persistence).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, DotIcon } from "lucide-react";
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

function typeLabel(t: string): string {
  // Lowercase except first letter — reads better as plain text than the
  // SHOUTING-CASE the DB stores.
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
        <div className="space-y-4">
          {updates.map((u, idx) => {
            // Compare to the next-older entry's price (we render newest-first,
            // so "older" is the next index). Null on either side = no arrow.
            const olderPrice = updates[idx + 1]?.priceAtTime ?? null;
            const delta =
              u.priceAtTime != null && olderPrice != null
                ? u.priceAtTime - olderPrice
                : null;

            return (
              <div key={u.id} className="space-y-1">
                {/* ── Heading: price (left) + dot (right) ──────────────── */}
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
                  <div className="size-4 shrink-0 flex items-center justify-center text-muted-foreground/60">
                    <DotIcon className="size-5" />
                  </div>
                </div>

                {/* ── Summary (heading) ─────────────────────────────────── */}
                <p className="text-sm font-medium leading-snug">{u.summary}</p>

                {/* ── Rationale (description) ───────────────────────────── */}
                {u.rationale ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {u.rationale}
                  </p>
                ) : null}

                {/* ── Footer: TYPE · View run · N signals ─────────────── */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span>{typeLabel(u.type)}</span>
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
                  {u.positionAtTime ? (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="tabular-nums">
                        {u.positionAtTime.qty} sh @{" "}
                        {fmtUsd(u.positionAtTime.avgCost)}
                      </span>
                      {u.positionAtTime.unrealizedPnL != null ? (
                        <span
                          className={cn(
                            "tabular-nums",
                            u.positionAtTime.unrealizedPnL >= 0
                              ? "text-emerald-500"
                              : "text-red-500",
                          )}
                        >
                          ({u.positionAtTime.unrealizedPnL >= 0 ? "+" : ""}
                          {fmtUsd(u.positionAtTime.unrealizedPnL)})
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
