"use client";

/**
 * ThesisTimelineSection — the thesis audit log, rendered inside the
 * ThesisSheet Activity tab (P1-33 slice 1). `RecentActivity` below is the
 * Overview's list: the stock's newest 8 Activity lines, the same 8 the
 * agents are handed, in the same row design, and a View all that opens the
 * tab. The tab marks where those 8 end.
 *
 * Lazy-fetches /api/theses/:id/updates: the stock's feed, the saved lines
 * plus each proposal's steps from its order (lib/thesis/activity-feed.ts).
 * Everything decision-shaped is pure and lives in thesis-timeline-utils:
 * buildTimeline assembles the list, toRow() maps every item into ONE shape,
 * and this file renders that shape a single way. No per-type branches here.
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

import { SectionLabel } from "@/components/domain/section-label";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Ban, ChevronsUpDown, Plus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiEditingIcon } from "@hugeicons/core-free-icons";
import { NOTED_ITEMS, RECENT_ITEMS } from "@/lib/thesis/activity-feed";
import { PriceChange } from "@/components/ui/price-change";
import {
  buildTimeline,
  itemTimestamp,
  groupLabels,
  proposalSpanSegments,
  dropRepeatedProse,
  toRow,
  isPlainReview,
  reviewTitle,
  withPriceChanges,
  type LadderChange,
  type DotKind,
  type TimelineFilter,
  type TimelineItem,
  type TimelineRow,
  type TimelineUpdate,
  type TitleTrigger,
} from "@/components/agent/sheets/thesis-timeline-utils";

// When the sheet opens from a run-detail page (/runs/[id]), entries whose
// runId matches the URL get the "edited-in-this-run" treatment.
function useCurrentRunId(): string | null {
  const pathname = usePathname();
  if (!pathname) return null;
  const match = pathname.match(/^\/runs\/([^/]+)/);
  return match?.[1] ?? null;
}

/** The principal's run-link arrow (their SVG, currentColor). */
function RunArrow() {
  return (
    <svg
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

/**
 * Sub-metadata: ladder rung changes as solid muted badges — the shared
 * Badge in its `muted` variant with squared corners, matching the
 * thesis trigger chips. Icon carries the kind: + added, × removed,
 * ↻ edited, ⊘ asked for and not applied. Capped so a long list of ops
 * can't wall the row.
 */
function LadderBadges({ changes }: { changes: LadderChange[] }) {
  const shown = changes.slice(0, 4);
  const rest = changes.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      {shown.map((c, i) => (
        <Badge key={i} variant="muted" shape="rounded">
          {c.kind === "add" ? (
            <Plus />
          ) : c.kind === "remove" ? (
            <X />
          ) : c.kind === "not-applied" ? (
            <Ban />
          ) : (
            <RefreshCw />
          )}
          {c.text}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="muted" shape="rounded">
          +{rest} more
        </Badge>
      ) : null}
    </div>
  );
}

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "money", label: "Money" },
  { value: "triggers", label: "Triggers" },
];

const SOURCE_LABELS: Record<string, string> = {
  ROUTED_SIGNAL: "a routed signal",
  WEB_SEARCH: "web search",
  WATCHLIST_REVIEW: "a watchlist review",
  POSITION_REVIEW: "a position review",
  USER_ADDED: "a manual add",
  BUILDER_SEED: "analyst setup",
  EDITOR_SEED: "editor chat",
};

interface Props {
  thesisId: string;
  /** Where this thesis came from. Folded into the Created row rather than
   * rendered as its own differently-styled footer (principal, 2026-08-21). */
  provenance?: { sourceKind: string; rationale: string | null } | null;
  /** The ids of the newest 8 lines, the ones on the Overview: the tab marks where they end. */
  recentIds?: string[];
  /** The thesis's triggers, inherited rules included: a review's title names the one it answered. */
  triggers?: ReadonlyArray<TitleTrigger>;
}

/** Every Activity line an item covers, so a row can be matched against the Overview's 8. */
function itemIds(item: TimelineItem): string[] {
  if (item.kind === "event") return [item.row.id];
  return item.items.flatMap(itemIds);
}

/**
 * Assemble → unfold what the principal opened → map to row shapes. One
 * pipeline for the tab and the Overview's Recent activity, so the same line
 * reads the same way in both.
 */
