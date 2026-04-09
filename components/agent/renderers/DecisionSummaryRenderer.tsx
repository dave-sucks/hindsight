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
}

export function DecisionSummaryRenderer({ toolName, result, loading }: Props) {
  const label =
    toolName === "complete_run" ? "Completing run" : "Managing portfolio";

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{label}</ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{result.summary}</ToolProgressItem>
      </ToolProgressContent>
    </ToolProgress>
  );
}
