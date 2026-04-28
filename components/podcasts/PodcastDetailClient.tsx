"use client";

/**
 * PodcastDetailClient — mirror of AnalystDetailClient.
 *
 * Same 3-col layout, same header style, same Tabs primitives, same
 * right-rail rhythm, same floating composer pattern, same config sheet
 * pattern. Different content because podcasts aren't trading analysts.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Mic,
  Pencil,
  Play,
  Settings2,
  Trash2,
} from "lucide-react";
import { ChatEntryComposer } from "@/components/assistant-ui/chat-entry-composer";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import { cn } from "@/lib/utils";
import {
  deletePodcast,
  runSegment,
  type PodcastDetail,
  type SegmentSummary,
} from "@/lib/actions/podcast.actions";
import { PodcastConfigSheet } from "./PodcastConfigSheet";

function formatRelativeDays(date: Date | null): string {
  if (!date) return "Never run";
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

// ── Right-rail segment row ──────────────────────────────────────────────────
// Matches the visual rhythm of the analyst page's TradeRow / WatchlistRow:
// thin row, ticker-style logo on the left, name + meta in middle, action
// on the right. No new Card wrappers — the rail container provides the
// border, just like the trades list on the analyst page.

function SegmentRailRow({
  podcastId,
  segment,
}: {
  podcastId: string;
  segment: SegmentSummary;
}) {
  const router = useRouter();
  const [isStarting, startStarting] = useTransition();
  const minutes = Math.round(segment.targetSeconds / 60);

  const handleRun = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    <Link
      href={`/podcasts/${podcastId}/segments/${segment.id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors border-b last:border-0"
    >
      <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
        <Mic className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{segment.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {segment.lastTranscriptTitle ?? `~${minutes}m · ${segment.transcriptCount} transcripts`}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {formatRelativeDays(segment.lastRunAt)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRun}
          disabled={isStarting}
          aria-label="Run segment"
        >
          {isStarting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </Link>
  );
}

// ── Segments tab body (full list) ──────────────────────────────────────────
// Same visual language as the analyst page's positions list — full-width
// rows separated by border-b, click-through to detail.

function SegmentsList({
  podcastId,
  segments,
}: {
  podcastId: string;
  segments: SegmentSummary[];
}) {
  if (segments.length === 0) {
    return (
      <div className="px-4 py-6">
        <SkeletonCardStack
          count={2}
          title="No segments yet"
          subtitle="Use the AI chat below to add a segment, or rebuild from the builder."
        />
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-4 py-6 space-y-2">
      {segments.map((s) => (
        <Link
          key={s.id}
          href={`/podcasts/${podcastId}/segments/${s.id}`}
          className="block group"
        >
          <div className="flex items-start justify-between gap-3 rounded-md border p-3 hover:bg-accent/40 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium truncate">{s.name}</h3>
                {!s.enabled && (
                  <Badge variant="outline" className="text-[10px]">
                    Disabled
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                {s.lastTranscriptTitle ?? s.description ?? "No runs yet"}
              </p>
              {s.topics.length > 0 && (
                <p className="text-[10px] text-muted-foreground/80 mt-1 truncate">
                  {s.topics.slice(0, 5).join(" · ")}
                </p>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground tabular-nums shrink-0">
              <div>~{Math.round(s.targetSeconds / 60)}m</div>
              <div className="text-[10px]">{formatRelativeDays(s.lastRunAt)}</div>
              <div className="text-[10px] text-muted-foreground/70">
                {s.transcriptCount} transcript{s.transcriptCount === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── Floating composer (redirects to editor on send) ────────────────────────

function FloatingPodcastComposer({ podcastId }: { podcastId: string }) {
  return (
    <ChatEntryComposer
      targetUrl={`/podcasts/${podcastId}/edit`}
      queryParam="message"
      features={{
        placeholder: "Ask a question or suggest changes to the show…",
        slashCommands: true,
      }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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

  const segmentCount = detail.segments.length;
  const transcriptCount = detail.segments.reduce(
    (s, seg) => s + seg.transcriptCount,
    0,
  );
  const monitorCount = detail.segments.reduce(
    (s, seg) => s + seg.monitorCount,
    0,
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
        {/* ── Left: Podcast briefing area ──────────────────────────────── */}
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
                  <DropdownMenuItem onClick={() => router.push(`/podcasts/${detail.id}/edit`)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
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

          {/* Tabs */}
          <Tabs defaultValue={0} className="flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="px-4">
              <TabsList>
                <TabsTrigger value={0}>Segments</TabsTrigger>
                <TabsTrigger value={1}>Episodes</TabsTrigger>
                <TabsTrigger value={2}>Settings</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value={0}>
              <SegmentsList podcastId={detail.id} segments={detail.segments} />
            </TabsContent>

            <TabsContent value={1}>
              <div className="px-4 py-6">
                <SkeletonCardStack
                  count={2}
                  title="Episodes are Phase 3"
                  subtitle="Once segments produce transcripts you'll be able to assemble them into a listenable episode here."
                />
              </div>
            </TabsContent>

            <TabsContent value={2}>
              <div className="w-full mx-auto px-4 py-6 space-y-3">
                <div className="rounded-md border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">Show settings</h3>
                  </div>
                  <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2">
                    <dt className="text-muted-foreground">Name</dt>
                    <dd>{detail.name}</dd>
                    <dt className="text-muted-foreground">Cadence</dt>
                    <dd>{detail.cadence ?? "On demand"}</dd>
                    <dt className="text-muted-foreground">Host style</dt>
                    <dd>{detail.hostStyle ?? "Not set"}</dd>
                    <dt className="text-muted-foreground">Voice</dt>
                    <dd className="text-muted-foreground/70">Phase 2</dd>
                  </dl>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 -ml-2"
                    onClick={() => setConfigOpen(true)}
                  >
                    Open full settings
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Floating composer */}
          <div className="hidden lg:block px-4 pb-4 shrink-0">
            <FloatingPodcastComposer podcastId={detail.id} />
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <div className="p-4 lg:h-full">
          <div className="h-full rounded-xl border bg-background overflow-hidden flex flex-col">
            {/* Header strip — show meta */}
            <div className="px-3 py-3 border-b shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium">Show overview</p>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2">
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

            {/* Segments quick-run list (matches the analyst page Trades sidebar pattern) */}
            <Tabs defaultValue={0} className="flex-1 overflow-hidden">
              <div className="px-3 pt-2 shrink-0">
                <TabsList>
                  <TabsTrigger value={0}>Segments</TabsTrigger>
                  <TabsTrigger value={1}>Recent</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value={0} className="flex-1 overflow-y-auto flex flex-col">
                {detail.segments.length === 0 ? (
                  <div className="space-y-0 px-3 py-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5">
                        <div className="h-6 w-6 rounded-full bg-muted" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-2.5 w-16 rounded bg-muted" />
                          <div className="h-2 w-24 rounded bg-muted/60" />
                        </div>
                        <div className="h-2.5 w-12 rounded bg-muted" />
                      </div>
                    ))}
                  </div>
                ) : (
                  detail.segments.map((s) => (
                    <SegmentRailRow
                      key={s.id}
                      podcastId={detail.id}
                      segment={s}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value={1} className="flex-1 overflow-y-auto">
                <RecentTranscriptsRail segments={detail.segments} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <PodcastConfigSheet open={configOpen} onOpenChange={setConfigOpen} detail={detail} />

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
            <p className="text-xs font-medium truncate">{s.lastTranscriptTitle}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {s.name} · {formatRelativeDays(s.lastRunAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
