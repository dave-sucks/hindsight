"use client";

/**
 * ThesisTimelineSection — the thesis audit log, rendered inside the
 * ThesisSheet Activity tab (P1-33 slice 1).
 *
 * Lazy-fetches /api/theses/:id/updates when mounted; that endpoint merges
 * ThesisUpdate rows with proposal lifecycles read from the Order table.
 * All row logic is pure and lives in thesis-timeline-utils; this file only
 * renders the assembled TimelineItem list.
 *
 * Visual language (principal spec, 2026-08-20/21):
 *   - Two-tone titles (medium event + light values); NO badges, NO footers.
 *   - Every description is hidden until the row is clicked.
 *   - Fire → outcome nesting: a real trigger fire renders with its answer
 *     indented under it ("Trigger: Gives back 12% … ▸ Held — no changes").
 *   - Quiet runs (Reviewed-no-changes, housekeeping fires) fold into one
 *     whisper row; click expands in place.
 *   - Proposal lifecycles string together: hollow amber dot on Proposed,
 *     amber rail segments down to the Bought / Declined / Expired outcome.
 *   - Price stamp under the timestamp with a direction arrow vs the
 *     previous priced event. Month headers; All · Money · Triggers filter.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  buildTimeline,
  clusterLabel,
  fieldChangeLines,
  itemPrice,
  itemTimestamp,
  monthLabel,
  proposalSpanSegments,
  proposalUserMessage,
  railDot,
  responseVerb,
  titleSegments,
  type TimelineFilter,
  type TimelineItem,
  type TimelineUpdate,
  type TitleSegments,
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

function TwoToneTitle({ segments }: { segments: TitleSegments }) {
  return (
    <p className="text-sm leading-snug min-w-0 text-foreground">
      <span className="font-medium">{segments.primary}</span>
      {segments.secondary ? (
        <span className="font-light text-foreground/80"> {segments.secondary}</span>
      ) : null}
    </p>
  );
}

function DotEl({
  dot,
  pulse,
}: {
  dot: ReturnType<typeof railDot> | "quiet";
  pulse: boolean;
}) {
  return (
    <div
      className={cn(
        "size-1.5 rounded-full mt-1.5 shrink-0",
        pulse
          ? "bg-amber-500 animate-pulse ring-2 ring-amber-500/30"
          : dot === "buy"
            ? "bg-positive"
            : dot === "sell"
              ? "bg-negative"
              : dot === "proposal"
                ? "bg-amber-500"
                : dot === "proposed"
                  ? "bg-transparent border border-amber-500"
                  : dot === "quiet"
                    ? "bg-transparent border border-muted-foreground/40"
                    : "bg-muted-foreground/40",
      )}
    />
  );
}

/** Ladder-diff strings rendered as rung chips: + green, − red struck. */
function RungChips({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
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
                  : "border-border text-foreground/70",
            )}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}

