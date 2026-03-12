"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAssistantToolUI } from "@assistant-ui/react";
import { ArrowRight, Check } from "lucide-react";
import {
  AgentConfigCard,
  type AgentConfigData,
} from "@/components/domain/agent-config-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Context for passing callbacks into tool UIs ────────────────────────────

type ToolUICallbacks = {
  /** Builder mode: create from config */
  onConfirmConfig?: (config: AgentConfigData) => void;
  isCreating?: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
  /** Editor mode: apply diff against existing config */
  currentConfig?: Record<string, unknown>;
  onApplyConfig?: (config: AgentConfigData) => void;
  isApplying?: boolean;
  applied?: boolean;
};

const ToolUICallbacksContext = createContext<ToolUICallbacks>({});

export const ToolUICallbacksProvider = ToolUICallbacksContext.Provider;
export const useToolUICallbacks = () => useContext(ToolUICallbacksContext);

// ─── suggest_config tool UI ─────────────────────────────────────────────────

const SuggestConfigRender: ToolCallMessagePartComponent<
  AgentConfigData,
  AgentConfigData
> = ({ args, status }) => {
  const { onConfirmConfig, isCreating, confirmLabel, confirmingLabel } =
    useToolUICallbacks();

  if (!args) return null;

  return (
    <div className="my-2">
      <AgentConfigCard
        {...args}
        onConfirm={
          onConfirmConfig ? () => onConfirmConfig(args) : undefined
        }
        isCreating={isCreating}
        showConfirmButton={!!onConfirmConfig}
        confirmLabel={confirmLabel}
        confirmingLabel={confirmingLabel}
      />
    </div>
  );
};

SuggestConfigRender.displayName = "SuggestConfigRender";

// ─── Config diff helpers (editor mode) ──────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  analystPrompt: "Strategy",
  directionBias: "Direction",
  holdDurations: "Hold Duration",
  sectors: "Sectors",
  signalTypes: "Signals",
  minConfidence: "Min Confidence",
  maxPositionSize: "Position Size",
  maxOpenPositions: "Max Positions",
  minMarketCapTier: "Market Cap",
  watchlist: "Watchlist",
  exclusionList: "Exclusion List",
};

function formatValue(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  if (Array.isArray(val)) return val.length === 0 ? "—" : val.join(", ");
  if (key === "maxPositionSize" && typeof val === "number")
    return `$${val.toLocaleString()}`;
  if (key === "minConfidence" && typeof val === "number") return `${val}%`;
  if (typeof val === "string" && key === "analystPrompt")
    return val.length > 80 ? val.slice(0, 80) + "…" : val;
  return String(val);
}

function computeDiff(
  before: Record<string, unknown>,
  after: AgentConfigData
): { label: string; before: string; after: string }[] {
  const diffs: { label: string; before: string; after: string }[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const bStr = formatValue(key, before[key]);
    const aStr = formatValue(key, after[key as keyof AgentConfigData]);
    if (bStr !== aStr) diffs.push({ label, before: bStr, after: aStr });
  }
  return diffs;
}

// ─── Editor-mode suggest_config render (with diff) ──────────────────────────

const SuggestConfigEditorRender: ToolCallMessagePartComponent<
  AgentConfigData,
  AgentConfigData
> = ({ args }) => {
  const { currentConfig, onApplyConfig, isApplying, applied } =
    useToolUICallbacks();
  const [showFull, setShowFull] = useState(false);

  if (!args || !currentConfig) return null;

  const diffs = computeDiff(currentConfig, args);

  if (diffs.length === 0) {
    return (
      <Card className="p-4 mt-1">
        <p className="text-sm text-muted-foreground">No changes detected.</p>
      </Card>
    );
  }

  return (
    <div className="my-2 space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Proposed Changes
          </h4>
          <Badge variant="secondary" className="text-[11px]">
            {diffs.length} {diffs.length === 1 ? "change" : "changes"}
          </Badge>
        </div>
        <div className="space-y-2">
          {diffs.map((d) => (
            <div key={d.label} className="text-xs">
              <span className="font-medium text-muted-foreground">
                {d.label}
              </span>
              <div className="flex items-start gap-2 mt-0.5">
                <span className="text-red-500 line-through min-w-0 break-words">
                  {d.before}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-emerald-500 font-medium min-w-0 break-words">
                  {d.after}
                </span>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowFull(!showFull)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showFull ? "Hide full config" : "Show full config"}
        </button>
      </Card>

      {showFull && (
        <AgentConfigCard
          {...args}
          showConfirmButton={false}
          className="border-dashed"
        />
      )}

      {applied ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
          <Check className="h-3 w-3" />
          Changes applied
        </div>
      ) : (
        onApplyConfig && (
          <Button
            onClick={() => onApplyConfig(args)}
            disabled={isApplying}
            className="w-full"
            size="sm"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {isApplying ? "Applying…" : "Apply Changes"}
          </Button>
        )
      )}
    </div>
  );
};

SuggestConfigEditorRender.displayName = "SuggestConfigEditorRender";

// ─── Registration hooks ─────────────────────────────────────────────────────

/**
 * Register suggest_config tool UI for the builder (shows full config card + create button).
 */
export function useRegisterBuilderToolUIs() {
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigRender,
  });
}

