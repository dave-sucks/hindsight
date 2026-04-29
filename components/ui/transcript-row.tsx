"use client";

/**
 * TranscriptRow — segment analog of ThesisRow.
 *
 * Compact list row for the run-page Transcript tab and the podcast detail
 * right-rail recent-transcripts list. Click → opens TranscriptCard's Sheet
 * via the customTrigger prop so the same Sheet body is reused.
 */

import { Mic, Clock, FileText } from "lucide-react";
import { TranscriptCard } from "@/components/domain/transcript-card";
import type { TranscriptCardData } from "@/components/agent/sheets/TranscriptSheet";
import { formatDuration } from "@/components/agent/sheets/TranscriptSheet";

export type TranscriptRowData = TranscriptCardData & {
  id?: string | null;
};

export function TranscriptRow({ transcript }: { transcript: TranscriptRowData }) {
  const words =
    transcript.wordCount ??
    transcript.plainText.split(/\s+/).filter(Boolean).length;

  const trigger = (
    <div className="group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors border-b last:border-0 cursor-pointer">
      <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
        <Mic className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{transcript.title}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {[transcript.podcastName, transcript.segmentName]
            .filter(Boolean)
            .join(" · ") || "Segment transcript"}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(transcript.durationSec)}
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {transcript.citations.length}
        </span>
        <span>{words}w</span>
      </div>
    </div>
  );

  return <TranscriptCard {...transcript} customTrigger={trigger} />;
}
