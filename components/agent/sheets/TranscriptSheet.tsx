"use client";

/**
 * TranscriptSheet — segment analog of ThesisSheet.
 *
 * Same exports shape:
 *   - TranscriptSheetBody: raw content (no Sheet wrapper). Used by TranscriptCard.
 *   - TranscriptSheet: controlled Sheet wrapping the body — used when opening
 *     programmatically without a card trigger.
 *
 * The transcript is the segment-run output (mirror of Thesis for analysts).
 * Body shows the spoken script + citation chips inline so each cited claim
 * is clickable to its source.
 */

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Mic, Clock, FileText, ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TranscriptCitation = {
  claim: string;
  url: string;
  quote?: string;
  startChar: number;
  endChar: number;
  signalId?: string | null;
  artifactId?: string | null;
};

export type TranscriptCardData = {
  /** Required so the chat-side renderer can resolve open-by-id later. */
  transcriptId?: string | null;
  title: string;
  plainText: string;
  /** Spoken duration estimate, in seconds. */
  durationSec?: number | null;
  /** Approx word count, derived from plainText if not provided. */
  wordCount?: number | null;
  citations: TranscriptCitation[];
  /** Optional — surfaced if the row knows its segment/podcast names. */
  segmentName?: string | null;
  podcastName?: string | null;
  /** TTS audio URL (Phase 2). */
  audioUrl?: string | null;
  status?: "DRAFT" | "READY" | "SYNTHESIZING" | "AUDIO_READY" | "FAILED";
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// ─── Body ─────────────────────────────────────────────────────────────────────

export function TranscriptSheetBody({
  title,
  plainText,
  durationSec,
  wordCount,
  citations,
  segmentName,
  podcastName,
  status,
}: TranscriptCardData) {
  const words = wordCount ?? plainText.split(/\s+/).filter(Boolean).length;

  // Build citation index map by sorted startChar so we can render the
  // transcript with inline citation markers in the right places.
  const sortedCitations = [...citations]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.startChar - b.c.startChar);

  // Render plainText with citation chips inserted at each citation.endChar.
  // Walks through the text segments between citations and emits a chip per
  // citation. The chip number indexes back into the citations array as
  // displayed below.
  const segments: Array<{ kind: "text"; text: string } | { kind: "cite"; index: number; cite: TranscriptCitation }> = [];
  let cursor = 0;
  for (const { c, i } of sortedCitations) {
    if (c.endChar > cursor && c.endChar <= plainText.length) {
      segments.push({ kind: "text", text: plainText.slice(cursor, c.endChar) });
      segments.push({ kind: "cite", index: i + 1, cite: c });
      cursor = c.endChar;
    }
  }
  if (cursor < plainText.length) {
    segments.push({ kind: "text", text: plainText.slice(cursor) });
  } else if (segments.length === 0) {
    // Fallback: no in-range citations — render plainText as-is.
    segments.push({ kind: "text", text: plainText });
  }

  return (
    <div className="px-4 pb-6 space-y-4">
      {/* Header strip — meta */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          <Mic className="h-3 w-3" />
          {podcastName && <span>{podcastName}</span>}
          {podcastName && segmentName && <span>·</span>}
          {segmentName && <span>{segmentName}</span>}
          {status && status !== "READY" && (
            <Badge variant="outline" className="text-[10px]">
              {status}
            </Badge>
          )}
        </div>
        <h2 className="text-base font-brand font-semibold leading-tight">
          {title}
        </h2>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(durationSec)}
          </span>
          <span>·</span>
          <span>{words} words</span>
          <span>·</span>
          <span>
            {citations.length} citation{citations.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Transcript body with inline citation chips */}
      <div className="rounded-md border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
        {segments.map((s, idx) =>
          s.kind === "text" ? (
            <span key={idx}>{s.text}</span>
          ) : (
            <a
              key={idx}
              href={s.cite.url}
              target="_blank"
              rel="noreferrer"
              title={s.cite.claim}
              className="inline-flex items-center justify-center mx-0.5 px-1.5 rounded bg-muted text-muted-foreground hover:text-foreground hover:bg-accent text-[10px] font-medium tabular-nums align-middle"
            >
              [{s.index}]
            </a>
          ),
        )}
      </div>

      {/* Citations list */}
      {citations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            Citations
          </p>
          <ol className="space-y-2">
            {citations.map((c, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground tabular-nums shrink-0 mt-0.5">
                    [{i + 1}]
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground line-clamp-2">{c.claim}</p>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground mt-0.5"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{safeHostname(c.url)}</span>
                    </a>
                    {c.quote && (
                      <p className="text-muted-foreground/80 italic line-clamp-2 mt-0.5">
                        &ldquo;{c.quote}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ─── Controlled Sheet wrapper ─────────────────────────────────────────────────

interface TranscriptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: TranscriptCardData | null;
}

export function TranscriptSheet({ open, onOpenChange, data }: TranscriptSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">
            {data?.title ?? "Transcript"}
          </SheetTitle>
        </SheetHeader>
        {data && <TranscriptSheetBody {...data} />}
      </SheetContent>
    </Sheet>
  );
}

export { formatDuration };
