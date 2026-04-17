"use client";

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
  /** When true, render inside a group block with no nested group header */
  inGroup?: boolean;
}

/**
 * GenericRenderer — the default tool row.
 *
 * Collapsed: single-line header (progressLabel) with a chevron.
 * Expanded: if the tool put a text body on `data.content`, render it as
 * plain pre-wrapped text styled the same as every other tool row body
 * (text-sm, muted-foreground). No markdown headers, no custom card —
 * matches the look of "Reading Morning Briefing" / "Reading Signals".
 * Falls back to a summary bullet when there's no content.
 */
export function GenericRenderer({ toolName, result, loading, inGroup }: Props) {
  const header = result.progressLabel ?? toolName;
  const data = result.data as Record<string, unknown> | null;
  const content = data && typeof data.content === "string" ? (data.content as string) : null;

  // Rich content → always expandable (even inside a group) so the user
  // can click to see exactly what the tool read.
  if (content) {
    return (
      <ToolProgress defaultOpen={false}>
        <ToolProgressHeader loading={loading}>{header}</ToolProgressHeader>
        <ToolProgressContent>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {content}
          </div>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  // No-content path inside a group — flat summary bullet.
  if (inGroup) {
    return <ToolProgressItem>{result.summary}</ToolProgressItem>;
  }

  // No-content solo path — expandable with just the summary inside.
  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{header}</ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{result.summary}</ToolProgressItem>
      </ToolProgressContent>
    </ToolProgress>
  );
}
