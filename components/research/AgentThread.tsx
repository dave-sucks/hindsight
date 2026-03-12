"use client";

/**
 * AgentThread — the REAL agent UI.
 *
 * Rich tool UIs render data-dense cards for every tool call:
 * - Market overview → MarketContextCard
 * - Scan candidates → ScanResultsCard
 * - Stock data → StockCard + NewsCard
 * - Technical analysis → TechnicalCard
 * - Earnings data → EarningsCard
 * - Options flow → OptionsFlowCard
 * - Reddit sentiment → Badge row
 * - show_thesis → ThesisCard + ThesisArtifactSheet
 * - place_trade → TradeConfirmation → TradeCard
 */

import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  useAssistantToolUI,
  useThreadRuntime,
  AuiIf,
  ComposerPrimitive,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  ArrowUpIcon,
  SquareIcon,
  Bot,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ThesisCard,
  type ThesisCardData,
  TradeCard,
  TradeConfirmation,
  MarketContextCard,
  type MarketContextData,
  StockCard,
  TechnicalCard,
  EarningsCard,
  OptionsFlowCard,
  ScanResultsCard,
  NewsCard,
  RunSummaryCard,
} from "@/components/domain";
import { ThesisArtifactSheet } from "@/components/research/ThesisArtifactSheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createTrade } from "@/lib/actions/trade.actions";

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentThreadProps {
  runId: string;
  analystName: string;
  analystId?: string;
  config: Record<string, unknown>;
  /** Auto-start: send an initial message to kick off the agent */
  autoStart?: boolean;
}

// ─── Tool UI registrations ──────────────────────────────────────────────────

