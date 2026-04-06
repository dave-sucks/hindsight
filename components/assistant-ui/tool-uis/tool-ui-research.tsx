"use client";

import { useAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle2, HelpCircle, AlertCircle, AlertTriangle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ─── Briefing status banner ────────────────────────────────────────────────
// Surfaces the post-run briefing result directly in the chat. Replaces the
// invisible "briefing_generated" RunEvent which was previously written but
// never rendered. The user must always be able to see whether the brief
// actually generated, and if not, why.

function BriefingStatusBanner({
  status,
  error,
}: {
  status: "success" | "failed" | "skipped";
  error: string | null;
}) {
  if (status === "success") {
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Portfolio briefing written</p>
            <p className="text-sm text-muted-foreground">
              GPT-4o reviewed the full session and wrote the standup brief for the next run.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-sm font-medium text-red-500">Portfolio briefing FAILED</p>
            <p className="text-sm text-muted-foreground">
              The post-run briefing did not generate. Your next session will not have updated context.
            </p>
            {error && (
              <p className="text-xs font-mono text-muted-foreground break-words pt-1">
                {error}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Portfolio briefing skipped</p>
          <p className="text-sm text-muted-foreground">
            {error ?? "No analyst linked to this run."}
          </p>
        </div>
      </div>
    </Card>
  );
}
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
} from "@/components/ai-elements/tool-progress";
import { ClampedText } from "@/components/ai-elements/clamped-text";

import { extractToolSources, SourceChips } from "./tool-ui-shared";
import { SuggestConfigRender } from "./tool-ui-config";

// ─── Shared render functions (exported for tool-ui-followup.tsx reuse) ──────

export const thesisRender = ({ result }: { result?: Record<string, unknown> }) => {
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

  const sources = extractToolSources(result);
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

export const placeTradeRender = ({ result }: { result?: Record<string, unknown> }) => {
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
        entryPrice={typeof result.entryPrice === "number" ? result.entryPrice : 0}
        shares={typeof result.shares === "number" ? result.shares : undefined}
        targetPrice={typeof result.targetPrice === "number" ? result.targetPrice : undefined}
        stopLoss={typeof result.stopLoss === "number" ? result.stopLoss : undefined}
        status="OPEN"
      />
    </div>
  );
};

export const closePositionRender = ({ result }: { result?: Record<string, unknown> }) => {
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

  return (
    <div className="my-2">
      <TradeCard
        ticker={result.ticker as string}
        direction={result.direction as "LONG" | "SHORT"}
        entryPrice={typeof result.entryPrice === "number" ? result.entryPrice : 0}
        shares={typeof result.shares === "number" ? result.shares : undefined}
        closePrice={typeof result.closePrice === "number" ? result.closePrice : undefined}
        realizedPnl={typeof result.realizedPnl === "number" ? result.realizedPnl : undefined}
        outcome={(result.outcome as "WIN" | "LOSS" | "BREAKEVEN") ?? null}
        status="CLOSED"
      />
    </div>
  );
};

// ─── Research tool UI registrations ────────────────────────────────────────

export function useRegisterResearchToolUIs(_runId?: string) {
  // ── Research tools rendered by ResearchToolGroup (return null) ──────
  useAssistantToolUI({ toolName: "get_market_context", render: () => null });
  useAssistantToolUI({ toolName: "get_stock_data", render: () => null });
  useAssistantToolUI({ toolName: "get_earnings_data", render: () => null });
  useAssistantToolUI({ toolName: "get_options_flow", render: () => null });
  useAssistantToolUI({ toolName: "get_sec_filings", render: () => null });

  // ── Intelligence: Morning Brief — generic envelope rendering ──────
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
      const summary = r.summary as string | undefined;
      const tickers = r.tickers as { ticker: string; tag?: string; summary: string }[] | undefined;
      const data = r.data as Record<string, unknown> | undefined;

      if (data?.available === false || r.available === false) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader>No morning brief available</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem>Intelligence jobs may not have run yet</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      // Read marketContext from data envelope or legacy top-level
      const marketCtx = (data?.marketContext as string) ?? (r.marketContext as string) ?? "";

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>{summary ?? "Morning intelligence brief"}</ToolProgressHeader>
          <ToolProgressContent>
            {marketCtx && <ClampedText>{marketCtx}</ClampedText>}

            {tickers && tickers.length > 0 ? (
              // Unified envelope rendering
              tickers.map((t, i) => (
                <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                  {t.summary}
                </ToolProgressTickerItem>
              ))
            ) : (
              // Fallback for old persisted runs without envelope
              <ToolProgressItem>Brief loaded</ToolProgressItem>
            )}

            <SourceChips sources={extractToolSources(r)} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Intelligence: Signals — generic envelope rendering ────────────
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
      const summary = r.summary as string | undefined;
      const tickers = r.tickers as { ticker: string; tag?: string; summary: string }[] | undefined;

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>{summary ?? "Signals loaded"}</ToolProgressHeader>
          <ToolProgressContent>
            {tickers && tickers.length > 0 ? (
              <>
                {tickers.slice(0, 8).map((t, i) => (
                  <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                    {t.summary}
                  </ToolProgressTickerItem>
                ))}
                {tickers.length > 8 && (
                  <ToolProgressItem>+{tickers.length - 8} more signals</ToolProgressItem>
                )}
              </>
            ) : (
              <ToolProgressItem>No signals found</ToolProgressItem>
            )}
            <SourceChips sources={extractToolSources(r)} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Intelligence: Artifact — generic envelope rendering ───────────
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
      const summary = r.summary as string | undefined;

      if (!summary && r.error) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader>Article not found</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem>{String(r.error)}</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>{summary ?? "Article loaded"}</ToolProgressHeader>
          <ToolProgressContent>
            <SourceChips sources={extractToolSources(r).length > 0 ? extractToolSources(r) : []} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Thesis → ThesisCard ────────────────────────────────────────────
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

  // ── Close position — direct passthrough to TradeCard ───────────────
  useAssistantToolUI({ toolName: "close_position", render: closePositionRender });

  // ── Place trade — direct passthrough to TradeCard ─────────────────
  useAssistantToolUI({ toolName: "place_trade", render: placeTradeRender });

  // ── Run summary → DecisionSummaryCard — direct passthrough ────────
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

    // Briefing status — surfaces success / failure / skipped directly in chat
    // so the user can see whether the post-run brief was actually written.
    const briefingStatus = result.briefing as "success" | "failed" | "skipped" | undefined;
    const briefingError = (result.briefingError ?? result.briefing_error) as string | null | undefined;

    return (
      <div className="my-2 space-y-2">
        <DecisionSummaryCard
          rankedPicks={(result.rankedPicks ?? result.ranked_picks ?? []) as { rank: number; ticker: string; direction: string; confidence: number; reasoning: string; action: string }[]}
          marketSummary={(result.marketSummary ?? result.market_summary ?? "") as string}
          exposureBreakdown={
            result.exposureBreakdown
              ? result.exposureBreakdown as { longExposure?: number; shortExposure?: number; netExposure?: number }
              : result.exposure_breakdown
                ? (() => {
                    const eb = result.exposure_breakdown as { long_exposure?: number; short_exposure?: number; net_exposure?: number };
                    return { longExposure: eb.long_exposure, shortExposure: eb.short_exposure, netExposure: eb.net_exposure };
                  })()
                : undefined
          }
          riskNotes={(result.riskNotes ?? result.risk_notes ?? []) as string[]}
          overallAssessment={(result.overallAssessment ?? result.overall_assessment ?? "") as string}
          portfolioReview={(result.portfolioReview ?? result.portfolio_review) as string | undefined}
        />
        {briefingStatus && (
          <BriefingStatusBanner status={briefingStatus} error={briefingError ?? null} />
        )}
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