function assembleRows(updates: TimelineUpdate[], filter: TimelineFilter, open: Set<string>, provenance: Props["provenance"], triggers?: ReadonlyArray<TitleTrigger>) {
  const built = buildTimeline(updates, filter);
  const items = built.flatMap((item) => {
    // Keep the fold row itself when expanded: the only control that can collapse the group again.
    if (item.kind === "fold" && open.has(toRow(item).key)) return [item, ...item.items];
    return [item];
  });
  // Today / Yesterday / This week / the month, where the period changes.
  const labels = groupLabels(items.map(itemTimestamp));
  const rows = withPriceChanges(
    dropRepeatedProse(items.map(toRow)).map((r) => {
      if (r.type !== "CREATED" || !provenance) return r;
      const via = SOURCE_LABELS[provenance.sourceKind] ?? provenance.sourceKind;
      const sourced = `Sourced via ${via}.${provenance.rationale ? ` ${provenance.rationale}` : ""}`;
      return { ...r, description: r.description ? `${r.description} ${sourced}` : sourced };
    }),
  );
  // A plain review (a run looked and left the plan alone) is titled "Review";
  // everything that happened keeps its own title. Every row has a title line,
  // so the paragraph always sits under it, never beside the price and the actions.
  const titled = rows.map((r, i) => {
    const item = items[i];
    return item.kind === "event" && isPlainReview(item.row) ? { ...r, title: reviewTitle(item.row, triggers) } : r;
  });
  const ids = items.map(itemIds);
  return { rows: titled, spans: proposalSpanSegments(items), labels, ids };
}

/**
 * A label inside the rail (a period, or where the newest 8 end), so the
 * line runs through it from the row above to the row below.
 */
function RailLabel({ text, connected, span, pad }: { text: string; connected: boolean; span: boolean; pad: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0 w-1.5">
        {connected ? (
          span ? (
            <div className="w-0 flex-1 border-l border-dashed border-foreground/40" />
          ) : (
            <div className="w-px flex-1 bg-foreground/15" />
          )
        ) : null}
      </div>
      <p className={cn("text-xs text-muted-foreground", pad)}>{text}</p>
    </div>
  );
}