function useRegisterAgentToolUIs(runId: string) {
  // ── Market overview → MarketContextCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "get_market_overview",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-blue-500 animate-spin" />
            Checking market conditions...
          </div>
        );
      }

      const spy = result.spy as {
        price: number;
        change_pct: number;
        day_high: number;
        day_low: number;
      } | null;
      const vix = result.vix as {
        level: number;
        change_pct: number;
      } | null;
      const sectors = (result.sectors ?? []) as {
        symbol: string;
        price: number;
        change_pct: number;
      }[];

      const topSectors = sectors
        .filter((s) => s.change_pct > 0)
        .slice(0, 3)
        .map((s) => ({ name: s.symbol, change: s.change_pct }));
      const bottomSectors = sectors
        .filter((s) => s.change_pct < 0)
        .slice(-3)
        .reverse()
        .map((s) => ({ name: s.symbol, change: s.change_pct }));

      const regime: MarketContextData["regime"] =
        vix && vix.level > 25
          ? "volatile"
          : spy && spy.change_pct > 0.5
            ? "trending_up"
            : spy && spy.change_pct < -0.5
              ? "trending_down"
              : "range_bound";

      return (
        <div className="my-3">
          <MarketContextCard
            regime={regime}
            spxChange={spy?.change_pct}
            vixLevel={vix?.level}
            topSectors={topSectors}
            bottomSectors={bottomSectors}
            todaysApproach=""
          />
        </div>
      );
    },
  });

  // ── Scan candidates → ScanResultsCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "scan_candidates",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-blue-500 animate-spin" />
            Scanning for candidates...
          </div>
        );
      }

      const earnings = (result.earnings ?? []) as {
        ticker: string;
        source: string;
        date?: string;
        eps_estimate?: number | null;
      }[];
      const movers = (result.movers ?? []) as {
        ticker: string;
        source: string;
        change_pct?: number;
        price?: number;
      }[];

      return (
        <div className="my-3">
          <ScanResultsCard
            earnings={earnings.map((e) => ({
              ticker: e.ticker,
              source: e.source,
              date: e.date,
              epsEstimate: e.eps_estimate,
            }))}
            movers={movers.map((m) => ({
              ticker: m.ticker,
              source: m.source,
              changePct: m.change_pct,
              price: m.price,
            }))}
            totalFound={result.total_found as number}
          />
        </div>
      );
    },
  });

  // ── Stock data → StockCard + NewsCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "get_stock_data",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-blue-500 animate-spin" />
            Fetching stock data for{" "}
            <span className="font-mono font-medium">{ticker}</span>...
          </div>
        );
      }

      const quote = result.quote as {
        price: number;
        change: number;
        change_pct: number;
        high: number;
        low: number;
      } | null;
      const company = result.company as {
        name: string;
        sector: string;
        market_cap: number | null;
        exchange: string;
      } | null;
      const financials = result.financials as {
        pe_ratio: number | null;
        pb_ratio: number | null;
        high_52w: number | null;
        low_52w: number | null;
        avg_volume_10d: number | null;
        beta: number | null;
      } | null;
      const consensus = result.analyst_consensus as {
        buy: number;
        hold: number;
        sell: number;
        strong_buy: number;
        strong_sell: number;
      } | null;
      const news = (result.news ?? []) as {
        headline: string;
        summary: string;
        source: string;
        url: string;
        date: string;
      }[];

      return (
        <div className="my-3 space-y-3">
          <StockCard
            ticker={ticker}
            companyName={company?.name}
            price={quote?.price}
            change={quote?.change}
            changePct={quote?.change_pct}
            sector={company?.sector}
            marketCap={company?.market_cap}
            exchange={company?.exchange}
            dayHigh={quote?.high}
            dayLow={quote?.low}
            peRatio={financials?.pe_ratio}
            beta={financials?.beta}
            high52w={financials?.high_52w}
            low52w={financials?.low_52w}
            avgVolume={
              financials?.avg_volume_10d
                ? financials.avg_volume_10d * 1_000_000
                : null
            }
            analystConsensus={
              consensus
                ? {
                    buy: consensus.buy,
                    hold: consensus.hold,
                    sell: consensus.sell,
                    strongBuy: consensus.strong_buy,
                    strongSell: consensus.strong_sell,
                  }
                : null
            }
          />
          {news.length > 0 && <NewsCard articles={news} ticker={ticker} />}
        </div>
      );
    },
  });

  // ── Technical analysis → TechnicalCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "get_technical_analysis",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-cyan-500 animate-spin" />
            Running technical analysis on{" "}
            <span className="font-mono font-medium">{ticker}</span>...
          </div>
        );
      }

      if (result.error) {
        return (
          <div className="my-2 text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            {String(result.error)}
          </div>
        );
      }

      return (
        <div className="my-3">
          <TechnicalCard
            ticker={ticker}
            currentPrice={result.current_price as number}
            rsi14={result.rsi_14 as number | null}
            sma20={result.sma_20 as number | null}
            sma50={result.sma_50 as number | null}
            priceVsSma20={result.price_vs_sma20 as string | null}
            priceVsSma50={result.price_vs_sma50 as string | null}
            positionIn52wRange={result.position_in_52w_range as string | null}
            volumeRatio={result.volume_ratio as string | null}
            trend={result.trend as string | null}
          />
        </div>
      );
    },
  });

  // ── Earnings data → EarningsCard ─────────────────────────────────
  useAssistantToolUI({
    toolName: "get_earnings_data",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-amber-500 animate-spin" />
            Looking up earnings for{" "}
            <span className="font-mono font-medium">{ticker}</span>...
          </div>
        );
      }

      const nextEarnings = result.next_earnings as {
        date: string;
        eps_estimate: number | null;
      } | null;
      const quarters = (result.recent_quarters ?? []) as {
        period: string;
        actual_eps: number | null;
        estimated_eps: number | null;
        surprise: number | null;
        surprise_pct: number | null;
      }[];

      return (
        <div className="my-3">
          <EarningsCard
            ticker={ticker}
            nextEarnings={
              nextEarnings
                ? {
                    date: nextEarnings.date,
                    epsEstimate: nextEarnings.eps_estimate,
                  }
                : null
            }
            beatRate={result.beat_rate as string}
            recentQuarters={quarters.map((q) => ({
              period: q.period,
              actualEps: q.actual_eps,
              estimatedEps: q.estimated_eps,
              surprise: q.surprise,
              surprisePct: q.surprise_pct,
            }))}
          />
        </div>
      );
    },
  });

  // ── Options flow → OptionsFlowCard ─────────────────────────────────
  useAssistantToolUI({
    toolName: "get_options_flow",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-purple-500 animate-spin" />
            Analyzing options flow for{" "}
            <span className="font-mono font-medium">{ticker}</span>...
          </div>
        );
      }

      // No data available
      if (result.available === false) {
        return (
          <div className="my-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            No options data available for {ticker}.{" "}
            {result.note && <span>{String(result.note)}</span>}
          </div>
        );
      }

      return (
        <div className="my-3">
          <OptionsFlowCard
            ticker={ticker}
            putCallRatio={result.put_call_ratio as number | null}
            totalCallVolume={result.total_call_volume as number}
            totalPutVolume={result.total_put_volume as number}
            expiration={result.expiration as string}
            contractsAvailable={result.contracts_available as number}
            signal={result.signal as string}
          />
        </div>
      );
    },
  });

  // ── Reddit sentiment → compact card ─────────────────────────────
  useAssistantToolUI({
    toolName: "get_reddit_sentiment",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-orange-500 animate-spin" />
            Checking Reddit sentiment for{" "}
            <span className="font-mono font-medium">{ticker}</span>...
          </div>
        );
      }

      if (!result.available) {
        return (
          <div className="my-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <MessageSquare className="inline h-3 w-3 mr-1.5 text-orange-500" />
            Reddit sentiment unavailable for {ticker}.
          </div>
        );
      }

      const sources = (result.sources ?? []) as {
        provider: string;
        title?: string;
        url?: string;
      }[];

      return (
        <div className="my-3">
          <Card className="overflow-hidden p-0">
            <div className="px-4 py-3 flex items-center gap-2 border-b bg-muted/20">
              <MessageSquare className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold">
                Reddit Sentiment
                <span className="ml-1.5 font-mono text-muted-foreground">
                  {ticker}
                </span>
              </span>
              <Badge
                variant="secondary"
                className="ml-auto text-[10px] tabular-nums"
              >
                {sources.length} sources
              </Badge>
            </div>
            {sources.length > 0 && (
              <div className="px-4 py-3 flex flex-wrap gap-1.5">
                {sources.map((s, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[10px] gap-1"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />
                    {s.title || s.provider}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      );
    },
  });

  // ── Thesis card → ThesisCard + ThesisArtifactSheet ─────────────────
  useAssistantToolUI({
    toolName: "show_thesis",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 border-t-amber-500 animate-spin" />
            Building thesis...
          </div>
        );
      }

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
      };

      return (
        <div className="my-3 space-y-2">
          <ThesisCard {...thesis} />
          <ThesisArtifactSheet thesis={thesis} />
        </div>
      );
    },
  });

  // ── Place trade → TradeConfirmation / TradeCard ─────────────────────
  useAssistantToolUI({
    toolName: "place_trade",
    render: ({ result }) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [tradeState, setTradeState] = useState<
        "pending" | "executing" | "confirmed" | "cancelled"
      >("pending");
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [tradeResult, setTradeResult] = useState<{
        fillPrice: number;
        tradeId: string;
      } | null>(null);

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const handleConfirm = useCallback(async () => {
        if (!result) return;
        setTradeState("executing");

        try {
          const res = await createTrade({
            thesisId: (result.thesis_id as string) ?? "",
            ticker: result.ticker as string,
            direction: result.direction as "LONG" | "SHORT",
            entryPrice: result.entry_price as number,
            shares: result.shares as number,
            targetPrice: result.target_price as number | undefined,
            stopLoss: result.stop_loss as number | undefined,
            exitStrategy: "PRICE_TARGET",
          });

          if (res.error) {
            setTradeState("cancelled");
          } else {
            setTradeResult({ fillPrice: res.fillPrice, tradeId: res.tradeId });
            setTradeState("confirmed");
          }
        } catch {
          setTradeState("cancelled");
        }
      }, [result]);

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const handleCancel = useCallback(() => {
        setTradeState("cancelled");
      }, []);

      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 border-t-emerald-500 animate-spin" />
            Preparing trade...
          </div>
        );
      }

      // Show filled trade card after confirmation
      if (tradeState === "confirmed" && tradeResult) {
        return (
          <div className="my-3">
            <TradeCard
              ticker={result.ticker as string}
              direction={result.direction as "LONG" | "SHORT"}
              entryPrice={tradeResult.fillPrice}
              shares={result.shares as number}
              targetPrice={result.target_price as number | undefined}
              stopLoss={result.stop_loss as number | undefined}
              status="OPEN"
            />
          </div>
        );
      }

      // Show confirmation card for pending/executing/cancelled
      return (
        <div className="my-3">
          <TradeConfirmation
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            estimatedPrice={result.entry_price as number}
            estimatedCost={
              (result.entry_price as number) * ((result.shares as number) || 1)
            }
            shares={result.shares as number}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            isExecuting={tradeState === "executing"}
            resolved={
              tradeState === "confirmed"
                ? "confirmed"
                : tradeState === "cancelled"
                  ? "cancelled"
                  : null
            }
          />
        </div>
      );
    },
  });

  // ── Run summary → RunSummaryCard ─────────────────────────────────
  useAssistantToolUI({
    toolName: "summarize_run",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20 border-t-violet-500 animate-spin" />
            Synthesizing research session...
          </div>
        );
      }

      const rankedPicks = (result.ranked_picks ?? []) as {
        rank: number;
        ticker: string;
        direction: "LONG" | "SHORT";
        confidence: number;
        reasoning: string;
        action: "TRADE" | "WATCH" | "PASS";
      }[];

      const exposure = result.exposure_breakdown as {
        long_exposure: number;
        short_exposure: number;
        net_exposure: number;
        sector_concentration?: string;
      } | null;

      return (
        <div className="my-3">
          <RunSummaryCard
            marketSummary={result.market_summary as string}
            rankedPicks={rankedPicks}
            exposureBreakdown={
              exposure
                ? {
                    longExposure: exposure.long_exposure,
                    shortExposure: exposure.short_exposure,
                    netExposure: exposure.net_exposure,
                    sectorConcentration: exposure.sector_concentration,
                  }
                : undefined
            }
            riskNotes={(result.risk_notes ?? []) as string[]}
            overallAssessment={result.overall_assessment as string}
          />
        </div>
      );
    },
  });
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AgentThread({
  runId,
  analystName,
  analystId,
  config,
  autoStart = true,
}: AgentThreadProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/research/agent",
        body: { runId, analystId, config },
      }),
    [runId, analystId, config],
  );

  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentThreadInner
        runId={runId}
        analystName={analystName}
        autoStart={autoStart}
      />
    </AssistantRuntimeProvider>
  );
}

