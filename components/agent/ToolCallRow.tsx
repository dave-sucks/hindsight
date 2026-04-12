"use client";

/**
 * ToolCallRow — generic row. Reads result.ui, dispatches to the correct renderer.
 *
 * When inGroup=true, renderers omit their outer ToolProgress wrapper and render
 * flat content only — the group's ToolProgress is the container.
 */

import type { ToolUI } from "@/lib/agent/tool-result";
import { normalizeToolResult } from "@/lib/agent/tool-result";
import type { ToolResult } from "@/lib/agent/tool-result";
import { GenericRenderer } from "./renderers/GenericRenderer";
import { TickerRenderer } from "./renderers/TickerRenderer";
import { TickerListRenderer } from "./renderers/TickerListRenderer";
import { SourceRenderer } from "./renderers/SourceRenderer";
import { ThesisCardRenderer } from "./renderers/ThesisCardRenderer";
import { DecisionSummaryRenderer } from "./renderers/DecisionSummaryRenderer";
import { RunSummaryRenderer } from "./renderers/RunSummaryRenderer";
import { ConfigPreviewRenderer } from "./renderers/ConfigPreviewRenderer";
import { MorningBriefRenderer } from "./renderers/MorningBriefRenderer";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  toolName: string;
  toolCallId?: string;
  args: Record<string, unknown>;
  rawResult: unknown;
  /** True while the tool is still executing (no result yet) */
  loading: boolean;
  /** True when rendered inside a group's ToolProgressContent */
  inGroup?: boolean;
}

export function ToolCallRow({ toolName, toolCallId, args, rawResult, loading, inGroup }: Props) {
  const result: ToolResult = rawResult != null
    ? normalizeToolResult(toolName, rawResult)
    : { ok: true, ui: inferLoadingUI(toolName), summary: "", data: null, sources: [] };

  if (!result.ok) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-3 text-sm text-destructive">
          {toolName}: {result.error}
        </CardContent>
      </Card>
    );
  }

  const ui: ToolUI = result.ui;

  switch (ui) {
    case "ticker":
      return <TickerRenderer toolName={toolName} args={args} result={result} loading={loading} inGroup={inGroup} />;
    case "ticker-list":
      return <TickerListRenderer toolName={toolName} result={result} loading={loading} />;
    case "morning-brief":
      return <MorningBriefRenderer toolName={toolName} result={result} loading={loading} />;
    case "source":
      return <SourceRenderer toolName={toolName} result={result} loading={loading} />;
    case "thesis-card":
      return <ThesisCardRenderer toolName={toolName} toolCallId={toolCallId} result={result} loading={loading} />;
    case "decision-summary":
      return <DecisionSummaryRenderer toolName={toolName} result={result} loading={loading} />;
    case "run-summary":
      return <RunSummaryRenderer result={result} loading={loading} />;
    case "config-preview":
      return <ConfigPreviewRenderer result={result} loading={loading} />;
    case "generic":
    default:
      return <GenericRenderer toolName={toolName} result={result} loading={loading} />;
  }
}

function inferLoadingUI(toolName: string): ToolUI {
  if (toolName === "record_thesis" || toolName === "show_thesis") return "thesis-card";
  if (toolName === "record_run_summary" || toolName === "summarize_run") return "run-summary";
  if (toolName === "complete_run") return "decision-summary";
  if (toolName === "suggest_config") return "config-preview";
  if (toolName === "get_portfolio_context") return "generic";
  if (toolName === "read_morning_brief") return "morning-brief";
  if (toolName === "read_signals") return "ticker-list";
  if (toolName === "read_artifact" || toolName === "web_search") return "source";
  return "generic";
}