/** The list, drawn one way for the tab and the Overview: the period labels and the newest-8 mark sit inside the rail. */
function TimelineList({
  rows,
  spans,
  labels,
  recentEnd = -1,
  currentRunId,
  open,
  onToggle,
}: {
  rows: TimelineRow[];
  spans: Set<number>;
  labels: (string | null)[];
  recentEnd?: number;
  currentRunId: string | null;
  open: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div>
      {rows.map((row, idx) => (
        <Fragment key={row.key}>
          {labels[idx] ? <RailLabel text={labels[idx]} connected={idx > 0} span={spans.has(idx - 1)} pad="pb-2" /> : null}
          <Row
            row={row}
            isLast={idx === rows.length - 1}
            span={spans.has(idx)}
            pulse={currentRunId != null && row.runId === currentRunId}
            open={open.has(row.key)}
            onToggle={() => onToggle(row.key)}
          />
          {idx === recentEnd && idx < rows.length - 1 ? <RailLabel text={RECENT_END_LABEL} connected span={spans.has(idx)} pad="pb-4" /> : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The Overview's Agent insights: the stock's newest 5 Activity lines with a
 * written paragraph (`notedItems`, lib/thesis/activity-feed.ts), assembled
 * and drawn exactly as the Activity tab draws them. The heading carries the
 * first period ("Agent insights · Today") in place of the list's first rail
 * label, and says on hover what the agents read instead: the newest 8
 * lines, note or not, the ones the Activity tab marks.
 */
export function RecentActivity({ items, triggers, onViewAll }: { items: TimelineUpdate[]; triggers?: ReadonlyArray<TitleTrigger>; onViewAll: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const currentRunId = useCurrentRunId();
  const { rows, spans, labels } = useMemo(() => assembleRows(items, "all", open, null, triggers), [items, open, triggers]);
  if (items.length === 0) return null;
  const [first, ...rest] = labels;
  return (
    <div className="space-y-3">
      <SectionLabel action={<Button size="xs" variant="outline" onClick={onViewAll}>View all</Button>}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-help items-center gap-1.5">
                <HugeiconsIcon icon={AiEditingIcon} className="size-3.5" />
                Agent insights{first ? ` · ${first}` : ""}
              </span>
            }
          />
          <TooltipContent>The newest {NOTED_ITEMS} lines with a note. The agents read the newest {RECENT_ITEMS} lines, note or not, as the Activity tab marks them.</TooltipContent>
        </Tooltip>
      </SectionLabel>
      <TimelineList
        rows={rows}
        spans={spans}
        labels={[null, ...rest]}
        currentRunId={currentRunId}
        open={open}
        onToggle={(key) =>
          setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
      />
    </div>
  );
}

/** The line the tab draws under the newest 8, where the agent's read ends. */
export const RECENT_END_LABEL = "The newest 8 end here: the agent's read.";

export function ThesisTimelineSection({ thesisId, provenance, recentIds, triggers }: Props) {
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

  // Assemble → unfold anything the principal opened → map to row shapes,
  // and find the last row that carries one of the Overview's 8.
  const { rows, spans, labels, recentEnd } = useMemo(() => {
    if (!updates) return { rows: [], spans: new Set<number>(), labels: [] as (string | null)[], recentEnd: -1 };
    const { rows, spans, labels, ids } = assembleRows(updates, filter, open, provenance, triggers);
    const recent = new Set(recentIds ?? []);
    let recentEnd = -1;
    ids.forEach((list, i) => {
      if (list.some((id) => recent.has(id))) recentEnd = i;
    });
    return { rows, spans, labels, recentEnd };
  }, [updates, filter, open, provenance, recentIds, triggers]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
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
        <TimelineList rows={rows} spans={spans} labels={labels} recentEnd={recentEnd} currentRunId={currentRunId} open={open} onToggle={toggle} />
      )}
    </div>
  );
}

/**
 * One row, drawn one way (the owner's design, 2026-10-30):
 *   - line one, always a title: what happened (a fire, a proposal, a trade,
 *     your edit, your note, a plan change), or "Review" for a run that
 *     looked and left the plan alone; a row with no paragraph under it is
 *     drawn light, in the paragraph's colour, so the rows with words stand out;
 *   - the right of line one: the price then, with its move from the row
 *     before it in the page header's arrow and colours, at the timestamp's
 *     size; on hover the time, the run link and the expand control take its
 *     place (the period labels carry the time the rest of the way);
 *   - under it, the paragraph, two lines until opened;
 *   - opened: the whole paragraph, then what changed (the trigger chips).
 */
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
  // A row opens when it has more to show: the rest of its paragraph, what
  // changed, or a roll-up.
  const interactive = row.fold || row.description != null || row.chips.length > 0;
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
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-3">
          <p
            className={cn(
              "leading-snug min-w-0 text-sm",
              row.fold ? "text-muted-foreground" : "text-foreground",
              interactive && "cursor-pointer",
            )}
            onClick={interactive ? onToggle : undefined}
          >
            {row.title.primary ? (
              <span className="font-semibold">{row.title.primary} </span>
            ) : null}
            {row.title.secondary}
            {row.title.outcome ? (
              <span className="font-semibold"> {row.title.outcome}</span>
            ) : null}
          </p>

          {/* Right rail: the price then with its move from the row before;
              on hover it yields to the time and the actions (run link,
              expand). Room is kept for them so nothing is covered.
              No underline affordance on the title (principal, 2026-08-21). */}
          <span className="relative flex items-center shrink-0 h-5 sm:min-w-[11rem] sm:justify-end">
            {row.price != null ? (
              <span className="flex items-center gap-1.5 transition-opacity group-hover/row:opacity-0">
                <span className="text-xs tabular-nums text-muted-foreground">${row.price.toFixed(2)}</span>
                {row.priceChange ? (
                  <PriceChange dollarChange={row.priceChange.dollars} percentChange={row.priceChange.pct} size="xs" percentOnly />
                ) : null}
              </span>
            ) : null}
            <span className="absolute right-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <span className="text-xs tabular-nums text-muted-foreground px-1">{row.when}</span>
              {row.runId ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href={`/runs/${row.runId}`} />}
                  title="View run"
                >
                  <RunArrow />
                </Button>
              ) : null}
              {interactive ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={onToggle}
                  title={open ? "Collapse" : "Expand"}
                >
                  <ChevronsUpDown />
                </Button>
              ) : null}
            </span>
          </span>
        </div>

        {showDescription ? (
          <p
            className={cn(
              // The paragraph is the point of the row, so it reads in the foreground; the date groups and the price stay muted.
              "text-sm font-light text-foreground leading-relaxed cursor-pointer pt-0.5",
              row.quoted && "border-l-2 border-border pl-2",
              !open && "line-clamp-2",
            )}
            onClick={onToggle}
          >
            {row.quoted ? `“${row.description}”` : row.description}
          </p>
        ) : null}

        {/* What changed, under the paragraph, only once the row is open. */}
        {open && row.chips.length > 0 ? <LadderBadges changes={row.chips} /> : null}
      </div>
    </div>
  );
}
