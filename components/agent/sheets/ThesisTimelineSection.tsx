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
import { ChevronsUpDown, Plus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildTimeline,
  itemTimestamp,
  monthLabel,
  proposalSpanSegments,
  relativeTimestamp,
  toRow,
  type LadderChange,
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
 * Badge in its `secondary` variant with squared corners, matching the
 * thesis trigger chips. Icon carries the kind: + added, × removed,
 * ↻ edited. Capped so a wholesale ladder rewrite can't wall the row.
 */
function LadderBadges({ changes }: { changes: LadderChange[] }) {
  const shown = changes.slice(0, 4);
  const rest = changes.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      {shown.map((c, i) => (
        <Badge key={i} variant="secondary" shape="rounded">
          {c.kind === "add" ? (
            <Plus />
          ) : c.kind === "remove" ? (
            <X />
          ) : (
            <RefreshCw />
          )}
          {c.text}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="secondary" shape="rounded">
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
}

export function ThesisTimelineSection({ thesisId, provenance }: Props) {
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
    const mapped = items.map(toRow).map((r) => {
      if (r.type !== "CREATED" || !provenance) return r;
      const via = SOURCE_LABELS[provenance.sourceKind] ?? provenance.sourceKind;
      const sourced = `Sourced via ${via}.${provenance.rationale ? ` ${provenance.rationale}` : ""}`;
      return {
        ...r,
        description: r.description ? `${r.description} ${sourced}` : sourced,
      };
    });
    return {
      rows: mapped,
      spans: proposalSpanSegments(items),
      months: monthAt,
    };
  }, [updates, filter, open, provenance]);

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
              "text-sm font-normal leading-snug min-w-0",
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

          {/* Right rail: the timestamp swaps for actions on row hover —
              run link + expand/collapse. No underline affordance on the
              title (principal, 2026-08-21). */}
          <span className="relative flex items-center shrink-0 h-5">
            <span
              className={cn(
                "text-xs font-light tabular-nums text-muted-foreground transition-opacity",
                (row.runId || interactive) && "group-hover/row:opacity-0",
              )}
            >
              {row.rangeLabel ?? (row.timestamp ? relativeTimestamp(row.timestamp) : "")}
            </span>
            <span className="absolute right-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
              {row.runId ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
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

        {row.chips.length > 0 ? <LadderBadges changes={row.chips} /> : null}

        {showDescription ? (
          <p
            className={cn(
              "text-sm font-light text-muted-foreground leading-relaxed cursor-pointer pt-0.5",
              row.quoted && "border-l-2 border-border pl-2",
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