// ─── Default composer (copied from thread.tsx for composerSlot use) ──────────

function DefaultComposer() {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone className="aui-composer-attachment-dropzone flex w-full flex-col rounded-2xl border border-input bg-background px-1 pt-2 outline-none transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50">
        <ComposerPrimitive.Input
          placeholder="Ask a follow-up question..."
          className="aui-composer-input mb-1 max-h-32 min-h-14 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <div className="aui-composer-action-wrapper relative mx-2 mb-2 flex items-center justify-end">
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send asChild>
              <TooltipIconButton
                tooltip="Send message"
                side="bottom"
                type="button"
                variant="default"
                size="icon"
                className="aui-composer-send size-8 rounded-full"
                aria-label="Send message"
              >
                <ArrowUpIcon className="size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <Button
                type="button"
                variant="default"
                size="icon"
                className="aui-composer-cancel size-8 rounded-full"
                aria-label="Stop generating"
              >
                <SquareIcon className="size-3 fill-current" />
              </Button>
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
}

// ─── Quick reply suggestion chips ────────────────────────────────────────────

const FOLLOW_UP_SUGGESTIONS = [
  "What's your conviction ranking?",
  "Tell me more about the risks",
  "Why did you pass on some candidates?",
  "What are you watching for tomorrow?",
];

