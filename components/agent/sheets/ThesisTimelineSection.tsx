"use client";

/**
 * ThesisTimelineSection — activity log block embedded inside ThesisSheet.
 *
 * Lazy-fetches /api/theses/:id/updates when mounted. Renders the
 * timeline as a vertical rail (newest first) with diff lines, price /
 * position context at the time, and chips linking to signals + run.
 *
 * Designed to slot into the existing sheet without disrupting layout —
 * just append `<ThesisTimelineSection thesisId={id} />` after the
 * Signal types block. Skips itself if no thesisId is supplied (e.g. the
 * inline render of a thesis from an agent run before persistence).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Clock,
  Eye,
  Pencil,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

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

function UpdateIcon({ type }: { type: string }) {
  switch (type) {
    case "CREATED":
      return <Plus className="h-3.5 w-3.5" />;
    case "UPDATED":
      return <Pencil className="h-3.5 w-3.5" />;
    case "TRIGGER_FIRED":
      return <Zap className="h-3.5 w-3.5 text-amber-500" />;
    case "REVIEWED":
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
    case "ACTED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "INVALIDATED":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "CLOSED":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "SUPERSEDED":
      return <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <Clock className="h-3.5 w-3.5" />;
  }
}

function FieldChangeLine({
  field,
  change,
}: {
  field: string;
  change: { from: unknown; to: unknown };
}) {
  const renderVal = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v === "number") return v.toString();
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return `[${v.length}]`;
    return "(object)";
  };
  const isArray = Array.isArray(change.from) || Array.isArray(change.to);
  const label = field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase());
  if (isArray) {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}:</span> updated
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground tabular-nums">
      <span className="font-medium text-foreground">{label}:</span>{" "}
      {renderVal(change.from)} → {renderVal(change.to)}
    </div>
  );
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
        <div className="space-y-3">
          {updates.map((u, idx) => {
            const fieldChanges =
              u.fieldChanges && typeof u.fieldChanges === "object"
                ? u.fieldChanges
                : {};
            return (
              <div key={u.id} className="flex gap-3">
                {/* Rail */}
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border bg-background">
                    <UpdateIcon type={u.type} />
                  </div>
                  {idx < updates.length - 1 ? (
                    <div className="w-px flex-1 bg-border" />
                  ) : null}
                </div>
                {/* Body */}
                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-normal">
                      {u.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {fmtDateTime(u.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug">
                    {u.summary}
                  </p>
                  {u.rationale ? (
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {u.rationale}
                    </p>
                  ) : null}
                  {Object.keys(fieldChanges).length > 0 ? (
                    <div className="mt-2 space-y-0.5">
                      {Object.entries(fieldChanges).map(([field, ch]) => (
                        <FieldChangeLine
                          key={field}
                          field={field}
                          change={ch}
                        />
                      ))}
                    </div>
                  ) : null}
                  {(u.priceAtTime != null || u.positionAtTime) ? (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
                      {u.priceAtTime != null ? (
                        <span>Price {fmtUsd(u.priceAtTime)}</span>
                      ) : null}
                      {u.positionAtTime ? (
                        <span>
                          {u.positionAtTime.qty} sh @{" "}
                          {fmtUsd(u.positionAtTime.avgCost)}
                          {u.positionAtTime.unrealizedPnL != null ? (
                            <span
                              className={cn(
                                u.positionAtTime.unrealizedPnL >= 0
                                  ? "text-emerald-500"
                                  : "text-red-500",
                                "ml-1",
                              )}
                            >
                              ({u.positionAtTime.unrealizedPnL >= 0 ? "+" : ""}
                              {fmtUsd(u.positionAtTime.unrealizedPnL)})
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {u.runId || u.signalIds.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {u.runId ? (
                        <Link
                          href={`/runs/${u.runId}`}
                          className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                        >
                          run {u.runId.slice(-6)}
                        </Link>
                      ) : null}
                      {u.signalIds.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          · {u.signalIds.length} signal
                          {u.signalIds.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
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