/**
 * Register suggest_config tool UI for the editor (shows diff card + apply button).
 */
export function useRegisterEditorToolUIs() {
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigEditorRender,
  });
}

/** @deprecated Use useRegisterBuilderToolUIs or useRegisterEditorToolUIs */
export const useRegisterToolUIs = useRegisterBuilderToolUIs;

// ─── Trading / Research / Portfolio tool UIs (run-followup chat) ────────────

import { ThesisCard, type ThesisCardData } from "@/components/domain";
import {
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Briefcase,
  BarChart3,
  GitCompare,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Generic helper for tool UIs that renders from result
const makeResultToolUI = (
  toolName: string,
  Render: ToolCallMessagePartComponent
) => ({ toolName, render: Render });

// ── research_ticker / get_thesis → ThesisCard ───────────────────────────────

const ResearchTickerRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const thesis: ThesisCardData = {
    ticker: String(r.ticker ?? ""),
    direction: String(r.direction ?? "PASS") as "LONG" | "SHORT" | "PASS",
    confidence_score: Number(r.confidence_score ?? 0),
    reasoning_summary: String(r.reasoning_summary ?? ""),
    thesis_bullets: Array.isArray(r.thesis_bullets)
      ? (r.thesis_bullets as string[])
      : [],
    risk_flags: Array.isArray(r.risk_flags)
      ? (r.risk_flags as string[])
      : [],
    entry_price: typeof r.entry_price === "number" ? r.entry_price : null,
    target_price: typeof r.target_price === "number" ? r.target_price : null,
    stop_loss: typeof r.stop_loss === "number" ? r.stop_loss : null,
    hold_duration: String(r.hold_duration ?? "SWING"),
    signal_types: Array.isArray(r.signal_types)
      ? (r.signal_types as string[])
      : [],
  };
  return (
    <div className="my-2">
      <ThesisCard {...thesis} />
    </div>
  );
};
ResearchTickerRender.displayName = "ResearchTickerRender";

// ── place_trade ─────────────────────────────────────────────────────────────

const PlaceTradeRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const isLong = String(r.direction ?? "").toUpperCase() === "LONG";
  return (
    <div className="my-2 flex items-center gap-2 text-sm rounded-lg border bg-emerald-500/5 border-emerald-500/20 px-4 py-3">
      <ShoppingCart className="h-4 w-4 text-emerald-500" />
      <span>
        Trade placed:{" "}
        <span className="font-mono font-semibold">{String(r.ticker)}</span>{" "}
        <span className={isLong ? "text-emerald-500" : "text-red-500"}>
          {isLong ? (
            <TrendingUp className="inline h-3 w-3 mr-0.5" />
          ) : (
            <TrendingDown className="inline h-3 w-3 mr-0.5" />
          )}
          {String(r.direction).toUpperCase()}
        </span>
        {typeof r.fillPrice === "number" && (
          <span className="tabular-nums text-muted-foreground">
            {" "}
            @ ${Number(r.fillPrice).toFixed(2)}
          </span>
        )}
      </span>
    </div>
  );
};
PlaceTradeRender.displayName = "PlaceTradeRender";

// ── close_position ──────────────────────────────────────────────────────────

const ClosePositionRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const pnl = typeof r.realizedPnl === "number" ? r.realizedPnl : null;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
        Position closed:{" "}
        <span className="font-mono">{String(r.ticker)}</span>
      </div>
      {pnl != null && (
        <p
          className={cn(
            "text-sm tabular-nums font-semibold",
            pnl >= 0 ? "text-emerald-500" : "text-red-500"
          )}
        >
          P&L: {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({String(r.outcome)})
        </p>
      )}
    </div>
  );
};
ClosePositionRender.displayName = "ClosePositionRender";

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
                unrealized >= 0 ? "text-emerald-500" : "text-red-500"
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
          <span className="font-mono font-semibold text-emerald-500">
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
          <p className="text-sm tabular-nums font-semibold text-emerald-500">
            {wins}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Losses
          </p>
          <p className="text-sm tabular-nums font-semibold text-red-500">
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

/**
 * Register all trading/research/portfolio tool UIs for the run-followup chat.
 */
export function useRegisterFollowupToolUIs() {
  useAssistantToolUI({ toolName: "research_ticker", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "get_thesis", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "place_trade", render: PlaceTradeRender });
  useAssistantToolUI({ toolName: "close_position", render: ClosePositionRender });
  useAssistantToolUI({ toolName: "modify_position", render: ClosePositionRender });
  useAssistantToolUI({ toolName: "add_to_position", render: PlaceTradeRender });
  useAssistantToolUI({ toolName: "portfolio_status", render: PortfolioStatusRender });
  useAssistantToolUI({ toolName: "compare_tickers", render: CompareTickersRender });
  useAssistantToolUI({ toolName: "performance_report", render: PerformanceReportRender });
  useAssistantToolUI({ toolName: "explain_decision", render: ExplainDecisionRender });
  useAssistantToolUI({ toolName: "run_summary", render: PerformanceReportRender });
}
