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

export function DecisionSummaryRenderer({ loading, result }: Props) {
  if (loading) {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader loading>Completing run…</ToolProgressHeader>
      </ToolProgress>
    );
  }

  const data = result.data as Record<string, unknown> | null;
  const briefingStatus = data?.briefing as "success" | "failed" | "skipped" | undefined;
  const briefingError = data?.briefingError as string | null | undefined;

  let briefingLine: string | null = null;
  if (briefingStatus === "success") briefingLine = "Briefing: written and verified";
  else if (briefingStatus === "failed") briefingLine = `Briefing: failed${briefingError ? ` — ${briefingError}` : ""}`;
  else if (briefingStatus === "skipped") briefingLine = `Briefing: skipped${briefingError ? ` — ${briefingError}` : ""}`;

  return (
    <ToolProgress defaultOpen={briefingStatus === "failed"}>
      <ToolProgressHeader>Completing run</ToolProgressHeader>
      {briefingLine && (
        <ToolProgressContent>
          <ToolProgressItem>{briefingLine}</ToolProgressItem>
        </ToolProgressContent>
      )}
    </ToolProgress>
  );
}
