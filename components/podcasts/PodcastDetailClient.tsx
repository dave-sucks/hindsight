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
  Pencil,
  Play,
  Settings2,
  Trash2,
} from "lucide-react";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import { cn } from "@/lib/utils";
import {
  deletePodcast,
  runSegment,
  type EpisodeListItem,
  type PodcastDetail,
  type SegmentSummary,
} from "@/lib/actions/podcast.actions";
import { PodcastConfigSheet } from "./PodcastConfigSheet";
import { SegmentConfigSheet } from "./SegmentConfigSheet";
import { PodcastFindingsTab } from "./PodcastFindingsTab";
import { AssembleEpisodeDialog } from "./AssembleEpisodeDialog";
import { TranscriptDialog } from "@/components/agent/sheets/TranscriptSheet";
import { TranscriptRow, type TranscriptRowData } from "@/components/ui/transcript-row";

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

function SegmentCard({ segment }: { segment: SegmentSummary }) {
  const router = useRouter();
  const [isStarting, startStarting] = useTransition();
  // Each card owns its own settings Sheet — local state, controlled by
  // the dropdown item's onClick. Local state means the Sheet is mounted
  // from the start (closed), and the open animation fires when state
  // flips false→true. Same shape the shadcn Sheet docs recommend:
  // https://ui.shadcn.com/docs/components/radix/sheet
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Latest-transcript dialog — opened from the 3-dot menu when there is one,
  // and from clicking the footer "last transcript" line. Reuses TranscriptDialog
  // which is the same Dialog primitive surface as BriefDetailDialog.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const minutes = Math.round(segment.targetSeconds / 60);
  const latest = segment.latestTranscript;

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
    <>
      <Card className="gap-0 overflow-hidden shadow-none py-0">
      {/* Section 1: header, name, description */}
      <div className="p-3 flex flex-col gap-2 min-w-0">
        {/* Row 1: badges left · 3-dot right */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
              ~{minutes}m
            </span>
            {(() => {
              const total = segment.domainMonitors.length + segment.searchMonitors.length;
              return total > 0 ? (
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
                  {total} monitor{total === 1 ? "" : "s"}
                </span>
              ) : null;
            })()}
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
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleRun} disabled={isStarting}>
                <Play className="h-3.5 w-3.5" />
                {isStarting ? "Starting…" : "Run segment"}
              </DropdownMenuItem>
              {latest && (
                <DropdownMenuItem onClick={() => setTranscriptOpen(true)}>
                  <FileText className="h-3.5 w-3.5" />
                  View latest transcript
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
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

      {/* Section 2: footer — last run + transcript count.
          Clicking the title (when there is a latest transcript) opens the
          TranscriptDialog. Whole footer stays read-only otherwise. */}
      <div className="border-t p-3 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span className="min-w-0 flex-1">
          {latest ? (
            <button
              type="button"
              onClick={() => setTranscriptOpen(true)}
              className="font-medium text-foreground line-clamp-1 hover:underline text-left"
            >
              {segment.lastTranscriptTitle}
            </button>
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

    {/* Per-segment settings sheet — co-located with its trigger.
        Mounts with open=false on first render; the dropdown item's
        onClick flips it to true. Standard shadcn Sheet pattern. */}
    <SegmentConfigSheet
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      segment={segment}
    />

    {/* Latest transcript Dialog — same Dialog surface as BriefDetailDialog. */}
    <TranscriptDialog
      open={transcriptOpen}
      onOpenChange={setTranscriptOpen}
      data={latest}
    />
    </>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function PodcastDetailClient({
  detail,
  episodes = [],
}: {
  detail: PodcastDetail;
  episodes?: EpisodeListItem[];
}) {
  const router = useRouter();
  const [configOpen, setConfigOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [assembleOpen, setAssembleOpen] = useState(false);
  const [runAllPending, startRunAll] = useTransition();
  // Per-segment settings sheets live inside each SegmentCard with their
  // own local state — that's the canonical shadcn Sheet pattern (Sheet
  // co-located with its trigger).

  const segmentCount = detail.segments.length;
  const transcriptCount = detail.segments.reduce(
    (s, seg) => s + seg.transcriptCount,
    0,
  );
  const monitorCount = useMemo(
    () =>
      detail.segments.reduce(
        (s, seg) => s + seg.domainMonitors.length + seg.searchMonitors.length,
        0,
      ),
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
        const runIds: string[] = [];
        for (const s of enabled) {
          const { runId } = await runSegment(s.id);
          runIds.push(runId);
        }
        // Navigate to the first run so AgentThread can drive it.
        // Remaining runs need manual navigation to execute — each run
        // requires an AgentThread on /runs/[id] to stream the agent.
        router.push(`/runs/${runIds[0]}`);
        if (runIds.length > 1) {
          toast.info(
            `${runIds.length} runs created. Open the remaining ${runIds.length - 1} segment${runIds.length - 1 === 1 ? "" : "s"} individually to start them.`,
          );
        }
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
                  <DropdownMenuItem
                    onClick={() => router.push(`/podcasts/${detail.id}/edit`)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit with AI
                  </DropdownMenuItem>
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
                <TabsTrigger value={2}>Findings</TabsTrigger>
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
                    <SegmentCard key={s.id} segment={s} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value={1}>
              <EpisodesTab
                episodes={episodes}
                podcastId={detail.id}
                hasReadyTranscripts={detail.segments.some(
                  (s) =>
                    s.latestTranscript &&
                    (s.latestTranscript.status === "READY" ||
                      s.latestTranscript.status === "AUDIO_READY"),
                )}
                onAssemble={() => setAssembleOpen(true)}
              />
            </TabsContent>

            <TabsContent value={2}>
              <div className="px-4 py-6">
                <PodcastFindingsTab podcastId={detail.id} />
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

      {/* Assemble-episode dialog — opened from the Episodes tab CTA. */}
      <AssembleEpisodeDialog
        podcast={detail}
        open={assembleOpen}
        onOpenChange={setAssembleOpen}
      />

      {/* Per-segment settings sheets live inside each SegmentCard, not here. */}

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

function formatDurationShort(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function EpisodesTab({
  episodes,
  podcastId,
  hasReadyTranscripts,
  onAssemble,
}: {
  episodes: EpisodeListItem[];
  podcastId: string;
  hasReadyTranscripts: boolean;
  onAssemble: () => void;
}) {
  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {episodes.length === 0
            ? "No episodes assembled yet."
            : `${episodes.length} episode${episodes.length === 1 ? "" : "s"} assembled.`}
        </p>
        <Button
          size="sm"
          onClick={onAssemble}
          disabled={!hasReadyTranscripts}
          title={hasReadyTranscripts ? undefined : "Run a segment to produce a ready transcript first."}
        >
          <FileText className="h-3.5 w-3.5" />
          Assemble episode
        </Button>
      </div>

      {episodes.length === 0 ? (
        <SkeletonCardStack
          count={2}
          title="Text-only assembly"
          subtitle="Pick ready transcripts, set the order, and assemble into one viewable episode. Audio assembly is Phase 2."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {episodes.map((e) => (
            <Link key={e.id} href={`/podcasts/${podcastId}/episodes/${e.id}`} className="block">
              <Card className="p-4 hover:border-foreground/25 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={e.status === "READY" ? "secondary" : "outline"}>
                    {e.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {new Date(e.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="text-sm font-medium leading-tight line-clamp-2 mb-1">
                  {e.title}
                </h3>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>{e.transcriptCount} segment{e.transcriptCount === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{formatDurationShort(e.durationSec)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentTranscriptsRail({ segments }: { segments: SegmentSummary[] }) {
  const recent = segments
    .filter((s) => s.latestTranscript && s.lastRunAt)
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
      {recent.map((s) => {
        const data: TranscriptRowData = {
          ...(s.latestTranscript as TranscriptRowData),
          id: s.latestTranscript?.transcriptId ?? null,
        };
        return <TranscriptRow key={s.id} transcript={data} />;
      })}
    </div>
  );
}
