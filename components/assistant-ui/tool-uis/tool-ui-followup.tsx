"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAssistantToolUI } from "@assistant-ui/react";
import {
  BarChart3,
  Briefcase,
  GitCompare,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Shared renderers from research tools — no duplication
import {
  thesisRender,
  placeTradeRender,
  closePositionRender,
} from "./tool-ui-research";

// ── portfolio_status ────────────────────────────────────────────────────────

const PortfolioStatusRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const positions = Array.isArray(r.positions) ? r.positions.length : 0;
  const unrealized =
    typeof r.unrealizedPnl === "number" ? r.unrealizedPnl : null;
  const winRate = typeof r.winRate === "number" ? r.winRate : null;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Briefcase className="h-4 w-4 text-muted-foreground" />
        Portfolio Status
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Positions
          </p>
          <p className="text-sm tabular-nums font-semibold">{positions}</p>
        </div>
        {unrealized != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Unrealized
            </p>
            <p
              className={cn(
                "text-sm tabular-nums font-semibold",
                unrealized >= 0 ? "text-positive" : "text-negative"
              )}
            >
              {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}
            </p>
          </div>
        )}
        {winRate != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Win Rate
            </p>
            <p className="text-sm tabular-nums font-semibold">
              {winRate.toFixed(0)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
PortfolioStatusRender.displayName = "PortfolioStatusRender";

// ── compare_tickers ─────────────────────────────────────────────────────────

const CompareTickersRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const tickers = Array.isArray(r.tickers)
    ? (r.tickers as string[])
    : [];
  const recommended = String(r.recommended ?? "");
  return (
    <div className="my-2 rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        Comparing {tickers.join(" vs ")}
      </div>
      {recommended && (
        <p className="text-sm">
          Recommendation:{" "}
          <span className="font-mono font-semibold text-positive">
            {recommended}
          </span>
        </p>
      )}
    </div>
  );
};
CompareTickersRender.displayName = "CompareTickersRender";

// ── performance_report ──────────────────────────────────────────────────────

const PerformanceReportRender: ToolCallMessagePartComponent = ({
  result,
}) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const wins = typeof r.wins === "number" ? r.wins : 0;
  const losses = typeof r.losses === "number" ? r.losses : 0;
  const winRate = typeof r.winRate === "number" ? r.winRate : null;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        Performance Report
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Wins
          </p>
          <p className="text-sm tabular-nums font-semibold text-positive">
            {wins}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Losses
          </p>
          <p className="text-sm tabular-nums font-semibold text-negative">
            {losses}
          </p>
        </div>
        {winRate != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Win Rate
            </p>
            <p className="text-sm tabular-nums font-semibold">
              {winRate.toFixed(0)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
PerformanceReportRender.displayName = "PerformanceReportRender";

// ── explain_decision ────────────────────────────────────────────────────────

const ExplainDecisionRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
        Decision:{" "}
        <span className="font-mono">{String(r.ticker)}</span>
      </div>
      {typeof r.explanation === "string" && (
        <p className="text-sm text-muted-foreground">{r.explanation}</p>
      )}
    </div>
  );
};
ExplainDecisionRender.displayName = "ExplainDecisionRender";

// ─── Registration hook for run-followup tools ───────────────────────────────

export function useRegisterFollowupToolUIs() {
  useAssistantToolUI({ toolName: "research_ticker", render: thesisRender });
  useAssistantToolUI({ toolName: "get_thesis", render: thesisRender });
  useAssistantToolUI({ toolName: "place_trade", render: placeTradeRender });
  useAssistantToolUI({ toolName: "close_position", render: closePositionRender });
  useAssistantToolUI({ toolName: "modify_position", render: closePositionRender });
  useAssistantToolUI({ toolName: "add_to_position", render: placeTradeRender });
  useAssistantToolUI({ toolName: "portfolio_status", render: PortfolioStatusRender });
  useAssistantToolUI({ toolName: "compare_tickers", render: CompareTickersRender });
  useAssistantToolUI({ toolName: "performance_report", render: PerformanceReportRender });
  useAssistantToolUI({ toolName: "explain_decision", render: ExplainDecisionRender });
  useAssistantToolUI({ toolName: "run_summary", render: PerformanceReportRender });
}
