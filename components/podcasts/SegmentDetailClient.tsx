"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Play, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  runSegment,
  type SegmentDetail,
  type SegmentRunRow,
} from "@/lib/actions/podcast.actions";
import { SegmentMonitorEditor } from "./SegmentMonitorEditor";

function formatRelativeDays(date: Date | null): string {
  if (!date) return "—";
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function statusBadge(status: string) {
  if (status === "RUNNING") return <Badge>Running</Badge>;
  if (status === "COMPLETE") return <Badge variant="secondary">Complete</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function RunRow({ run }: { run: SegmentRunRow }) {
  return (
    <Link href={`/runs/${run.id}`} className="block group">
      <Card className="p-3 group-hover:bg-muted/20 transition-colors shadow-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {statusBadge(run.status)}
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatRelativeDays(run.startedAt)}
              </span>
            </div>
            <p className="text-sm font-medium truncate">
              {run.transcriptTitle ?? "No transcript"}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground tabular-nums shrink-0">
            {run.durationSec != null && <div>~{run.durationSec}s</div>}
            <div className="text-[10px]">
              {run.citationCount} citation{run.citationCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function SegmentDetailClient({ detail }: { detail: SegmentDetail }) {
  const router = useRouter();
  const [isStarting, startStarting] = useTransition();
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const handleRun = () => {
    startStarting(async () => {
      try {
        const { runId } = await runSegment(detail.id);
        toast.success("Run started");
        router.push(`/runs/${runId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start run");
      }
    });
  };

  const minutes = Math.round(detail.targetSeconds / 60);

  return (
    <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          render={<Link href={`/podcasts/${detail.podcastId}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            <Link href={`/podcasts/${detail.podcastId}`} className="hover:underline">
              {detail.podcastName}
            </Link>
          </p>
          <h1 className="text-xl font-semibold truncate">{detail.name}</h1>
        </div>
        <Button onClick={handleRun} disabled={isStarting}>
          {isStarting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isStarting ? "Starting…" : "Run segment"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>~{minutes} min target</span>
        <span>·</span>
        <span>{detail.topics.length} topic{detail.topics.length === 1 ? "" : "s"}</span>
        <span>·</span>
        <span>{detail.monitors.length} monitor{detail.monitors.length === 1 ? "" : "s"}</span>
      </div>

      <Tabs defaultValue={0} className="w-full">
        <TabsList>
          <TabsTrigger value={0}>Runs</TabsTrigger>
          <TabsTrigger value={1}>Brief</TabsTrigger>
          <TabsTrigger value={2}>Monitors</TabsTrigger>
        </TabsList>

        <TabsContent value={0} className="space-y-2 mt-4">
          {detail.runs.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
              No runs yet. Click <strong>Run segment</strong> to produce the first transcript.
            </Card>
          ) : (
            detail.runs.map((r) => <RunRow key={r.id} run={r} />)
          )}
        </TabsContent>

        <TabsContent value={1} className="mt-4 space-y-3">
          <Card className="p-4 shadow-none">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
              Editorial brief
            </h3>
            <p className={`text-sm whitespace-pre-wrap ${showFullPrompt ? "" : "line-clamp-6"}`}>
              {detail.segmentPrompt}
            </p>
            {detail.segmentPrompt.length > 320 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 -ml-2"
                onClick={() => setShowFullPrompt((v) => !v)}
              >
                {showFullPrompt ? "Show less" : "Show full brief"}
              </Button>
            )}
          </Card>

          <Card className="p-4 shadow-none">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
              Universe fence
            </h3>
            <dl className="text-sm grid grid-cols-[7rem_1fr] gap-y-2">
              <dt className="text-muted-foreground">Topics</dt>
              <dd>{detail.topics.length === 0 ? "—" : detail.topics.join(", ")}</dd>
              <dt className="text-muted-foreground">Sources</dt>
              <dd>{detail.sources.length === 0 ? "—" : detail.sources.join(", ")}</dd>
              <dt className="text-muted-foreground">Skip</dt>
              <dd>
                {detail.excludeTopics.length === 0 ? "—" : detail.excludeTopics.join(", ")}
              </dd>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value={2} className="mt-4">
          <SegmentMonitorEditor
            segmentId={detail.id}
            podcastId={detail.podcastId}
            initialMonitors={detail.monitors}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
