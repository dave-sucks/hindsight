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
      <Card className="overflow-hidden p-0">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Proposed Changes
          </h4>
          <Badge variant="secondary" className="text-xs">
            {diffs.length} {diffs.length === 1 ? "change" : "changes"}
          </Badge>
        </div>
        <div className="px-5 py-4 space-y-3">
          {diffs.map((d) => (
            <div key={d.label} className="text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {d.label}
              </span>
              <div className="flex items-start gap-2.5 mt-1">
                <span className="text-red-500 line-through min-w-0 break-words text-sm">
                  {d.before}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-emerald-500 font-medium min-w-0 break-words text-sm">
                  {d.after}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-4">
          <button
            onClick={() => setShowFull(!showFull)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            {showFull ? "Hide full config" : "Show full config"}
          </button>
        </div>
      </Card>

      {showFull && (
        <AgentConfigCard
          {...args}
          showConfirmButton={false}
          className="border-dashed"
        />
      )}

      {applied ? (
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium">
            <Check className="h-4 w-4" />
            Changes applied successfully
          </div>
        </Card>
      ) : (
        onApplyConfig && (
          <Button
            onClick={() => onApplyConfig(args)}
            disabled={isApplying}
            className="w-full h-10"
            size="default"
          >
            <Check className="h-4 w-4 mr-2" />
            {isApplying ? "Applying…" : "Apply Changes"}
          </Button>
        )
      )}
    </div>
  );
};

SuggestConfigEditorRender.displayName = "SuggestConfigEditorRender";

// ─── Builder research tool UIs ──────────────────────────────────────────────

import {
  Globe,
  LineChart,
  MessageCircle,
  ExternalLink,
} from "lucide-react";

const WebSearchRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  const results = Array.isArray(r.results) ? r.results as Array<Record<string, unknown>> : [];
  const query = String(a.query ?? r.query ?? "");

  if (status?.type !== "complete" && !result) {
    return (
      <div className="my-2 rounded-lg border p-3 flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
        <Globe className="h-4 w-4" />
        Searching: {query}…
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className="my-2 rounded-lg border overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/20 flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Web Search: {query}
        </span>
      </div>
      <div className="divide-y">
        {results.slice(0, 4).map((item, i) => (
          <div key={i} className="px-3 py-2 hover:bg-muted/10 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {String(item.title ?? "")}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {String(item.text ?? "")}
                </p>
              </div>
              {typeof item.url === "string" && item.url && (
                <a
                  href={String(item.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {String(item.source ?? "")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
WebSearchRender.displayName = "WebSearchRender";

const MarketContextRender: ToolCallMessagePartComponent = ({ result, status }) => {
  const r = (result ?? {}) as Record<string, unknown>;

  if (status?.type !== "complete" && !result) {
    return (
      <div className="my-2 rounded-lg border p-3 flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
        <LineChart className="h-4 w-4" />
        Loading market data…
      </div>
    );
  }

  if (r.error) return null;

  const spy = r.spy as Record<string, unknown> | null;
  const vix = r.vix as Record<string, unknown> | null;
  const sectors = Array.isArray(r.sectors) ? r.sectors as Array<Record<string, unknown>> : [];

  return (
    <div className="my-2 rounded-lg border overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/20 flex items-center gap-2">
        <LineChart className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Market Context
        </span>
      </div>
      <div className="p-3 space-y-3">
        {/* SPY + VIX row */}
        <div className="grid grid-cols-2 gap-3">
          {spy && (
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                SPY
              </p>
              <p className="text-sm font-semibold tabular-nums">
                ${Number(spy.price ?? 0).toFixed(2)}
              </p>
              <p
                className={cn(
                  "text-xs tabular-nums",
                  Number(spy.change ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"
                )}
              >
                {Number(spy.change ?? 0) >= 0 ? "+" : ""}{Number(spy.change ?? 0).toFixed(2)}%
              </p>
            </div>
          )}
          {vix && (
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                VIX
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {Number(vix.level ?? 0).toFixed(1)}
              </p>
              {vix.change != null && (
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    Number(vix.change) >= 0 ? "text-red-500" : "text-emerald-500"
                  )}
                >
                  {Number(vix.change) >= 0 ? "+" : ""}{Number(vix.change).toFixed(2)}%
                </p>
              )}
            </div>
          )}
        </div>
        {/* Sectors */}
        {sectors.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              Sectors
            </p>
            <div className="flex flex-wrap gap-1">
              {sectors.slice(0, 8).map((s, i) => {
                const change = parseFloat(String(s.changesPercentage ?? s.change ?? "0"));
                return (
                  <Badge
                    key={i}
                    variant="outline"
                    className={cn(
                      "text-[10px] px-2 py-0.5 tabular-nums font-mono",
                      change >= 0 ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"
                    )}
                  >
                    {String(s.sector ?? "").replace("Services", "").trim()} {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                  </Badge>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
MarketContextRender.displayName = "MarketContextRender";

const RedditSearchRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  const results = Array.isArray(r.results) ? r.results as Array<Record<string, unknown>> : [];
  const query = String(a.query ?? r.query ?? "");

  if (status?.type !== "complete" && !result) {
    return (
      <div className="my-2 rounded-lg border p-3 flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
        <MessageCircle className="h-4 w-4" />
        Searching Reddit: {query}…
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className="my-2 rounded-lg border overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/20 flex items-center gap-2">
        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Reddit: {query}
        </span>
      </div>
      <div className="divide-y">
        {results.slice(0, 5).map((post, i) => (
          <div key={i} className="px-3 py-2 hover:bg-muted/10 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm truncate">{String(post.title ?? "")}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    r/{String(post.subreddit ?? "")}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    ↑ {Number(post.score ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>
              {typeof post.url === "string" && post.url && (
                <a
                  href={String(post.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
RedditSearchRender.displayName = "RedditSearchRender";

// ─── Registration hooks ─────────────────────────────────────────────────────

/**
 * Register suggest_config tool UI for the builder (shows full config card + create button).
 * Also registers research tool UIs (web_search, get_market_context, search_reddit).
 */
export function useRegisterBuilderToolUIs() {
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigRender,
  });
  useAssistantToolUI({
    toolName: "web_search",
    render: WebSearchRender,
  });
  useAssistantToolUI({
    toolName: "get_market_context",
    render: MarketContextRender,
  });
  useAssistantToolUI({
    toolName: "search_reddit",
    render: RedditSearchRender,
  });
}

/**
 * Register suggest_config tool UI for the editor (shows diff card + apply button).
 * Also registers research tool UIs (web_search, get_market_context, search_reddit).
 */
export function useRegisterEditorToolUIs() {
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigEditorRender,
  });
  useAssistantToolUI({
    toolName: "web_search",
    render: WebSearchRender,
  });
  useAssistantToolUI({
    toolName: "get_market_context",
    render: MarketContextRender,
  });
  useAssistantToolUI({
    toolName: "search_reddit",
    render: RedditSearchRender,
  });
}

/** @deprecated Use useRegisterBuilderToolUIs or useRegisterEditorToolUIs */
export const useRegisterToolUIs = useRegisterBuilderToolUIs;

// ─── Trading / Research / Portfolio tool UIs (run-followup chat) ────────────

import {
  ThesisCard,
  type ThesisCardData,
  TradeCard,
  TradeConfirmation,
} from "@/components/domain";
import {
  TrendingUp,
  TrendingDown,
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

// ── place_trade → TradeConfirmation (pending) / TradeCard (result) ───────────

const PlaceTradeRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  // Pending state — show confirmation preview
  if (!result && args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    const dir = String(a.direction ?? "LONG").toUpperCase();
    return (
      <div className="my-2">
        <TradeConfirmation
          ticker={String(a.ticker ?? "")}
          direction={dir === "SHORT" ? "SHORT" : "LONG"}
          shares={typeof a.shares === "number" ? a.shares : undefined}
          estimatedPrice={typeof a.price === "number" ? a.price : null}
          estimatedCost={
            typeof a.price === "number" && typeof a.shares === "number"
              ? a.price * a.shares
              : null
          }
          action="BUY"
          onConfirm={() => {}}
          onCancel={() => {}}
          isExecuting
          resolved="confirmed"
          className="max-w-md"
        />
      </div>
    );
  }

  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const dir = String(r.direction ?? "LONG").toUpperCase();
  return (
    <div className="my-2">
      <TradeCard
        ticker={String(r.ticker ?? "")}
        direction={dir === "SHORT" ? "SHORT" : "LONG"}
        entryPrice={typeof r.fillPrice === "number" ? r.fillPrice : 0}
        shares={typeof r.shares === "number" ? r.shares : undefined}
        status="OPEN"
        className="max-w-md"
      />
    </div>
  );
};
PlaceTradeRender.displayName = "PlaceTradeRender";

// ── close_position → TradeCard (closed state) ──────────────────────────────

const ClosePositionRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const dir = String(r.direction ?? "LONG").toUpperCase();
  const pnl = typeof r.realizedPnl === "number" ? r.realizedPnl : null;
  const outcome = String(r.outcome ?? "").toUpperCase();
  return (
    <div className="my-2">
      <TradeCard
        ticker={String(r.ticker ?? "")}
        direction={dir === "SHORT" ? "SHORT" : "LONG"}
        entryPrice={typeof r.entryPrice === "number" ? r.entryPrice : 0}
        closePrice={typeof r.closePrice === "number" ? r.closePrice : null}
        realizedPnl={pnl}
        outcome={
          outcome === "WIN" || outcome === "LOSS" || outcome === "BREAKEVEN"
            ? outcome
            : null
        }
        status="CLOSED"
        className="max-w-md"
      />
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
