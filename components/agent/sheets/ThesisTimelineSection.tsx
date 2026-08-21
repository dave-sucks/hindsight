"use client";

/**
 * ThesisTimelineSection — the thesis audit log, rendered inside the
 * ThesisSheet Activity tab (P1-33 slice 1).
 *
 * Lazy-fetches /api/theses/:id/updates; that endpoint merges ThesisUpdate
 * rows with proposal lifecycles read from the Order table. Everything
 * decision-shaped is pure and lives in thesis-timeline-utils: buildTimeline
 * assembles the list, toRow() maps every item into ONE shape, and this file
 * renders that shape a single way. No per-type branches here.
 *
 * The contract (principal spec, 2026-08-21):
 *   - Rows are text, not links. Clickable: the run arrow, and the title /
 *     description of a row that has prose (toggles clamp ↔ full). Fold rows
 *     (quiet clusters, ×N repeats) are controls in full.
 *   - Description is always max 2 lines until expanded; whether it shows
 *     before a click is a per-type constant (DESCRIPTION_VISIBLE).
 *   - Sub-metadata (ladder rung changes) is always visible, always chips.
 *     Scalar edits live in the title and are never repeated below it.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  buildTimeline,
  itemTimestamp,
  monthLabel,
  proposalSpanSegments,
  toRow,
  type DotKind,
  type TimelineFilter,
  type TimelineRow,
  type TimelineUpdate,
} from "@/components/agent/sheets/thesis-timeline-utils";

// When the sheet opens from a run-detail page (/runs/[id]), entries whose
// runId matches the URL get the "edited-in-this-run" treatment.
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

/**
 * Rail dot. Quiet base sits at foreground/15 so the money and open-ask
 * marks carry all the contrast.
 */
function Dot({ kind, pulse }: { kind: DotKind; pulse: boolean }) {
  return (
    <div
      className={cn(
        "size-1.5 rounded-full mt-1.5 shrink-0",
        pulse
          ? "bg-amber-500 animate-pulse ring-2 ring-amber-500/30"
          : kind === "buy"
            ? "bg-positive"
            : kind === "sell"
              ? "bg-negative"
              : kind === "declined"
                ? "bg-amber-500"
                : kind === "open-ask"
                  ? "bg-foreground animate-pulse [animation-duration:3s]"
                  : kind === "quiet"
                    ? "bg-transparent border border-foreground/15"
                    : "bg-foreground/15",
      )}
    />
  );
}

/** Sub-metadata: ladder rung changes. Always visible, always this shape. */
function Chips({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {lines.map((line, i) => {
        const added = line.startsWith("+ ");
        const removed = line.startsWith("− ");
        const text = added || removed ? line.slice(2) : line;
        return (
          <span
            key={i}
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-px text-[11px] font-light tabular-nums",
              added
                ? "border-positive/40 text-positive"
                : removed
                  ? "border-negative/40 text-negative line-through"
                  : "border-foreground/15 text-foreground/70",
            )}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "money", label: "Money" },
  { value: "triggers", label: "Triggers" },
];

interface Props {
  thesisId: string;
}

export function ThesisTimelineSection({ thesisId }: Props) {
  const [updates, setUpdates] = useState<TimelineUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Assemble → unfold anything the principal opened → map to row shapes.
  const { rows, spans, months } = useMemo(() => {
    if (!updates) return { rows: [], spans: new Set<number>(), months: [] as (string | null)[] };
    const built = buildTimeline(updates, filter);
    const items = built.flatMap((item) => {
      if (item.kind === "cluster" && open.has(`c:${itemTimestamp(item.items[0])}`))
        return item.items;
      if (item.kind === "repeat" && open.has(`r:${item.episodes[0].fire.id}`))
        return item.episodes;
      return [item];
    });
    const monthAt = items.map((item, i) => {
      const label = monthLabel(itemTimestamp(item));
      return i === 0 || label !== monthLabel(itemTimestamp(items[i - 1]))
        ? label
        : null;
    });
    return {
      rows: items.map(toRow),
      spans: proposalSpanSegments(items),
      months: monthAt,
    };
  }, [updates, filter, open]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Activity
        </p>
        <span className="flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="xs"
              variant={filter === f.value ? "secondary" : "ghost"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load activity: {error}
        </p>
      ) : updates == null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <div>
          {rows.map((row, idx) => (
            <Fragment key={row.key}>
              {months[idx] ? (
                <p className="text-xs font-light text-muted-foreground pb-2 pl-[19px]">
                  {months[idx]}
                </p>
              ) : null}
              <Row
                row={row}
                isLast={idx === rows.length - 1}
                span={spans.has(idx)}
                pulse={currentRunId != null && row.runId === currentRunId}
                open={open.has(row.key)}
                onToggle={() => toggle(row.key)}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  isLast,
  span,
  pulse,
  open,
  onToggle,
}: {
  row: TimelineRow;
  isLast: boolean;
  span: boolean;
  pulse: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  // A row is interactive when it has something more to show: prose to
  // expand, or a fold to unpack. Everything else is plain text.
  const interactive = row.fold || row.description != null;
  const showDescription = row.description != null && (open || row.showDescription);

  return (
    <div className="group/row flex gap-3">
      {/* Rail: dot + connector. Segments inside an open proposal span
          render brighter and dashed. */}
      <div className="flex flex-col items-center shrink-0">
        <Dot kind={row.dot} pulse={pulse} />
        {!isLast ? (
          span ? (
            <div className="w-0 flex-1 mt-1 border-l border-dashed border-foreground/40" />
          ) : (
            <div className="w-px flex-1 mt-1 bg-foreground/15" />
          )
        ) : null}
      </div>

      <div className={cn("flex-1 min-w-0", !isLast && "pb-4")}>
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              "text-sm leading-snug min-w-0",
              row.fold ? "text-muted-foreground" : "text-foreground",
              interactive &&
                "cursor-pointer hover:underline underline-offset-4 decoration-foreground/30",
            )}
            onClick={interactive ? onToggle : undefined}
          >
            {row.title.primary ? (
              <span className="font-medium">{row.title.primary} </span>
            ) : null}
            {row.title.secondary ? (
              <span
                className={cn(
                  "font-light",
                  row.fold ? "text-muted-foreground" : "text-foreground/80",
                )}
              >
                {row.title.secondary}
              </span>
            ) : null}
            {row.title.outcome ? (
              <span className="font-medium"> {row.title.outcome}</span>
            ) : null}
          </p>

          <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
            {row.runId ? (
              <Link
                href={`/runs/${row.runId}`}
                className="opacity-0 group-hover/row:opacity-100 transition-opacity hover:text-foreground"
                title="View run"
              >
                <RunArrow />
              </Link>
            ) : null}
            <span className="text-xs font-light tabular-nums">
              {row.rangeLabel ?? (row.timestamp ? fmtDateTime(row.timestamp) : "")}
            </span>
          </span>
        </div>

        {row.chips.length > 0 ? <Chips lines={row.chips} /> : null}

        {showDescription ? (
          <p
            className={cn(
              "text-sm font-light text-foreground/80 leading-relaxed cursor-pointer pt-0.5",
              row.quoted && "border-l-2 border-foreground/15 pl-2",
              !open && "line-clamp-2",
            )}
            onClick={onToggle}
          >
            {row.quoted ? `“${row.description}”` : row.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
