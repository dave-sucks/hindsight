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
 * Visual language (principal spec, iterated 2026-08-20/21):
 *   - Two-tone one-line titles; NO badges, NO footers, NO price stamps.
 *   - A trigger episode is ONE sentence: fire + decision —
 *     "Trigger: Price above $255 — passed". Identical consecutive
 *     episodes fold into a single ×N line (the re-fire wall).
 *   - Meaningful rows (your declines, updates, creates, closes) show
 *     their description clamped to 2 lines; everything else shows it
 *     only on click. Clicking any row toggles the full body.
 *   - Quiet runs (Reviewed-no-changes, housekeeping fires) fold into one
 *     whisper row; proposal lifecycles string amber from Proposed to
 *     outcome; month headers; All · Money · Triggers filter.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  buildTimeline,
  clusterLabel,
  scalarChangeLines,
  ladderChangeLines,
  groupTitle,
  itemTimestamp,
  monthLabel,
  proposalSpanSegments,
  proposalUserMessage,
  railDot,
  repeatRange,
  titleSegments,
  type GroupItem,
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

/** Rows whose description earns default visibility (clamped to 2 lines).
 * Everything else is title-only until clicked. */
const VISIBLE_BODY_TYPES = new Set([
  "PROPOSAL_REJECTED", // your note
  "UPDATED", // the analyst changed something — say why
  "CREATED",
  "INVALIDATED",
  "CLOSED",
]);

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

function TwoToneTitle({
  segments,
  suffix,
}: {
  segments: TitleSegments;
  suffix?: string;
}) {
  return (
    <p className="text-sm leading-snug min-w-0 text-foreground">
      <span className="font-medium">{segments.primary}</span>
      {segments.secondary ? (
        <span className="font-light text-foreground/80"> {segments.secondary}</span>
      ) : null}
      {segments.outcome ? (
        <span className="font-medium"> {segments.outcome}</span>
      ) : null}
      {suffix ? (
        <span className="font-light text-muted-foreground"> {suffix}</span>
      ) : null}
    </p>
  );
}

/**
 * Rail dots (principal palette, 2026-08-21): the quiet base is
 * foreground @15% so money and proposal moments carry all the contrast —
 * green bought / red sold / amber didn't-trade, and a WHITE slow-pulsing
 * dot on Proposed (an open ask for the principal's attention).
 */
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
                  ? "bg-foreground animate-pulse [animation-duration:3s]"
                  : dot === "quiet"
                    ? "bg-transparent border border-foreground/15"
                    : "bg-foreground/15",
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

/** Body for one row. Collapsed: note/rationale clamped to 2 lines.
 * Expanded: exact diffs + rung chips + the full prose. */
function Body({ row, open }: { row: TimelineUpdate; open: boolean }) {
  const userNote = proposalUserMessage(row);
  const rationale =
    row.rationale && row.rationale !== userNote ? row.rationale : null;
  const scalarLines = open ? scalarChangeLines(row) : [];
  const rungLines = open ? ladderChangeLines(row) : [];
  if (!userNote && !rationale && scalarLines.length === 0) return null;
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
        <p
          className={cn(
            "text-sm font-light text-foreground/80 leading-relaxed border-l-2 border-border pl-2",
            !open && "line-clamp-2",
          )}
        >
          “{userNote}”
        </p>
      ) : null}
      {rationale ? (
        <p
          className={cn(
            "text-sm font-light text-foreground/80 leading-relaxed",
            !open && "line-clamp-2",
          )}
        >
          {rationale}
        </p>
      ) : null}
    </div>
  );
}

