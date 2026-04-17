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
  /** When true, render inside a group block with no nested group header */
  inGroup?: boolean;
}

/**
 * GenericRenderer — the default tool row.
 *
 * Collapsed: shows a single-line header (progressLabel) with a chevron.
 * Expanded: if the tool put a markdown string on `data.content`, we render
 * it via the Markdown component — exactly the Claude/Notion pattern of
 * "click to see what the tool actually read." Falls back to a one-line
 * summary bullet when there's no content.
 *
 * Even inside a group block, if the tool returns `data.content` we still
 * render it as its own expandable ToolProgress (without the outer bullet
 * styling). This preserves the group's narrative-header while giving the
 * user a click target to see the full tool output.
 */
export function GenericRenderer({ toolName, result, loading, inGroup }: Props) {
  const header = result.progressLabel ?? toolName;
  const data = result.data as Record<string, unknown> | null;
  const content = data && typeof data.content === "string" ? (data.content as string) : null;

  // Rich content path — always an expandable row with the header +
  // content, regardless of group membership. Users clicked "expand" for
  // exactly this reason.
  if (content) {
    return (
      <ToolProgress defaultOpen={false}>
        <ToolProgressHeader loading={loading}>{header}</ToolProgressHeader>
        <ToolProgressContent>
          <Markdown variant="compact">{content}</Markdown>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  // No-content path inside a group — just a flat summary bullet under
  // the group's header. No nested ToolProgress wrapper.
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
