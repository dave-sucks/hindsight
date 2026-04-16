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
  /** When true, render a flat ToolProgressItem — group supplies the wrapper */
  inGroup?: boolean;
}

export function GenericRenderer({ toolName, result, loading, inGroup }: Props) {
  const header = result.progressLabel ?? toolName;

  if (inGroup) {
    // Flat row inside a group block — no nested ToolProgress wrapper.
    // Group header already says WHAT we're doing; this row is the result.
    return <ToolProgressItem>{result.summary}</ToolProgressItem>;
  }

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{header}</ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{result.summary}</ToolProgressItem>
      </ToolProgressContent>
    </ToolProgress>
  );
}
