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

import {
  ThesisCard,
  type ThesisCardData,
  TradeCard,
  TradeConfirmation,
} from "@/components/domain";

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
