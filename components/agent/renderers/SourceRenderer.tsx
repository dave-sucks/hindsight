"use client";

/**
 * SourceRenderer — for intelligence-read tools: read_morning_brief,
 * read_signals, read_artifact, web_search.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import { Search } from "lucide-react";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";
import { extractToolSources, SourceChips } from "@/components/assistant-ui/tool-uis/tool-ui-shared";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function SourceRenderer({ toolName, result, loading }: Props) {
  const isWebSearch = toolName === "web_search";
  // extractToolSources expects the raw result shape (with _sources)
  const rawResult = { ...result.data as Record<string, unknown>, _sources: result.sources };
  const allSources = loading ? [] : extractToolSources(rawResult);

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading} icon={isWebSearch ? Search : undefined}>
        {toolName === "web_search" ? "Web search" : result.summary.slice(0, 60)}
      </ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{result.summary}</ToolProgressItem>
        <SourceChips sources={allSources} />
      </ToolProgressContent>
    </ToolProgress>
  );
}
