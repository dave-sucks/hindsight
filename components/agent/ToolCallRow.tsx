"use client";

/**
 * ToolCallRow — renders a single tool call's result by dispatching on the
 * ToolUI discriminator in the result.
 *
 * Includes a compatibility shim (normalizeToolResult) for legacy
 * ResearchToolResult shapes stored in RunMessage rows, so historical replay
 * works without schema migrations.
 */

import type { ToolUI } from "@/lib/agent/tool-result";
import { normalizeToolResult } from "@/lib/agent/tool-result";
import type { ToolResult } from "@/lib/agent/tool-result";
import { GenericRenderer } from "./renderers/GenericRenderer";
import { TickerRenderer } from "./renderers/TickerRenderer";
import { SourceRenderer } from "./renderers/SourceRenderer";
import { StockCardRenderer } from "./renderers/StockCardRenderer";
import { TradeCardRenderer } from "./renderers/TradeCardRenderer";
import { ThesisCardRenderer } from "./renderers/ThesisCardRenderer";
import { PortfolioRenderer } from "./renderers/PortfolioRenderer";
import { DecisionSummaryRenderer } from "./renderers/DecisionSummaryRenderer";
import { RunSummaryRenderer } from "./renderers/RunSummaryRenderer";
import { ConfigPreviewRenderer } from "./renderers/ConfigPreviewRenderer";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  toolName: string;
  toolCallId?: string;
  /** Index of this part in the message content array (for forward-read patterns) */
  partIndex?: number;
  args: Record<string, unknown>;
  rawResult: unknown;
  /** True while the tool is still executing (no result yet) */
  loading: boolean;
}

export function ToolCallRow({ toolName, toolCallId, partIndex, args, rawResult, loading }: Props) {
  // Normalize to ToolResult regardless of shape (new or legacy)
  const result: ToolResult = rawResult != null
    ? normalizeToolResult(toolName, rawResult)
    : { ok: true, ui: inferLoadingUI(toolName), summary: "", data: null, sources: [] };

  // Error state
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
      return <TickerRenderer toolName={toolName} result={result} loading={loading} />;
    case "source":
      return <SourceRenderer toolName={toolName} result={result} loading={loading} />;
    case "stock-card":
      return <StockCardRenderer toolName={toolName} result={result} loading={loading} />;
    case "trade-card":
      return <TradeCardRenderer toolName={toolName} result={result} loading={loading} />;
    case "thesis-card":
      return <ThesisCardRenderer toolName={toolName} result={result} loading={loading} />;
    case "portfolio":
      return <PortfolioRenderer result={result} loading={loading} />;
    case "decision-summary":
      return <DecisionSummaryRenderer toolName={toolName} toolCallId={toolCallId} partIndex={partIndex} result={result} loading={loading} />;
    case "run-summary":
      return <RunSummaryRenderer result={result} loading={loading} />;
    case "config-preview":
      return <ConfigPreviewRenderer result={result} loading={loading} />;
    case "generic":
    default:
      return <GenericRenderer toolName={toolName} result={result} loading={loading} />;
  }
}

/** Best-guess UI type while a tool is loading (no result yet). */
function inferLoadingUI(toolName: string): ToolUI {
  if (toolName === "get_stock_data") return "stock-card";
  if (toolName === "place_trade" || toolName === "close_position") return "trade-card";
  if (toolName === "record_thesis" || toolName === "show_thesis") return "thesis-card";
  if (toolName === "get_portfolio_state") return "portfolio";
  if (toolName === "record_run_summary" || toolName === "summarize_run") return "run-summary";
  if (toolName === "complete_run" || toolName === "record_decision_plan") return "decision-summary";
  if (toolName === "suggest_config") return "config-preview";
  if (
    toolName === "get_earnings_data" ||
    toolName === "get_options_flow" ||
    toolName === "get_sec_filings"
  ) return "ticker";
  if (
    toolName === "read_morning_brief" ||
    toolName === "read_signals" ||
    toolName === "read_artifact" ||
    toolName === "web_search"
  ) return "source";
  return "generic";
}
