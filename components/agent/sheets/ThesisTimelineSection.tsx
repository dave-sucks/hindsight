"use client";

/**
 * ThesisTimelineSection — the thesis audit log, rendered inside the
 * ThesisSheet Activity tab (P1-33 slice 1).
 *
 * Lazy-fetches /api/theses/:id/updates when mounted. That endpoint merges
 * ThesisUpdate rows with proposal outcomes read from the Order table (the
 * source of truth for approve / reject / expire), so the timeline shows in
 * one place: every trigger fire, which run handled it (link), what the
 * analyst changed (exact from → to numbers), and the outcome — bought /
 * sold / declined (with the principal's note) / level moved / expired.
 *
 * The pure row logic (outcome chips, from → to lines, ladder diffs) lives
 * in thesis-timeline-utils.ts so it stays unit-testable without JSX.
 *
 * Per-entry layout:
 *   ●  Apr 27, 8:11 AM                                      $35.27 ↑
 *   │  [chip] <heading>
 *   │  <field-change lines: "Target $80 → $95", trigger ladder diffs>
 *   │  <description>
 *   │  Type · trigger chip · View run · View trade · N signals
 *
 * Arrow on the price compares to the next-older entry's priceAtTime so
 * reading top-down shows the direction the stock has moved between
 * thesis touches. Null prices = no arrow.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  outcomeChip,
  fieldChangeLines,
  proposalUserMessage,
  railDot,
  type TimelineUpdate,
} from "@/components/agent/sheets/thesis-timeline-utils";

// When the sheet opens from a run-detail page (/runs/[id]), entries whose
// runId matches the URL get the "edited-in-this-run" treatment. Pure URL
// detection — no prop plumbing required from callers.
function useCurrentRunId(): string | null {
  const pathname = usePathname();
  if (!pathname) return null;
  const match = pathname.match(/^\/runs\/([^/]+)/);
  return match?.[1] ?? null;
}

function fmtUsd(v: number | null | undefined): string | null {
  // Returns null when the price is missing so the caller can hide the
  // chunk entirely instead of rendering a placeholder dash (2026-05-19).
  if (v == null) return null;
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
  const [updates, setUpdates] = useState<TimelineUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentRunId = useCurrentRunId();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/theses/${thesisId}/updates?limit=100`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { updates: TimelineUpdate[] };
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
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Activity
      </p>

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
            const isLast = idx === updates.length - 1;
            const isCurrentRun =
              currentRunId != null && u.runId === currentRunId;
            const chip = outcomeChip(u);
            const dot = railDot(u);
            const changeLines = fieldChangeLines(u);
            const userNote = proposalUserMessage(u);
            // The synthesized reject row's rationale IS the user note —
            // don't render the same text twice.
            const rationale =
              u.rationale && u.rationale !== userNote ? u.rationale : null;

            return (
              <div key={u.id} className="flex gap-3">
                {/* ── Rail (dot + line) ─────────────────────────────── */}
                <div className="flex flex-col items-center shrink-0">
                  {/* Tiny dot, vertically aligned with the price line.
                      Money-movement rows read at a glance: green = bought,
                      red = sold (same tokens the gauge/trade block use).
                      Current-run entries get the amber pulse, which wins. */}
                  <div
                    className={cn(
                      "size-1.5 rounded-full mt-1.5",
                      isCurrentRun
                        ? "bg-amber-500 animate-pulse ring-2 ring-amber-500/30"
                        : dot === "buy"
                          ? "bg-positive"
                          : dot === "sell"
                            ? "bg-negative"
                            : "bg-muted-foreground/50",
                    )}
                  />
                  {!isLast ? (
                    <div className="w-px flex-1 bg-border mt-1" />
                  ) : null}
                </div>

                {/* ── Body ──────────────────────────────────────────── */}
                <div
                  className={cn(
                    "flex-1 min-w-0 space-y-1",
                    !isLast && "pb-4",
                    isCurrentRun &&
                      "rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 -ml-2 mb-1",
                  )}
                >
                  {/* Top row: Date (left, xs mono) · Price (right). The
                      price is the quote at the moment the event was
                      recorded; hidden when the writing path had none. The
                      old up/down arrow (delta vs the previous logged event)
                      is gone — with sparse price coverage it read as random
                      decoration (principal feedback 2026-08-19). */}
                  {(() => {
                    const priceStr = fmtUsd(u.priceAtTime);
                    return (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                          {fmtDateTime(u.timestamp)}
                        </span>
                        {priceStr ? (
                          <span className="text-sm font-medium tabular-nums">
                            {priceStr}
                          </span>
                        ) : null}
                      </div>
                    );
                  })()}

                  {/* Outcome chip + summary (heading) */}
                  <p className="text-sm font-medium leading-snug">
                    {chip ? (
                      <span className="mr-1.5 inline-flex align-middle">
                        <Badge variant={chip.variant}>{chip.label}</Badge>
                      </span>
                    ) : null}
                    {u.summary}
                  </p>

                  {/* Exact from → to lines: levels, composite, ladder diff */}
                  {changeLines.length > 0 ? (
                    <div className="space-y-0.5">
                      {changeLines.map((line, i) => (
                        <p
                          key={i}
                          className="text-xs font-mono tabular-nums text-muted-foreground"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {/* The principal's written note on a declined proposal */}
                  {userNote ? (
                    <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-border pl-2">
                      “{userNote}”
                    </p>
                  ) : null}

                  {/* Rationale (description) */}
                  {rationale ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {rationale}
                    </p>
                  ) : null}

                  {/* Footer: Type · TriggerId chip · View run · Signals */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    {isCurrentRun ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400 font-medium">
                        <span className="size-1 rounded-full bg-amber-500 animate-pulse" />
                        in this run
                      </span>
                    ) : null}
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
                    {u.runId && !isCurrentRun ? (
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
                    {u.tradeId ? (
                      <>
                        <span className="opacity-40">·</span>
                        <Link
                          href={`/trades/${u.tradeId}`}
                          className="hover:text-foreground underline-offset-4 hover:underline"
                        >
                          View trade
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
