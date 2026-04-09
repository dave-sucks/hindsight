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

export function GenericRenderer({ toolName, result, loading }: Props) {
  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{toolName}</ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{result.summary}</ToolProgressItem>
      </ToolProgressContent>
    </ToolProgress>
  );
}