function QuickReplies() {
  const threadRuntime = useThreadRuntime();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsub = threadRuntime.subscribe(() => {
      const state = threadRuntime.getState();
      setVisible(!state.isRunning && state.messages.length > 1);
    });
    return unsub;
  }, [threadRuntime]);

  if (!visible) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pb-2">
      {FOLLOW_UP_SUGGESTIONS.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => {
            setVisible(false);
            threadRuntime.append({
              role: "user",
              content: [{ type: "text", text }],
            });
          }}
          className="inline-flex items-center rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ─── Inner thread component ─────────────────────────────────────────────────

function AgentThreadInner({
  runId,
  analystName,
  autoStart,
}: {
  runId: string;
  analystName: string;
  autoStart: boolean;
}) {
  useRegisterAgentToolUIs(runId);

  const threadRuntime = useThreadRuntime();

  // Auto-start: send an initial "kick-off" message so the agent begins
  const hasSent = useRef(false);
  useEffect(() => {
    if (!autoStart || hasSent.current) return;
    hasSent.current = true;
    const timer = setTimeout(() => {
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: "Run" }],
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [autoStart, threadRuntime]);

  return (
    <Thread
      welcomeConfig={{
        title: analystName,
        subtitle: "Autonomous research agent",
        icon: (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 ring-1 ring-violet-500/30">
            <Bot className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
          </div>
        ),
      }}
      composerSlot={
        <div>
          <QuickReplies />
          <DefaultComposer />
        </div>
      }
    />
  );
}
