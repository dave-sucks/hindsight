"use client";

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";
import { Markdown } from "@/components/ui/markdown";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
  /** When true, render a flat ToolProgressItem — group supplies the wrapper */
  inGroup?: boolean;
}

/**
 * GenericRenderer — the default tool row.
 *
 * Collapsed: shows a single-line header (progressLabel) with a chevron.
 * Expanded: shows the human-readable content the tool returned. If the
 * tool put a markdown string on `data.content`, we render it via the
 * Markdown component — same pattern Claude and Notion use for tool
 * output. Falls back to the one-line summary when there's no content.
 */
export function GenericRenderer({ toolName, result, loading, inGroup }: Props) {
  const header = result.progressLabel ?? toolName;
  const data = result.data as Record<string, unknown> | null;
  const content = data && typeof data.content === "string" ? (data.content as string) : null;

  if (inGroup) {
    // Flat row inside a group block — no nested ToolProgress wrapper.
    // Keep the bullet line tight; detail can be reached by opening the
    // solo expanded view on /runs/[id] or the editor chat.
    return <ToolProgressItem>{result.summary}</ToolProgressItem>;
  }

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{header}</ToolProgressHeader>
      <ToolProgressContent>
        {content ? (
          <Markdown variant="compact">{content}</Markdown>
        ) : (
          <ToolProgressItem>{result.summary}</ToolProgressItem>
        )}
      </ToolProgressContent>
    </ToolProgress>
  );
}