/** Expanded body for one row: diff chips + note + rationale. */
function ExpandedBody({ row }: { row: TimelineUpdate }) {
  const lines = fieldChangeLines(row);
  const rungLines = lines.filter(
    (l) => l.startsWith("+ ") || l.startsWith("− ") || l.includes(" → Price") || / → .*→/.test(l),
  );
  const scalarLines = lines.filter((l) => !rungLines.includes(l));
  const userNote = proposalUserMessage(row);
  const rationale =
    row.rationale && row.rationale !== userNote ? row.rationale : null;
  return (
    <div className="space-y-1 pt-0.5">
      {scalarLines.length > 0 ? (
        <div className="space-y-0.5">
          {scalarLines.map((line, i) => (
            <p
              key={i}
              className="text-xs font-light tabular-nums text-foreground/80"
            >
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {rungLines.length > 0 ? <RungChips lines={rungLines} /> : null}
      {userNote ? (
        <p className="text-sm font-light text-foreground/80 leading-relaxed border-l-2 border-border pl-2">
          “{userNote}”
        </p>
      ) : null}
      {rationale ? (
        <p className="text-sm font-light text-foreground/80 leading-relaxed">
          {rationale}
        </p>
      ) : null}
    </div>
  );
}

/** Right side of a header row: hover run-arrow · timestamp · price stamp. */
function RightRail({
  runId,
  timestamp,
  price,
  prevPrice,
}: {
  runId: string | null;
  timestamp: string;
  price: number | null;
  prevPrice: number | null;
}) {
  const delta = price != null && prevPrice != null ? price - prevPrice : null;
  return (
    <span className="flex flex-col items-end shrink-0">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {runId ? (
          <Link
            href={`/runs/${runId}`}
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity hover:text-foreground"
            title="View run"
          >
            <RunArrow />
          </Link>
        ) : null}
        <span className="text-xs font-light tabular-nums">
          {fmtDateTime(timestamp)}
        </span>
      </span>
      {price != null ? (
        <span className="text-xs font-light tabular-nums text-muted-foreground flex items-center gap-0.5">
          ${price.toFixed(2)}
          {delta != null && delta !== 0 ? (
            delta > 0 ? (
              <ArrowUp className="h-3 w-3 text-positive" />
            ) : (
              <ArrowDown className="h-3 w-3 text-negative" />
            )
          ) : null}
        </span>
      ) : null}
    </span>
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

  // Assemble: filter → nest → cluster; expanded clusters unfold in place.
  const items = useMemo(() => {
    if (!updates) return [];
    const built = buildTimeline(updates, filter);
    const out: TimelineItem[] = [];
    for (const item of built) {
      if (item.kind === "cluster" && expanded.has(clusterId(item)))
        out.push(...item.items);
      else out.push(item);
    }
    return out;
  }, [updates, filter, expanded]);

  const amberSegments = useMemo(() => proposalSpanSegments(items), [items]);

  // Previous (older) priced item for each index — drives the arrows.
  const prevPriceAt = (idx: number): number | null => {
    for (let i = idx + 1; i < items.length; i++) {
      const p = itemPrice(items[i]);
      if (p != null) return p;
    }
    return null;
  };

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
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <div>
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            const ts = itemTimestamp(item);
            const showMonth =
              idx === 0 || monthLabel(ts) !== monthLabel(itemTimestamp(items[idx - 1]));
            const price = itemPrice(item);
            const prevPrice = price != null ? prevPriceAt(idx) : null;
            const lineClass = amberSegments.has(idx)
              ? "bg-amber-500/50"
              : "bg-border";

            return (
              <Fragment key={itemKey(item)}>
                {showMonth ? (
                  <p className="text-xs font-light text-muted-foreground pb-2 pl-[19px]">
                    {monthLabel(ts)}
                  </p>
                ) : null}

                {item.kind === "cluster" ? (
                  <ClusterRow
                    item={item}
                    isLast={isLast}
                    lineClass={lineClass}
                    onExpand={() => toggle(clusterId(item))}
                  />
                ) : item.kind === "group" ? (
                  <GroupRow
                    item={item}
                    isLast={isLast}
                    lineClass={lineClass}
                    pulse={
                      currentRunId != null &&
                      (item.fire.runId === currentRunId ||
                        item.response.runId === currentRunId)
                    }
                    open={expanded.has(item.fire.id)}
                    onToggle={() => toggle(item.fire.id)}
                    right={
                      <RightRail
                        runId={item.fire.runId ?? item.response.runId}
                        timestamp={item.fire.timestamp}
                        price={price}
                        prevPrice={prevPrice}
                      />
                    }
                  />
                ) : (
                  <EventRow
                    row={item.row}
                    isLast={isLast}
                    lineClass={lineClass}
                    pulse={currentRunId != null && item.row.runId === currentRunId}
                    open={expanded.has(item.row.id)}
                    onToggle={() => toggle(item.row.id)}
                    right={
                      <RightRail
                        runId={item.row.runId}
                        timestamp={item.row.timestamp}
                        price={price}
                        prevPrice={prevPrice}
                      />
                    }
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function itemKey(item: TimelineItem): string {
  if (item.kind === "event") return item.row.id;
  if (item.kind === "group") return `g:${item.fire.id}`;
  return clusterId(item);
}

function clusterId(item: Extract<TimelineItem, { kind: "cluster" }>): string {
  const first = item.items[0];
  return `c:${first.kind === "group" ? first.fire.id : (first as { row: TimelineUpdate }).row.id}`;
}

function Rail({
  children,
  isLast,
  lineClass,
}: {
  children: React.ReactNode;
  isLast: boolean;
  lineClass: string;
}) {
  return (
    <div className="flex flex-col items-center shrink-0">
      {children}
      {!isLast ? <div className={cn("w-px flex-1 mt-1", lineClass)} /> : null}
    </div>
  );
}

function EventRow({
  row,
  isLast,
  lineClass,
  pulse,
  open,
  onToggle,
  right,
}: {
  row: TimelineUpdate;
  isLast: boolean;
  lineClass: string;
  pulse: boolean;
  open: boolean;
  onToggle: () => void;
  right: React.ReactNode;
}) {
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} lineClass={lineClass}>
        <DotEl dot={railDot(row)} pulse={pulse} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onToggle}
      >
        <div className="flex items-baseline justify-between gap-3">
          <TwoToneTitle segments={titleSegments(row)} />
          {right}
        </div>
        {open ? <ExpandedBody row={row} /> : null}
      </div>
    </div>
  );
}

function GroupRow({
  item,
  isLast,
  lineClass,
  pulse,
  open,
  onToggle,
  right,
}: {
  item: Extract<TimelineItem, { kind: "group" }>;
  isLast: boolean;
  lineClass: string;
  pulse: boolean;
  open: boolean;
  onToggle: () => void;
  right: React.ReactNode;
}) {
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} lineClass={lineClass}>
        <DotEl dot={null} pulse={pulse} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onToggle}
      >
        <div className="flex items-baseline justify-between gap-3">
          <TwoToneTitle segments={titleSegments(item.fire)} />
          {right}
        </div>
        {/* The answer, indented under the fire. Verb is derived and
            consistent: Passed / Held / Raised floor / Archived. */}
        <div className="border-l-2 border-border/70 pl-2.5 mt-1 space-y-0.5">
          <TwoToneTitle segments={responseVerb(item.fire, item.response)} />
          {open ? <ExpandedBody row={item.response} /> : null}
        </div>
      </div>
    </div>
  );
}

function ClusterRow({
  item,
  isLast,
  lineClass,
  onExpand,
}: {
  item: Extract<TimelineItem, { kind: "cluster" }>;
  isLast: boolean;
  lineClass: string;
  onExpand: () => void;
}) {
  const { label, range } = clusterLabel(item.items);
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} lineClass={lineClass}>
        <DotEl dot="quiet" pulse={false} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onExpand}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm leading-snug min-w-0 font-light text-muted-foreground">
            {label}
          </p>
          <span className="text-xs font-light tabular-nums text-muted-foreground shrink-0">
            {range}
          </span>
        </div>
      </div>
    </div>
  );
}
