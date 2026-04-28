"use client";

/**
 * SegmentDetailClient — mirror of AnalystDetailClient.
 *
 * Same 3-col layout, same header style, same Tabs primitives, same
 * right-rail rhythm, same floating composer, same config sheet pattern.
 * The transcript IS the brief — rendered inline on Snapshot via the same
 * TickerMarkdown the analyst's brief uses.
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
  Pencil,
  Play,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { ChatEntryComposer } from "@/components/assistant-ui/chat-entry-composer";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import { cn } from "@/lib/utils";
import {
  runSegment,
  type SegmentDetail,
  type SegmentRunRow,
} from "@/lib/actions/podcast.actions";
import { SegmentConfigSheet } from "./SegmentConfigSheet";

function formatRelativeDays(date: Date | null): string {
  if (!date) return "—";
  const ms = Date.now() - new Date(date).getTime();
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function statusDotClass(status: string): string {
  if (status === "RUNNING") return "bg-amber-500 animate-pulse";
  if (status === "FAILED") return "bg-negative";
  if (status === "COMPLETE") return "bg-positive";
  return "bg-muted-foreground/40";
}

// ── Right-rail run row — visual rhythm matches analyst's TradeRow ─────────
function RunRailRow({ run }: { run: SegmentRunRow }) {
  return (
    <Link
      href={`/runs/${run.id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors border-b last:border-0"
    >
      <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0 relative">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background",
            statusDotClass(run.status),
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">
          {run.transcriptTitle ?? (run.status === "RUNNING" ? "Researching…" : "No transcript")}
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {formatRelativeDays(run.startedAt)}
          {run.durationSec != null && ` · ~${run.durationSec}s`}
        </p>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
        {run.citationCount} cites
      </span>
    </Link>
  );
}

// ── Snapshot — latest transcript inline (mirrors AnalystSnapshotSection) ──
function SnapshotSection({
  runs,
  segmentName,
}: {
  runs: SegmentRunRow[];
  segmentName: string;
}) {
  const latestWithTranscript = runs.find((r) => r.transcriptId);

  if (!latestWithTranscript) {
    return (
      <div className="px-4 py-6">
        <SkeletonCardStack
          count={2}
          title="No transcripts yet"
          subtitle={`Click Run segment to produce the first transcript for ${segmentName}.`}
        />
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-4 py-6 space-y-3">
      <div>
        <h3 className="text-sm font-medium">{latestWithTranscript.transcriptTitle}</h3>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatRelativeDays(latestWithTranscript.startedAt)}
          {latestWithTranscript.durationSec != null &&
            ` · ~${latestWithTranscript.durationSec}s`}
          {` · ${latestWithTranscript.citationCount} citations`}
        </p>
      </div>
      <Link
        href={`/runs/${latestWithTranscript.id}`}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Open full run →
      </Link>
    </div>
  );
}

// ── Transcripts tab — list of all transcripts as cards ────────────────────
function TranscriptsList({ runs }: { runs: SegmentRunRow[] }) {
  const transcriptRuns = runs.filter((r) => r.transcriptId);

  if (transcriptRuns.length === 0) {
    return (
      <div className="px-4 py-6">
        <SkeletonCardStack
          count={2}
          title="No transcripts"
          subtitle="Each segment run produces one transcript. Click Run segment to generate the first."
        />
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-4 py-6 space-y-2">
      {transcriptRuns.map((r) => (
        <Link key={r.id} href={`/runs/${r.id}`} className="block group">
          <div className="rounded-md border p-3 hover:bg-accent/40 transition-colors">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-medium truncate flex-1">
                {r.transcriptTitle}
              </h3>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                {formatRelativeDays(r.startedAt)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {r.durationSec != null && `~${r.durationSec}s · `}
              {r.citationCount} citations
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── Runs tab — every run, with status ─────────────────────────────────────
function RunsList({ runs }: { runs: SegmentRunRow[] }) {
  if (runs.length === 0) {
    return (
      <div className="px-4 py-6">
        <SkeletonCardStack
          count={2}
          title="No runs yet"
          subtitle="Click Run segment in the header to start one."
        />
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-4 py-6 space-y-2">
      {runs.map((r) => (
        <Link key={r.id} href={`/runs/${r.id}`} className="block group">
          <div className="rounded-md border p-3 hover:bg-accent/40 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  statusDotClass(r.status),
                )}
              />
              <Badge variant="outline" className="text-[10px]">
                {r.status}
              </Badge>
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {formatRelativeDays(r.startedAt)}
              </span>
            </div>
            <p className="text-sm font-medium truncate">
              {r.transcriptTitle ?? "(no transcript)"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── Floating composer ─────────────────────────────────────────────────────
function FloatingSegmentComposer({
  podcastId,
  segmentId,
}: {
  podcastId: string;
  segmentId: string;
}) {
  return (
    <ChatEntryComposer
      targetUrl={`/podcasts/${podcastId}/segments/${segmentId}/edit`}
      queryParam="message"
      features={{
        placeholder: "Ask a question or suggest changes to this segment…",
        slashCommands: true,
      }}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function SegmentDetailClient({
  detail,
}: {
  detail: SegmentDetail;
}) {
  const router = useRouter();
  const [configOpen, setConfigOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [isStarting, startStarting] = useTransition();

  const transcriptCount = detail.runs.filter((r) => r.transcriptId).length;
  const monitorCount = detail.monitors.length;

  const handleRun = () => {
    startStarting(async () => {
      try {
        const { runId } = await runSegment(detail.id);
        toast.success(`Running ${detail.name}`);
        router.push(`/runs/${runId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start run");
      }
    });
  };

  // Disable handler kept simple — segment-level delete lives on the podcast
  // page; this dialog is a placeholder for future per-segment delete.
  const handleDelete = async () => {
    setDeleteLoading(false);
    setDeleteOpen(false);
    toast.info("Per-segment delete is not wired up yet — delete the podcast to drop everything.");
  };

  return (
    <>
      <div className="lg:grid lg:grid-cols-3 h-[calc(100dvh-3rem)] overflow-y-auto lg:overflow-hidden">
        {/* ── Left ───────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 lg:h-full flex flex-col lg:min-h-0">
          {/* Header — breadcrumb + name + stats + actions */}
          <div className="flex items-start justify-between gap-4 p-4">
            <div className="flex flex-col items-start gap-1">
              <Link
                href={`/podcasts/${detail.podcastId}`}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                ← {detail.podcastName}
              </Link>
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
                  { label: "Runs", value: String(detail.runs.length) },
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
                    onClick={() =>
                      router.push(
                        `/podcasts/${detail.podcastId}/segments/${detail.id}/edit`,
                      )
                    }
                  >
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
                    Delete segment
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={handleRun} disabled={isStarting}>
                {isStarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {isStarting ? "Starting…" : "Run segment"}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue={0} className="flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="px-4">
              <TabsList>
                <TabsTrigger value={0}>Snapshot</TabsTrigger>
                <TabsTrigger value={1}>Transcripts</TabsTrigger>
                <TabsTrigger value={2}>Runs</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value={0}>
              <SnapshotSection runs={detail.runs} segmentName={detail.name} />
            </TabsContent>

            <TabsContent value={1}>
              <TranscriptsList runs={detail.runs} />
            </TabsContent>

            <TabsContent value={2}>
              <RunsList runs={detail.runs} />
            </TabsContent>
          </Tabs>

          {/* Floating composer */}
          <div className="hidden lg:block px-4 pb-4 shrink-0">
            <FloatingSegmentComposer
              podcastId={detail.podcastId}
              segmentId={detail.id}
            />
          </div>
        </div>

        {/* ── Right rail ───────────────────────────────────────────── */}
        <div className="p-4 lg:h-full">
          <div className="h-full rounded-xl border bg-background overflow-hidden flex flex-col">
            {/* Header strip — meta */}
            <div className="px-3 py-3 border-b shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium">Segment overview</p>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-3">
                {detail.description ?? "No description"}
              </p>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground tabular-nums">
                <span>~{Math.round(detail.targetSeconds / 60)}m target</span>
                <span>·</span>
                <span>
                  {detail.topics.length} topic{detail.topics.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Tabs — Runs | Monitors */}
            <Tabs defaultValue={0} className="flex-1 overflow-hidden">
              <div className="px-3 pt-2 shrink-0">
                <TabsList>
                  <TabsTrigger value={0}>Runs</TabsTrigger>
                  <TabsTrigger value={1}>Monitors</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value={0} className="flex-1 overflow-y-auto flex flex-col">
                {detail.runs.length === 0 ? (
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
                  detail.runs.map((r) => <RunRailRow key={r.id} run={r} />)
                )}
              </TabsContent>

              <TabsContent value={1} className="flex-1 overflow-y-auto">
                {detail.monitors.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    <Search className="h-4 w-4 mx-auto mb-2 text-muted-foreground/60" />
                    No monitors yet.
                    <br />
                    Add via the Settings sheet.
                  </div>
                ) : (
                  detail.monitors.map((m) => {
                    const cfg = (m.config as { query?: string } | null) ?? {};
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 px-3 py-2.5 border-b last:border-0"
                      >
                        <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Search className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{m.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {cfg.query ?? "(no query)"}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <SegmentConfigSheet open={configOpen} onOpenChange={setConfigOpen} detail={detail} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete segment?</DialogTitle>
            <DialogDescription>
              Per-segment delete is not wired up yet. To remove this segment,
              edit the podcast or delete the entire show.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLoading}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

