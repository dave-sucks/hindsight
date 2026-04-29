"use client";

/**
 * TranscriptCard — segment analog of ThesisCard.
 *
 * Clickable card surface that opens a Sheet with the full transcript
 * (TranscriptSheetBody). Same ergonomics as ThesisCard:
 *   - Top header with podcast/segment context + duration + citation count
 *   - Truncated preview of the spoken script
 *   - Click anywhere → Sheet slides in with full content
 *
 * Used by:
 *   - TranscriptCardRenderer (chat output of write_segment_transcript)
 *   - TranscriptRow (run-page Transcript tab)
 *   - PodcastDetailClient right rail (recent transcripts)
 */

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Mic, Clock, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  TranscriptSheetBody,
  formatDuration,
} from "@/components/agent/sheets/TranscriptSheet";
import type { TranscriptCardData } from "@/components/agent/sheets/TranscriptSheet";

export type { TranscriptCardData };

export type TranscriptCardProps = ComponentProps<typeof Card> &
  TranscriptCardData & {
    /** Optional override for the SheetTrigger surface (e.g. a row component). */
    customTrigger?: React.ReactElement;
  };

export function TranscriptCard({
  title,
  plainText,
  durationSec,
  wordCount,
  citations,
  segmentName,
  podcastName,
  audioUrl,
  status,
  customTrigger,
  className,
  transcriptId: _transcriptId,
  ...cardProps
}: TranscriptCardProps) {
  const words = wordCount ?? plainText.split(/\s+/).filter(Boolean).length;
  const previewLine = plainText
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(" ");

  // Card surface — used as the SheetTrigger (analyst ThesisCard pattern).
  const cardContent = (
    <Card
      className={cn(
        "overflow-hidden p-0 gap-0 cursor-pointer transition-colors hover:border-foreground/25",
        className,
      )}
      {...cardProps}
    >
      {/* Header strip */}
      <div className="px-3 py-2 w-full border-b bg-muted flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Mic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-brand font-semibold text-foreground truncate leading-tight">
              {title}
            </span>
            {(podcastName || segmentName) && (
              <span className="text-[10px] text-muted-foreground truncate leading-tight">
                {[podcastName, segmentName].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {status && status !== "READY" && (
            <Badge variant="outline" className="text-[10px]">
              {status}
            </Badge>
          )}
          <Badge variant="secondary" className="tabular-nums">
            <Clock className="h-3 w-3" />
            {formatDuration(durationSec)}
          </Badge>
        </div>
      </div>

      {/* Body — preview + meta */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-sm font-light text-muted-foreground leading-relaxed line-clamp-2">
          {previewLine}
          <span className="text-foreground/50 ml-1">&hellip; read more</span>
        </p>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
          <span>{words} words</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {citations.length} citation{citations.length === 1 ? "" : "s"}
          </span>
          {audioUrl && (
            <>
              <span>·</span>
              <span>audio ready</span>
            </>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <Sheet>
      <SheetTrigger render={customTrigger ?? cardContent} />
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">{title}</SheetTitle>
        </SheetHeader>
        <TranscriptSheetBody
          title={title}
          plainText={plainText}
          durationSec={durationSec}
          wordCount={words}
          citations={citations}
          segmentName={segmentName}
          podcastName={podcastName}
          audioUrl={audioUrl}
          status={status}
        />
      </SheetContent>
    </Sheet>
  );
}
