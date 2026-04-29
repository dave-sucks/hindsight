"use client";

/**
 * TranscriptCardRenderer — ui: "transcript-card"
 *
 * Mirror of ThesisCardRenderer, simpler shape because segments produce
 * exactly one transcript per run (analysts produce many theses). Reads
 * the write_segment_transcript tool call's args + result, builds a
 * TranscriptCardData, renders TranscriptCard. Click → opens Sheet with
 * full transcript + citations.
 */

import { useMemo } from "react";
import { useMessage } from "@assistant-ui/react";
import type { ToolResult } from "@/lib/agent/tool-result";
import {
  TranscriptCard,
  type TranscriptCardData,
} from "@/components/domain/transcript-card";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  toolName: string;
  toolCallId?: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function TranscriptCardRenderer({ toolCallId, loading }: Props) {
  const content = useMessage((m) => m.content);

  const transcriptParts = useMemo(() => {
    return (content as unknown[])
      .map((p) => p as Record<string, unknown>)
      .filter(
        (p) =>
          p?.type === "tool-call" && p.toolName === "write_segment_transcript",
      );
  }, [content]);

  // Only the first transcript call in a message renders. Defensive — segments
  // produce one per run, but a retry loop could call it twice; keep the first
  // surfaced output and let the second silently no-op (the second saved row
  // takes precedence in the DB upsert path anyway).
  const myIndex = transcriptParts.findIndex((p) => p.toolCallId === toolCallId);
  if (myIndex > 0) return null;

  const part = transcriptParts[0];
  const partResult = part?.result ?? part?.output;
  const isReady = partResult !== undefined;

  if (!isReady && loading) {
    return (
      <div className="my-2">
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    );
  }

  if (!part) return null;

  // Build TranscriptCardData from the tool's input args (always present on
  // tool-call parts, mirror of how ThesisCardRenderer builds ThesisCardData).
  const inputArgs = (part.args ?? part.input ?? {}) as Record<string, unknown>;
  const resultData =
    partResult && typeof partResult === "object"
      ? (partResult as Record<string, unknown>).ok === true &&
        (partResult as Record<string, unknown>).data
        ? ((partResult as Record<string, unknown>).data as Record<string, unknown>)
        : (partResult as Record<string, unknown>)
      : {};

  const title =
    (inputArgs.title as string) ?? (resultData.title as string) ?? "Untitled segment";
  const plainText = (inputArgs.plainText as string) ?? "";
  const citations =
    (inputArgs.citations as TranscriptCardData["citations"]) ??
    (resultData.citations as TranscriptCardData["citations"]) ??
    [];
  const durationSec =
    (inputArgs.durationSec as number | undefined) ??
    (resultData.durationSec as number | undefined) ??
    null;
  const wordCount =
    (resultData.wordCount as number | undefined) ??
    (plainText ? plainText.split(/\s+/).filter(Boolean).length : 0);
  const transcriptId = (resultData.transcriptId as string | undefined) ?? null;

  if (!plainText) return null;

  const data: TranscriptCardData = {
    transcriptId,
    title,
    plainText,
    citations,
    durationSec,
    wordCount,
    status: "READY",
  };

  return (
    <div className="my-2">
      <TranscriptCard {...data} />
    </div>
  );
}
