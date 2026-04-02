"use client";

import { useAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle2, HelpCircle } from "lucide-react";

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
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
  ToolProgressTickerItem,
  ToolProgressSources,
} from "@/components/ai-elements/tool-progress";
import { ClampedText } from "@/components/ai-elements/clamped-text";

import { extractToolSources } from "./tool-ui-shared";
import { SuggestConfigRender } from "./tool-ui-config";

// ─── Research tool UI registrations ────────────────────────────────────────

export function useRegisterResearchToolUIs(_runId?: string) {
  // ── Research tools rendered by ResearchToolGroup (return null) ──────
  useAssistantToolUI({ toolName: "get_market_context", render: () => null });
  useAssistantToolUI({ toolName: "get_stock_data", render: () => null });
  useAssistantToolUI({ toolName: "get_earnings_data", render: () => null });
  useAssistantToolUI({ toolName: "get_options_flow", render: () => null });
  useAssistantToolUI({ toolName: "get_sec_filings", render: () => null });

  // ── Intelligence: Morning Brief ────────────────────────────────────
  useAssistantToolUI({
    toolName: "read_morning_brief",
    render: ({ result }) => {
      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Reading morning brief...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Loading intelligence</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const r = result as Record<string, unknown>;
      if (r.available === false) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader>No morning brief available</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem>Intelligence jobs may not have run yet</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const marketCtx = typeof r.marketContext === "string" ? r.marketContext : "";
      const alerts = Array.isArray(r.portfolioAlerts) ? r.portfolioAlerts as Record<string, unknown>[] : [];
      const watches = Array.isArray(r.watchlistUpdates) ? r.watchlistUpdates as Record<string, unknown>[] : [];
      const opps = Array.isArray(r.newOpportunities) ? r.newOpportunities as Record<string, unknown>[] : [];

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>Morning intelligence brief</ToolProgressHeader>
          <ToolProgressContent>
            {marketCtx && <ClampedText>{marketCtx}</ClampedText>}

            {alerts.map((a, i) => (
              <ToolProgressTickerItem
                key={`alert-${i}`}
                ticker={(a.ticker as string) ?? "?"}
                tag="Holding"
              >
                {(a.alert as string) ?? (a.headline as string) ?? (a.summary as string) ?? ""}
              </ToolProgressTickerItem>
            ))}

            {watches.map((w, i) => (
              <ToolProgressTickerItem
                key={`watch-${i}`}
                ticker={(w.ticker as string) ?? "?"}
                tag="Watching"
              >
                {(w.update as string) ?? (w.headline as string) ?? (w.summary as string) ?? ""}
              </ToolProgressTickerItem>
            ))}

            {opps.map((o, i) => {
              const ticker = Array.isArray(o.tickers) ? (o.tickers as string[])[0] : null;
              return (
                <ToolProgressTickerItem
                  key={`opp-${i}`}
                  ticker={ticker ?? "?"}
                  tag="Opportunity"
                >
                  {(o.thesisSeed as string) ?? (o.headline as string) ?? (o.summary as string) ?? ""}
                </ToolProgressTickerItem>
              );
            })}

            <ToolProgressSources domains={["perplexity.ai", "finnhub.io"]} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Intelligence: Signals ──────────────────────────────────────────
  useAssistantToolUI({
    toolName: "read_signals",
    render: ({ args, result }) => {
      const filterTickers = (args as Record<string, unknown>)?.tickers as string[] | undefined;

      if (!result) {
        const ctx = filterTickers?.length ? ` for ${filterTickers.join(", ")}` : "";
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Reading signals{ctx}...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Querying intelligence feed</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const r = result as Record<string, unknown>;
      const count = typeof r.count === "number" ? r.count : 0;
      const signals = Array.isArray(r.signals) ? r.signals as Record<string, unknown>[] : [];
      const urgent = signals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
      const bullish = signals.filter((s) => s.sentiment === "BULLISH").length;
      const bearish = signals.filter((s) => s.sentiment === "BEARISH").length;
      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>
            Read {count} signal{count !== 1 ? "s" : ""} ({urgent} urgent, {bullish} bullish, {bearish} bearish)
          </ToolProgressHeader>
          <ToolProgressContent>
            {signals.slice(0, 5).map((s, i) => (
              <ToolProgressItem key={i}>{s.headline as string}</ToolProgressItem>
            ))}
            {count > 5 && (
              <ToolProgressItem>+{count - 5} more signals</ToolProgressItem>
            )}
            <ToolProgressSources domains={["perplexity.ai"]} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Intelligence: Artifact ─────────────────────────────────────────
  useAssistantToolUI({
    toolName: "read_artifact",
    render: ({ result }) => {
      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Reading article...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Extracting content</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const r = result as Record<string, unknown>;
      if (r.error) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader>Article not found</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem>{String(r.error)}</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const title = typeof r.title === "string" ? r.title : "Untitled";
      const url = typeof r.url === "string" ? r.url : "";
      const content = typeof r.contentMarkdown === "string" ? r.contentMarkdown : "";
      const wordCount = content ? content.split(/\s+/).length : 0;
      let domain = "";
      try { domain = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { /* */ }

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>
            {domain ? `${domain}: ` : ""}{title} ({wordCount.toLocaleString()} words)
          </ToolProgressHeader>
          <ToolProgressContent>
            <ToolProgressItem>{title}</ToolProgressItem>
            {domain && <ToolProgressSources domains={[domain]} />}
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Thesis → ThesisCard ────────────────────────────────────────────
  const thesisRender = ({ result }: { result?: Record<string, unknown> }) => {
    if (!result) {
      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader loading>Building thesis...</ToolProgressHeader>
          <ToolProgressContent>
            <ToolProgressItem active>Generating analysis</ToolProgressItem>
          </ToolProgressContent>
        </ToolProgress>
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
  useAssistantToolUI({ toolName: "show_thesis", render: thesisRender });

  // ── Portfolio state → PortfolioReviewCard ──────────────────────────
  useAssistantToolUI({
    toolName: "get_portfolio_state",
    render: ({ result }) => {
      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Loading portfolio...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Fetching positions</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
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

  // ── Close position ─────────────────────────────────────────────────
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

  // ── Place trade → OrderConfirm / TradeCard ─────────────────────────
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

  // ── Run summary → DecisionSummaryCard ──────────────────────────────
  const runSummaryRender = ({ result }: { result?: Record<string, unknown> }) => {
    if (!result) {
      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader loading>Synthesizing decisions...</ToolProgressHeader>
          <ToolProgressContent>
            <ToolProgressItem active>Ranking picks</ToolProgressItem>
          </ToolProgressContent>
        </ToolProgress>
      );
    }

    const rankedPicks = (result.ranked_picks ?? []) as {
      rank: number; ticker: string; direction: string;
      confidence: number; reasoning: string; action: string;
    }[];

    const exposure = result.exposure_breakdown as {
      long_exposure: number; short_exposure: number; net_exposure: number;
    } | null;

    return (
      <div className="my-2">
        <DecisionSummaryCard
          rankedPicks={rankedPicks.map((p) => ({
            rank: p.rank, ticker: p.ticker, direction: p.direction,
            confidence: p.confidence, reasoning: p.reasoning, action: p.action,
          }))}
          marketSummary={result.market_summary as string}
          exposureBreakdown={exposure ? {
            longExposure: exposure.long_exposure,
            shortExposure: exposure.short_exposure,
            netExposure: exposure.net_exposure,
          } : undefined}
          riskNotes={(result.risk_notes ?? []) as string[]}
          overallAssessment={result.overall_assessment as string}
          portfolioReview={result.portfolio_review as string | undefined}
        />
      </div>
    );
  };

  useAssistantToolUI({ toolName: "complete_run", render: runSummaryRender });
  useAssistantToolUI({ toolName: "summarize_run", render: runSummaryRender });

  // ── Watchlist management ───────────────────────────────────────────
  useAssistantToolUI({
    toolName: "manage_watchlist",
    render: ({ args, result }) => {
      const action = (args?.action as string) ?? "";
      const ticker = (args?.ticker as string) ?? "";
      const reason = (args?.reason as string) ?? "";

      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>
              {action === "ADD" ? `Adding $${ticker} to watchlist` : action === "REMOVE" ? `Removing $${ticker}` : `Updating $${ticker}`}
            </ToolProgressHeader>
          </ToolProgress>
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

// ─── Builder tools ──────────────────────────────────────────────────────────

export function useRegisterBuilderToolUIs() {
  useRegisterResearchToolUIs();
  useAssistantToolUI({ toolName: "suggest_config", render: SuggestConfigRender });
}
