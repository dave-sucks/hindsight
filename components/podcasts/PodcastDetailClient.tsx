"use client";

/**
 * PodcastDetailClient — mirror of AnalystDetailClient.
 *
 * Same 3-col layout, same header style, same Tabs primitives. Segments
 * live as rows on this page using the analyst-card pattern: each segment
 * is a Card with a 3-dot dropdown carrying Run / Settings actions. There
 * is no per-segment page; the SegmentConfigSheet handles all editing.
 *
 * Transcripts are surfaced separately at the podcast level (Episodes
 * tab — Phase 3 will consolidate them into listenable episodes).
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  EllipsisVertical,
  FileText,
  Loader2,
  MoreHorizontal,
  Play,
  Settings2,
  Trash2,
} from "lucide-react";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import { cn } from "@/lib/utils";
import {
  deletePodcast,
  runSegment,
  type PodcastDetail,
  type SegmentSummary,
} from "@/lib/actions/podcast.actions";
import { PodcastConfigSheet } from "./PodcastConfigSheet";
import { SegmentConfigSheet } from "./SegmentConfigSheet";

function formatRelative(date: Date | null): string {
  if (!date) return "Never run";
  const ms = Date.now() - new Date(date).getTime();
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

// ── Segment card ────────────────────────────────────────────────────────────
// Matches the analyst card visual rhythm from /components/analysts/AnalystsPageClient.tsx:
// header row with badges + 3-dot dropdown, name, description, topics row,
// bottom border-t section with last-run info.

function SegmentCard({
  segment,
  onOpenSettings,
}: {
  segment: SegmentSummary;
  /** Receives the segment id so the parent can resolve fresh data after refetch. */
  onOpenSettings: (segmentId: string) => void;
}) {
  const router = useRouter();
  const [isStarting, startStarting] = useTransition();
  const minutes = Math.round(segment.targetSeconds / 60);

  const handleRun = () => {
    startStarting(async () => {
      try {
        const { runId } = await runSegment(segment.id);
        toast.success(`Running ${segment.name}`);
        router.push(`/runs/${runId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start run");
      }
    });
  };

  return (
    <Card className="gap-0 overflow-hidden shadow-none py-0">
      {/* Section 1: header, name, description */}
      <div className="p-3 flex flex-col gap-2 min-w-0">
        {/* Row 1: badges left · 3-dot right */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
              ~{minutes}m
            </span>
            {segment.monitors.length > 0 && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
                {segment.monitors.length} monitor{segment.monitors.length === 1 ? "" : "s"}
              </span>
            )}
            {!segment.enabled && (
              <Badge variant="outline" className="text-[10px]">
                Disabled
              </Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent/60 transition-colors text-muted-foreground shrink-0"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={handleRun} disabled={isStarting}>
                <Play className="h-3.5 w-3.5" />
                {isStarting ? "Starting…" : "Run segment"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenSettings(segment.id)}>
                <Settings2 className="h-3.5 w-3.5" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Row 2: name */}
        <h2 className="text-sm font-medium text-foreground leading-tight truncate">
          {segment.name}
        </h2>

        {/* Row 3: description / brief preview */}
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
          {segment.description ?? segment.segmentPrompt ?? (
            <span className="text-muted-foreground/60 not-italic">No brief set</span>
          )}
        </p>

        {/* Row 4: topics (optional) */}
        {segment.topics.length > 0 && (
          <p className="text-[11px] text-muted-foreground/80 truncate">
            {segment.topics.slice(0, 6).join(" · ")}
          </p>
        )}
      </div>

      {/* Section 2: footer — last run + transcript count */}
      <div className="border-t p-3 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {segment.lastTranscriptTitle ? (
            <span className="font-medium text-foreground line-clamp-1">
              {segment.lastTranscriptTitle}
            </span>
          ) : (
            <span>No runs yet</span>
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0 ml-3">
          <span>{segment.transcriptCount} transcript{segment.transcriptCount === 1 ? "" : "s"}</span>
          <span>·</span>
          <span>{formatRelative(segment.lastRunAt)}</span>
        </span>
      </div>
    </Card>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function PodcastDetailClient({
  detail,
}: {
  detail: PodcastDetail;
}) {
  const router = useRouter();
  const [configOpen, setConfigOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [runAllPending, startRunAll] = useTransition();
  // The settings sheet is launched per-segment from a card's 3-dot menu.
  // We track the active segment's id (not the object) so a refetch that
  // mutates detail.segments still resolves to the latest data via the
  // useMemo below. The Sheet itself is always mounted — see its props
  // at the bottom of this component.
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const activeSegment = useMemo(
    () =>
      activeSegmentId
        ? detail.segments.find((s) => s.id === activeSegmentId) ?? null
        : null,
    [activeSegmentId, detail.segments],
  );

  const segmentCount = detail.segments.length;
  const transcriptCount = detail.segments.reduce(
    (s, seg) => s + seg.transcriptCount,
    0,
  );
  const monitorCount = useMemo(
    () => detail.segments.reduce((s, seg) => s + seg.monitors.length, 0),
    [detail.segments],
  );

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      await deletePodcast(detail.id);
      toast.success("Podcast deleted");
      router.push("/podcasts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
      setDeleteLoading(false);
    }
  }

  const handleRunAll = () => {
    startRunAll(async () => {
      const enabled = detail.segments.filter((s) => s.enabled);
      if (enabled.length === 0) {
        toast.error("No enabled segments to run");
        return;
      }
      try {
        await Promise.all(enabled.map((s) => runSegment(s.id)));
        toast.success(`Started ${enabled.length} segment runs`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Some runs failed to start");
      }
    });
  };

  return (
    <>
      <div className="lg:grid lg:grid-cols-3 h-[calc(100dvh-3rem)] overflow-y-auto lg:overflow-hidden">
        {/* ── Left: main column ──────────────────────────────────────── */}
        <div className="lg:col-span-2 lg:h-full flex flex-col lg:min-h-0">
          {/* Header — mirrors AnalystDetailClient header */}
          <div className="flex items-start justify-between gap-4 p-4">
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-base font-brand font-semibold truncate">
                  {detail.name}
                </h1>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    detail.enabled ? "bg-positive" : "bg-muted-foreground/40",
                  )}
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {[
                  { label: "Segments", value: String(segmentCount) },
                  { label: "Transcripts", value: String(transcriptCount) },
                  { label: "Monitors", value: String(monitorCount) },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex gap-1 font-mono text-[11px] uppercase text-muted-foreground leading-tight"
                  >
                    <p className="tabular-nums">{value}</p>
                    <p>{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm">
                      <EllipsisVertical />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setConfigOpen(true)}>
                    <Settings2 className="h-3.5 w-3.5" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-negative focus:text-negative"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete podcast
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={handleRunAll} disabled={runAllPending || segmentCount === 0}>
                {runAllPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {runAllPending ? "Starting…" : "Run all"}
              </Button>
            </div>
          </div>

          {/* Tabs — main column body */}
          <Tabs defaultValue={0} className="flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="px-4">
              <TabsList>
                <TabsTrigger value={0}>Segments</TabsTrigger>
                <TabsTrigger value={1}>Episodes</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value={0}>
              {detail.segments.length === 0 ? (
                <div className="px-4 py-6">
                  <SkeletonCardStack
                    count={2}
                    title="No segments yet"
                    subtitle="Use the AI builder to add a segment, or rebuild this podcast from /podcasts/new."
                  />
                </div>
              ) : (
                <div className="w-full mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {detail.segments.map((s) => (
                    <SegmentCard
                      key={s.id}
                      segment={s}
                      onOpenSettings={setActiveSegmentId}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value={1}>
              <div className="px-4 py-6">
                <SkeletonCardStack
                  count={2}
                  title="Episodes are Phase 3"
                  subtitle="Once segments produce transcripts you'll be able to assemble them into a listenable episode here, with the full transcript consolidated per episode."
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <div className="p-4 lg:h-full">
          <div className="h-full rounded-xl border bg-background overflow-hidden flex flex-col">
            {/* Header strip — show meta */}
            <div className="px-3 py-3 border-b shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium">Show overview</p>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-3">
                {detail.description ?? "No description"}
              </p>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                <span className="rounded-full bg-muted px-1.5 py-0.5 uppercase tracking-wide">
                  {detail.cadence ?? "ON DEMAND"}
                </span>
                {detail.hostStyle && (
                  <span className="truncate">{detail.hostStyle}</span>
                )}
              </div>
            </div>

            {/* Recent transcripts list */}
            <div className="flex-1 overflow-y-auto">
              <RecentTranscriptsRail segments={detail.segments} />
            </div>
          </div>
        </div>
      </div>

      {/* Podcast-level settings sheet (header dropdown / right-rail button) */}
      <PodcastConfigSheet
        open={configOpen}
        onOpenChange={setConfigOpen}
        detail={detail}
      />

      {/* Per-segment settings sheet (card 3-dot menu).
          Always mounted so the Sheet's open animation fires correctly when
          the user toggles `open` from false to true. When no segment is
          selected the Sheet renders with an empty body but stays closed. */}
      <SegmentConfigSheet
        open={!!activeSegmentId}
        onOpenChange={(open) => {
          if (!open) setActiveSegmentId(null);
        }}
        segment={activeSegment}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete {detail.name}</DialogTitle>
            <DialogDescription>
              This will permanently delete this podcast, all its segments,
              all segment runs, and all transcripts. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
              className="gap-2"
            >
              {deleteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deleteLoading ? "Deleting…" : "Delete podcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Suppress unused-Link warning — Link is exported for callers that may
// surface a "Add segment" entry point in a follow-up.
void Link;

function RecentTranscriptsRail({ segments }: { segments: SegmentSummary[] }) {
  const recent = segments
    .filter((s) => s.lastTranscriptTitle && s.lastRunAt)
    .sort(
      (a, b) =>
        new Date(b.lastRunAt!).getTime() - new Date(a.lastRunAt!).getTime(),
    )
    .slice(0, 8);

  if (recent.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        <FileText className="h-4 w-4 mx-auto mb-2 text-muted-foreground/60" />
        No transcripts yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {recent.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 px-3 py-2.5 border-b last:border-0"
        >
          <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">
              {s.lastTranscriptTitle}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {s.name} · {formatRelative(s.lastRunAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
