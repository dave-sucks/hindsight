"use client";

import Link from "next/link";
import { ArrowLeft, FileText, Layers, Mic, Settings } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { PodcastDetail } from "@/lib/actions/podcast.actions";

function formatRelativeDays(date: Date | null): string {
  if (!date) return "Never run";
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function SegmentRow({
  podcastId,
  segment,
}: {
  podcastId: string;
  segment: PodcastDetail["segments"][number];
}) {
  const minutes = Math.round(segment.targetSeconds / 60);
  return (
    <Link
      href={`/podcasts/${podcastId}/segments/${segment.id}`}
      className="block group"
    >
      <Card className="p-3 group-hover:bg-muted/20 transition-colors shadow-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-medium truncate">{segment.name}</h3>
              {!segment.enabled && (
                <Badge variant="outline" className="text-[10px]">
                  Disabled
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {segment.lastTranscriptTitle ?? segment.description ?? "No runs yet"}
            </p>
            {segment.topics.length > 0 && (
              <p className="text-[10px] text-muted-foreground/80 mt-1 truncate">
                {segment.topics.slice(0, 5).join(" · ")}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-muted-foreground tabular-nums shrink-0">
            <div>~{minutes}m</div>
            <div className="text-[10px]">{formatRelativeDays(segment.lastRunAt)}</div>
            <div className="text-[10px] text-muted-foreground/70">
              {segment.transcriptCount} transcript{segment.transcriptCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function PodcastDetailClient({
  detail,
}: {
  detail: PodcastDetail;
}) {
  return (
    <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" render={<Link href="/podcasts" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">{detail.name}</h1>
          {detail.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
              {detail.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          {detail.segments.length} segment{detail.segments.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <Mic className="h-3.5 w-3.5" />
          {detail.hostStyle ?? "Default voice"}
        </span>
        <span className="flex items-center gap-1.5">
          {detail.cadence ?? "On demand"}
        </span>
      </div>

      <Tabs defaultValue={0} className="w-full">
        <TabsList>
          <TabsTrigger value={0}>Segments</TabsTrigger>
          <TabsTrigger value={1}>Episodes</TabsTrigger>
          <TabsTrigger value={2}>Settings</TabsTrigger>
        </TabsList>

        <TabsContent value={0} className="space-y-2 mt-4">
          {detail.segments.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
              No segments yet. Add one from the Segments tab inside the builder.
            </Card>
          ) : (
            detail.segments.map((s) => (
              <SegmentRow key={s.id} podcastId={detail.id} segment={s} />
            ))
          )}
        </TabsContent>

        <TabsContent value={1} className="mt-4">
          <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
            <FileText className="h-5 w-5 mx-auto mb-2 text-muted-foreground/60" />
            Episode assembly is Phase 3 — coming after audio synthesis.
          </Card>
        </TabsContent>

        <TabsContent value={2} className="mt-4 space-y-3">
          <Card className="p-4 shadow-none">
            <div className="flex items-center gap-2 mb-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Show settings</h3>
            </div>
            <dl className="text-sm grid grid-cols-2 gap-y-2 gap-x-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{detail.name}</dd>
              <dt className="text-muted-foreground">Cadence</dt>
              <dd>{detail.cadence ?? "Not set"}</dd>
              <dt className="text-muted-foreground">Host style</dt>
              <dd>{detail.hostStyle ?? "Not set"}</dd>
              <dt className="text-muted-foreground">Voice</dt>
              <dd>{detail.voiceId ?? "Phase 2"}</dd>
            </dl>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
