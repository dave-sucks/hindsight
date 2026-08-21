"use client";

/**
 * ThesisTimelineSection — the thesis audit log, rendered inside the
 * ThesisSheet Activity tab (P1-33 slice 1).
 *
 * Lazy-fetches /api/theses/:id/updates when mounted. That endpoint merges
 * ThesisUpdate rows with proposal outcomes read from the Order table (the
 * source of truth for approve / reject / expire).
 *
 * Visual language (principal spec, 2026-08-20 — no badges, no footers):
 *   ●  Bought 10 shares at $832.84          ↪ Aug 12, 11:50 PM
 *   │  <subhead: rationale, light @80%, clamped to 2 lines — click expands>
 *
 *   - Title is one consistent sentence in two tones: the core event
 *     (medium) + its variable values (light). Grammar lives in
 *     thesis-timeline-utils.titleSegments — stored summaries are never
 *     rendered verbatim.
 *   - Rail dot carries money semantics: green bought, red sold, amber for
 *     proposals that didn't trade. Amber pulse = this run.
 *   - Timestamp far right, light; the run link is an arrow icon that
 *     appears on row hover, left of the timestamp.
 *   - Reviewed rows show no body until clicked.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  titleSegments,
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

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The principal's run-link arrow (their SVG, currentColor). */
function RunArrow() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M13 6H8.5C6.01472 6 4 8.01472 4 10.5C4 12.9853 6.01472 15 8.5 15H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 12C17 12 20 14.2095 20 15C20 15.7906 17 18 17 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  thesisId: string;
}

export function ThesisTimelineSection({ thesisId }: Props) {
  const [updates, setUpdates] = useState<TimelineUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
            const title = titleSegments(u);
            const dot = railDot(u);
            const isOpen = expanded.has(u.id);
            const userNote = proposalUserMessage(u);
            // The synthesized reject row's rationale IS the user note —
            // don't render the same text twice.
            const rationale =
              u.rationale && u.rationale !== userNote ? u.rationale : null;
            const changeLines = isOpen ? fieldChangeLines(u) : [];
            // Reviewed rows are pure noise until asked — no body collapsed.
            const quietWhenCollapsed = u.type === "REVIEWED";
            const showBody = isOpen || !quietWhenCollapsed;
            const hasBody =
              rationale != null || userNote != null || (isOpen && changeLines.length > 0);

            return (
              <div key={u.id} className="group/row flex gap-3">
                {/* ── Rail (dot + line) ─────────────────────────────── */}
                <div className="flex flex-col items-center shrink-0">
                  {/* Money semantics: green bought, red sold, amber for a
                      proposal that didn't trade. Current-run pulse wins. */}
                  <div
                    className={cn(
                      "size-1.5 rounded-full mt-1.5",
                      isCurrentRun
                        ? "bg-amber-500 animate-pulse ring-2 ring-amber-500/30"
                        : dot === "buy"
                          ? "bg-positive"
                          : dot === "sell"
                            ? "bg-negative"
                            : dot === "proposal"
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40",
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
                  {/* Header row: two-tone title left · [run arrow on
                      hover] + timestamp far right. */}
                  <div
                    className="flex items-baseline justify-between gap-3 cursor-pointer"
                    onClick={() => toggle(u.id)}
                  >
                    <p className="text-sm leading-snug min-w-0 text-foreground">
                      <span className="font-medium">{title.primary}</span>
                      {title.secondary ? (
                        <span className="font-light text-foreground/80">
                          {" "}
                          {title.secondary}
                        </span>
                      ) : null}
                    </p>
                    <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                      {u.runId ? (
                        <Link
                          href={`/runs/${u.runId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover/row:opacity-100 transition-opacity hover:text-foreground"
                          title="View run"
                        >
                          <RunArrow />
                        </Link>
                      ) : null}
                      <span className="text-xs font-light tabular-nums">
                        {fmtDateTime(u.timestamp)}
                      </span>
                    </span>
                  </div>

                  {/* Subhead: light @80%, clamped to 2 lines until clicked.
                      Reviewed rows render nothing until expanded. */}
                  {showBody && hasBody ? (
                    <div
                      className="cursor-pointer space-y-1"
                      onClick={() => toggle(u.id)}
                    >
                      {isOpen && changeLines.length > 0 ? (
                        <div className="space-y-0.5">
                          {changeLines.map((line, i) => (
                            <p
                              key={i}
                              className="text-xs font-light tabular-nums text-foreground/80"
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {userNote ? (
                        <p
                          className={cn(
                            "text-sm font-light text-foreground/80 leading-relaxed border-l-2 border-border pl-2",
                            !isOpen && "line-clamp-2",
                          )}
                        >
                          “{userNote}”
                        </p>
                      ) : null}
                      {rationale ? (
                        <p
                          className={cn(
                            "text-sm font-light text-foreground/80 leading-relaxed",
                            !isOpen && "line-clamp-2",
                          )}
                        >
                          {rationale}
                        </p>
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
