"use client";

import { useAssistantToolUI } from "@assistant-ui/react";
import {
  BarChart3,
  Activity,
  CheckCircle2,
  FileText,
  Briefcase,
  HelpCircle,
  Eye,
  Radar,
  Zap,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ThesisCard,
  type ThesisCardData,
  TradeCard,
  PortfolioReviewCard,
  type PortfolioReviewData,
  DecisionSummaryCard,
} from "@/components/domain";
import { OrderConfirm } from "@/components/manifest-ui/order-confirm";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";

import { extractToolSources, SourceChips } from "./tool-ui-shared";
import { SuggestConfigRender, SuggestConfigEditorRender } from "./tool-ui-config";

// ─── Research tool UI registrations (shared across agent, builder, editor) ───

/**
 * Register all 14 research tool UIs used by the agent.
 * Extracted from AgentThread.tsx so any chat context can render the same
 * rich domain cards. Sources aggregated in Sources tab.
 */
export function useRegisterResearchToolUIs(_runId?: string) {
  // ── Market context (was: market_overview + detect_market_themes) ────
  useAssistantToolUI({
    toolName: "get_market_context",
    render: () => null,
  });

  // ── Stock data → CoT only (rendered by ResearchToolGroup, no separate card) ──
  useAssistantToolUI({
    toolName: "get_stock_data",
    render: () => null,
  });

  // ── Earnings data — rendered as CoT step by ResearchToolGroup ───────
  useAssistantToolUI({
    toolName: "get_earnings_data",
    render: () => null,
  });

  // ── Options flow — rendered as CoT step by ResearchToolGroup ────────
  useAssistantToolUI({
    toolName: "get_options_flow",
    render: () => null,
  });

  // ── SEC Filings — rendered as CoT step by ResearchToolGroup ─────────
  useAssistantToolUI({
    toolName: "get_sec_filings",
    render: () => null,
  });

  // ── V3 Intelligence Layer — CoT steps ────────────────────────────────────
  useAssistantToolUI({
    toolName: "read_morning_brief",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reading morning intelligence brief...</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Radar} label="Loading today's brief" status="active" />
              <ChainOfThoughtStep icon={BarChart3} label="Market context" status="pending" />
              <ChainOfThoughtStep icon={Briefcase} label="Portfolio alerts" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const r = result as Record<string, unknown>;
      if (r.available === false) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>No morning brief available</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Radar} label="Intelligence jobs may not have run yet" status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const marketCtx = typeof r.marketContext === "string" ? r.marketContext.slice(0, 100) : "";
      const alertCount = Array.isArray(r.portfolioAlerts) ? r.portfolioAlerts.length : 0;
      const watchCount = Array.isArray(r.watchlistUpdates) ? r.watchlistUpdates.length : 0;
      const oppCount = Array.isArray(r.newOpportunities) ? r.newOpportunities.length : 0;

      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Morning intelligence brief</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep icon={BarChart3} label={marketCtx ? `${marketCtx}…` : "Market context loaded"} status="complete" />
            <ChainOfThoughtStep icon={Briefcase} label={`${alertCount} portfolio alert${alertCount !== 1 ? "s" : ""}`} status="complete" />
            <ChainOfThoughtStep icon={Eye} label={`${watchCount} watchlist update${watchCount !== 1 ? "s" : ""}`} status="complete" />
            <ChainOfThoughtStep icon={Zap} label={`${oppCount} new opportunit${oppCount !== 1 ? "ies" : "y"}`} status="complete" />
          </ChainOfThoughtContent>
          <SourceChips sources={[{ provider: "Intelligence Pipeline", title: "Morning Brief", excerpt: `${r.signalCount ?? 0} signals synthesized` }]} />
        </ChainOfThought>
      );
    },
  });

  useAssistantToolUI({
    toolName: "read_signals",
    render: ({ args, result }) => {
      const filterTickers = (args as Record<string, unknown>)?.tickers as string[] | undefined;
      const filterType = (args as Record<string, unknown>)?.type as string | undefined;

      if (!result) {
        const filterCtx = filterTickers?.length
          ? ` for ${filterTickers.join(", ")}`
          : filterType
            ? ` (${filterType})`
            : "";
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reading routed signals{filterCtx}...</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Zap} label="Querying intelligence feed" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const r = result as Record<string, unknown>;
      const count = typeof r.count === "number" ? r.count : 0;
      const signals = Array.isArray(r.signals) ? r.signals as Record<string, unknown>[] : [];
      const urgent = signals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
      const bullish = signals.filter((s) => s.sentiment === "BULLISH").length;
      const bearish = signals.filter((s) => s.sentiment === "BEARISH").length;
      const top3 = signals.slice(0, 3).map((s) => s.headline as string).filter(Boolean);
      const allTickers = [...new Set(signals.flatMap((s) => Array.isArray(s.tickers) ? s.tickers as string[] : []))];
      const sourceNames = [...new Set(signals.flatMap((s) => Array.isArray(s.sourceNames) ? s.sourceNames as string[] : []))];

      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>
            Read {count} signal{count !== 1 ? "s" : ""} ({urgent} urgent, {bullish} bullish, {bearish} bearish)
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {top3.map((headline, i) => (
              <ChainOfThoughtStep key={i} icon={Zap} label={headline} status="complete" />
            ))}
            {count > 3 && (
              <ChainOfThoughtStep icon={Zap} label={`+${count - 3} more signals`} status="complete" />
            )}
          </ChainOfThoughtContent>
          {allTickers.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1 flex-wrap px-1">
              {allTickers.slice(0, 8).map((t) => (
                <Badge key={t} variant="secondary">${t}</Badge>
              ))}
              {allTickers.length > 8 && (
                <span className="text-[11px] text-muted-foreground">+{allTickers.length - 8}</span>
              )}
            </div>
          )}
          <SourceChips sources={sourceNames.map((n) => ({ provider: n, title: `${n} signals` }))} />
        </ChainOfThought>
      );
    },
  });

  useAssistantToolUI({
    toolName: "read_artifact",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reading full article...</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={FileText} label="Extracting article content" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const r = result as Record<string, unknown>;
      if (r.error) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Article not found</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={FileText} label={String(r.error)} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const title = typeof r.title === "string" ? r.title : "Untitled";
      const url = typeof r.url === "string" ? r.url : "";
      const content = typeof r.contentMarkdown === "string" ? r.contentMarkdown : "";
      const wordCount = content ? content.split(/\s+/).length : 0;
      let domain = "";
      try { domain = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { /* */ }

      const sources = extractToolSources(r);

      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>
            {domain ? `${domain}: ` : ""}{title} ({wordCount.toLocaleString()} words)
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep icon={FileText} label={title} status="complete" />
          </ChainOfThoughtContent>
          <SourceChips sources={sources.length > 0 ? sources : (domain ? [{ provider: domain, title, url }] : [])} />
        </ChainOfThought>
      );
    },
  });

  // ── Thesis → ThesisCard (compact preview, opens sheet on click) ────
  // Shared render for record_thesis (new) and show_thesis (backward compat alias)
  const thesisRender = ({ result }: { result?: Record<string, unknown> }) => {
    if (!result) {
      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Building thesis</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep icon={CheckCircle2} label="Data collected" status="complete" />
            <ChainOfThoughtStep icon={BarChart3} label="Generating direction + confidence" status="active" />
            <ChainOfThoughtStep icon={FileText} label="Writing full analysis" status="pending" />
          </ChainOfThoughtContent>
        </ChainOfThought>
      );
    }

    const sources = extractToolSources(result as Record<string, unknown>);
    const thesis: ThesisCardData = {
      ticker: result.ticker as string,
      direction: result.direction as "LONG" | "SHORT" | "PASS",
      confidence_score: result.confidence_score as number,
      reasoning_summary: result.reasoning_summary as string,
      thesis_bullets: (result.thesis_bullets ?? []) as string[],
      risk_flags: (result.risk_flags ?? []) as string[],
      entry_price: (result.entry_price as number) ?? null,
      target_price: (result.target_price as number) ?? null,
      stop_loss: (result.stop_loss as number) ?? null,
      hold_duration: (result.hold_duration as string) ?? "SWING",
      signal_types: (result.signal_types ?? []) as string[],
      company_name: (result.company_name as string) ?? null,
      exchange: (result.exchange as string) ?? null,
      sources: sources.map((s) => ({
        provider: s.provider,
        title: s.title,
        url: s.url,
        excerpt: s.excerpt,
      })),
      fundamentals: (result.fundamentals as ThesisCardData["fundamentals"]) ?? null,
      status: (result.status as ThesisCardData["status"]) ?? undefined,
    };

    return (
      <div className="my-2">
        <ThesisCard {...thesis} />
      </div>
    );
  };

  useAssistantToolUI({ toolName: "record_thesis", render: thesisRender });
  // Backward compat alias for old persisted messages
  useAssistantToolUI({ toolName: "show_thesis", render: thesisRender });

  // ── Portfolio state → kept for backward compat with old persisted messages ──
  useAssistantToolUI({
    toolName: "get_portfolio_state",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Loading portfolio state</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={BarChart3} label="Fetching positions and theses" status="active" />
              <ChainOfThoughtStep icon={Activity} label="Loading account balances" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      if (result.error) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Portfolio state failed: {String(result.error)}
          </div>
        );
      }

      return (
        <div className="my-2">
          <PortfolioReviewCard
            run_theses={(result.run_theses ?? []) as PortfolioReviewData["run_theses"]}
            open_positions={(result.open_positions ?? []) as PortfolioReviewData["open_positions"]}
            watchlist={(result.watchlist ?? []) as PortfolioReviewData["watchlist"]}
            account={(result.account ?? { cash: 0, buying_power: 0, portfolio_value: 0 }) as PortfolioReviewData["account"]}
          />
        </div>
      );
    },
  });

  // ── Close position → inline result card ─────────────────────────
  useAssistantToolUI({
    toolName: "close_position",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border px-3 py-2">
            Closing position…
          </div>
        );
      }

      // NO_POSITION or FAILED — clean inline message
      if (result.status === "NO_POSITION") {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border px-3 py-2">
            {String(result.message)}
          </div>
        );
      }

      if (result.status === "FAILED" || result.success === false) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Close failed: {String(result.message)}
          </div>
        );
      }

      const pnl = typeof result.realized_pnl === "number" ? result.realized_pnl : 0;

      return (
        <div className="my-2">
          <TradeCard
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            entryPrice={typeof result.entry_price === "number" ? result.entry_price : 0}
            shares={typeof result.closed_qty === "number" ? result.closed_qty : undefined}
            closePrice={typeof result.close_price === "number" ? result.close_price : undefined}
            realizedPnl={pnl}
            outcome={(result.outcome as "WIN" | "LOSS" | "BREAKEVEN") ?? null}
            status="CLOSED"
          />
        </div>
      );
    },
  });

  // ── Place trade → OrderConfirm (pending) / TradeCard (filled) ─────
  useAssistantToolUI({
    toolName: "place_trade",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 max-w-md">
            <OrderConfirm
              data={{
                productName: "Placing trade…",
                productVariant: "Submitting to Alpaca Paper",
              }}
              control={{ isLoading: true }}
            />
          </div>
        );
      }

      if (result.status === "FAILED" || result.success === false) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Trade failed: {String(result.message)}
          </div>
        );
      }

      return (
        <div className="my-2">
          <TradeCard
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            entryPrice={typeof result.entry_price === "number" ? result.entry_price : 0}
            shares={typeof result.shares === "number" ? result.shares : undefined}
            targetPrice={typeof result.target_price === "number" ? result.target_price : undefined}
            stopLoss={typeof result.stop_loss === "number" ? result.stop_loss : undefined}
            status="OPEN"
          />
        </div>
      );
    },
  });

  // ── Run summary → DecisionSummaryCard ──────────────────────────────────
  // Shared render for complete_run (new) and summarize_run (backward compat alias)
  const runSummaryRender = ({ result }: { result?: Record<string, unknown> }) => {
    if (!result) {
      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Portfolio synthesis</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep icon={BarChart3} label="Ranking picks by conviction" status="active" />
            <ChainOfThoughtStep icon={Activity} label="Calculating exposure" status="pending" />
          </ChainOfThoughtContent>
        </ChainOfThought>
      );
    }

    const rankedPicks = (result.ranked_picks ?? []) as {
      rank: number;
      ticker: string;
      direction: string;
      confidence: number;
      reasoning: string;
      action: string;
    }[];

    const exposure = result.exposure_breakdown as {
      long_exposure: number;
      short_exposure: number;
      net_exposure: number;
      sector_concentration?: string;
    } | null;

    // Decision picks for the V2 DecisionSummaryCard
    const decisionPicks = rankedPicks.map((p) => ({
      rank: p.rank,
      ticker: p.ticker,
      direction: p.direction,
      confidence: p.confidence,
      reasoning: p.reasoning,
      action: p.action,
    }));

    return (
      <div className="my-2">
        <DecisionSummaryCard
          rankedPicks={decisionPicks}
          marketSummary={result.market_summary as string}
          exposureBreakdown={
            exposure
              ? {
                  longExposure: exposure.long_exposure,
                  shortExposure: exposure.short_exposure,
                  netExposure: exposure.net_exposure,
                }
              : undefined
          }
          riskNotes={(result.risk_notes ?? []) as string[]}
          overallAssessment={result.overall_assessment as string}
          portfolioReview={result.portfolio_review as string | undefined}
        />
      </div>
    );
  };

  useAssistantToolUI({ toolName: "complete_run", render: runSummaryRender });
  // Backward compat alias for old persisted messages
  useAssistantToolUI({ toolName: "summarize_run", render: runSummaryRender });

  // ── Watchlist management → inline status card ───────────────────────
  useAssistantToolUI({
    toolName: "manage_watchlist",
    render: ({ args, result }) => {
      const action = (args?.action as string) ?? "";
      const ticker = (args?.ticker as string) ?? "";
      const reason = (args?.reason as string) ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>
              {action === "ADD" ? `Adding $${ticker} to watchlist` : action === "REMOVE" ? `Removing $${ticker} from watchlist` : `Updating $${ticker} watchlist entry`}
            </ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Eye} label={`${action} watchlist item`} status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const success = result.success as boolean;
      const changed = result.changed as boolean;
      const watchlistItem = result.watchlist_item as Record<string, unknown> | undefined;
      const priority = watchlistItem?.priority as string | undefined;

      return (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            {success && changed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {action === "ADD" ? `Added $${ticker} to watchlist` : action === "REMOVE" ? `Removed $${ticker} from watchlist` : `Updated $${ticker}`}
            </span>
            {priority && priority !== "NORMAL" && (
              <Badge variant="outline" className="text-[10px]">{priority}</Badge>
            )}
            {!!watchlistItem?.thesis_direction && (
              <Badge variant="outline" className="text-[10px]">{String(watchlistItem.thesis_direction)}</Badge>
            )}
          </div>
          {reason && (
            <p className="text-xs text-muted-foreground mt-1.5 ml-6">{reason}</p>
          )}
          {!!watchlistItem?.catalyst && (
            <p className="text-xs text-muted-foreground mt-1 ml-6">Catalyst: {String(watchlistItem.catalyst)}</p>
          )}
        </Card>
      );
    },
  });
}

// ─── Registration hooks ─────────────────────────────────────────────────────

/**
 * Register suggest_config tool UI for the builder (shows full config card + create button).
 * Also registers research tool UIs with domain cards where possible.
 */
export function useRegisterBuilderToolUIs() {
  // Reuse the SAME research tool UIs as the agent run (domain cards)
  useRegisterResearchToolUIs();

  // Builder-only: suggest_config renders as config card + create button
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigRender,
  });
}

/**
 * Register suggest_config tool UI for the editor (shows diff card + apply button).
 * Also registers research tool UIs with domain cards where possible.
 */
export function useRegisterEditorToolUIs() {
  // Reuse the SAME research tool UIs as the agent run (domain cards)
  useRegisterResearchToolUIs();

  // Editor-only: suggest_config renders as diff card + apply button
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigEditorRender,
  });
}