/** Right side of a header row: hover run-arrow · light timestamp. */
function RightRail({ runId, label }: { runId: string | null; label: string }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
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
      <span className="text-xs font-light tabular-nums">{label}</span>
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

  // Assemble: filter → nest → dedupe repeats → cluster quiet; expanded
  // repeats/clusters unfold in place.
  const items = useMemo(() => {
    if (!updates) return [];
    const built = buildTimeline(updates, filter);
    const out: TimelineItem[] = [];
    for (const item of built) {
      if (item.kind === "cluster" && expanded.has(clusterId(item)))
        out.push(...item.items);
      else if (item.kind === "repeat" && expanded.has(repeatId(item)))
        out.push(...item.episodes);
      else out.push(item);
    }
    return out;
  }, [updates, filter, expanded]);

  const amberSegments = useMemo(() => proposalSpanSegments(items), [items]);

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
              idx === 0 ||
              monthLabel(ts) !== monthLabel(itemTimestamp(items[idx - 1]));
            const span = amberSegments.has(idx);

            return (
              <Fragment key={itemKey(item)}>
                {showMonth ? (
                  <p className="text-xs font-light text-muted-foreground pb-2 pl-[19px]">
                    {monthLabel(ts)}
                  </p>
                ) : null}
                {item.kind === "cluster" ? (
                  <QuietRow
                    label={clusterLabel(item.items).label}
                    range={clusterLabel(item.items).range}
                    isLast={isLast}
                    span={span}
                    onClick={() => toggle(clusterId(item))}
                  />
                ) : item.kind === "repeat" ? (
                  <RepeatRow
                    item={item}
                    isLast={isLast}
                    span={span}
                    onClick={() => toggle(repeatId(item))}
                  />
                ) : item.kind === "group" ? (
                  <GroupRow
                    item={item}
                    isLast={isLast}
                    span={span}
                    pulse={
                      currentRunId != null &&
                      (item.fire.runId === currentRunId ||
                        item.response.runId === currentRunId)
                    }
                    open={expanded.has(item.fire.id)}
                    onToggle={() => toggle(item.fire.id)}
                  />
                ) : (
                  <EventRow
                    row={item.row}
                    isLast={isLast}
                    span={span}
                    pulse={
                      currentRunId != null && item.row.runId === currentRunId
                    }
                    open={expanded.has(item.row.id)}
                    onToggle={() => toggle(item.row.id)}
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
  if (item.kind === "repeat") return repeatId(item);
  return clusterId(item);
}

function repeatId(item: Extract<TimelineItem, { kind: "repeat" }>): string {
  return `r:${item.episodes[0].fire.id}`;
}

function clusterId(item: Extract<TimelineItem, { kind: "cluster" }>): string {
  const first = item.items[0];
  return `c:${first.kind === "group" ? first.fire.id : (first as { row: TimelineUpdate }).row.id}`;
}

/**
 * The vertical connector under a row. Base is a hairline at foreground
 * @15%; segments inside a proposal's open span (Proposed → decision)
 * render as a brighter DASHED line so the ask-in-flight reads as one
 * strung-together episode.
 */
function Rail({
  children,
  isLast,
  span,
}: {
  children: React.ReactNode;
  isLast: boolean;
  span: boolean;
}) {
  return (
    <div className="flex flex-col items-center shrink-0">
      {children}
      {!isLast ? (
        span ? (
          <div className="w-0 flex-1 mt-1 border-l border-dashed border-foreground/40" />
        ) : (
          <div className="w-px flex-1 mt-1 bg-foreground/15" />
        )
      ) : null}
    </div>
  );
}

function EventRow({
  row,
  isLast,
  span,
  pulse,
  open,
  onToggle,
}: {
  row: TimelineUpdate;
  isLast: boolean;
  span: boolean;
  pulse: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const showBody = open || VISIBLE_BODY_TYPES.has(row.type);
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} span={span}>
        <DotEl dot={railDot(row)} pulse={pulse} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onToggle}
      >
        <div className="flex items-baseline justify-between gap-3">
          <TwoToneTitle segments={titleSegments(row)} />
          <RightRail runId={row.runId} label={fmtDateTime(row.timestamp)} />
        </div>
        {showBody ? <Body row={row} open={open} /> : null}
      </div>
    </div>
  );
}

function GroupRow({
  item,
  isLast,
  span,
  pulse,
  open,
  onToggle,
}: {
  item: GroupItem;
  isLast: boolean;
  span: boolean;
  pulse: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} span={span}>
        {/* An episode that staged a proposal carries the white
            open-ask dot and anchors the dashed span to its outcome. */}
        <DotEl dot={item.proposal ? "proposed" : null} pulse={pulse} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onToggle}
      >
        <div className="flex items-baseline justify-between gap-3">
          <TwoToneTitle
            segments={groupTitle(item.fire, item.response, item.proposal)}
          />
          <RightRail
            runId={item.fire.runId ?? item.response.runId}
            label={fmtDateTime(item.fire.timestamp)}
          />
        </div>
        {open ? <Body row={item.response} open /> : null}
      </div>
    </div>
  );
}

function RepeatRow({
  item,
  isLast,
  span,
  onClick,
}: {
  item: Extract<TimelineItem, { kind: "repeat" }>;
  isLast: boolean;
  span: boolean;
  onClick: () => void;
}) {
  const first = item.episodes[0];
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} span={span}>
        <DotEl dot={null} pulse={false} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onClick}
      >
        <div className="flex items-baseline justify-between gap-3">
          <TwoToneTitle
            segments={groupTitle(first.fire, first.response)}
            suffix={`×${item.episodes.length}`}
          />
          <span className="text-xs font-light tabular-nums text-muted-foreground shrink-0">
            {repeatRange(item.episodes)}
          </span>
        </div>
      </div>
    </div>
  );
}

function QuietRow({
  label,
  range,
  isLast,
  span,
  onClick,
}: {
  label: string;
  range: string;
  isLast: boolean;
  span: boolean;
  onClick: () => void;
}) {
  return (
    <div className="group/row flex gap-3">
      <Rail isLast={isLast} span={span}>
        <DotEl dot="quiet" pulse={false} />
      </Rail>
      <div
        className={cn("flex-1 min-w-0 cursor-pointer", !isLast && "pb-4")}
        onClick={onClick}
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
