"use client";

/**
 * AgentThread — the REAL agent UI.
 *
 * Compact tool UIs render tight data cards for every tool call:
 * - Market overview → MarketContextCard (compact)
 * - Scan candidates → ScanResultsCard (chip grid)
 * - Stock data → StockCard (inline → sheet) + NewsCard (post-list)
 * - Technical analysis → TechnicalCard (reasoning block)
 * - Earnings data → EarningsCard (compact rows)
 * - Options flow → OptionsFlowCard (compact)
 * - Reddit sentiment → collapsible reasoning block
 * - show_thesis → slim pill → ThesisArtifactSheet
 * - place_trade → TradeConfirmation → TradeCard
 * - summarize_run → RunSummaryCard
 */

import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  useAssistantToolUI,
  useThreadRuntime,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { HindsightComposer } from "@/components/assistant-ui/hindsight-composer";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  Bot,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
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
import { createTrade } from "@/lib/actions/trade.actions";

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentThreadProps {
  runId: string;
  analystName: string;
  analystId?: string;
  config: Record<string, unknown>;
  autoStart?: boolean;
  initialMessages?: unknown[];
}

// ─── Shared: compact spinner ────────────────────────────────────────────────

function ToolSpinner({
  label,
  color = "blue",
}: {
  label: string;
  color?: string;
}) {
  return (
    <div className="my-1.5 flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "h-3 w-3 rounded-full border-2 border-muted-foreground/20 animate-spin",
          color === "blue" && "border-t-blue-500",
          color === "cyan" && "border-t-cyan-500",
          color === "amber" && "border-t-amber-500",
          color === "purple" && "border-t-purple-500",
          color === "orange" && "border-t-orange-500",
          color === "emerald" && "border-t-emerald-500",
          color === "violet" && "border-t-violet-500",
        )}
      />
      {label}
    </div>
  );
}

// ─── Shared: reasoning block (uses ai-elements Reasoning) ──────────────────

function ReasoningBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Reasoning defaultOpen={defaultOpen} className="my-2">
      <ReasoningTrigger
        getThinkingMessage={() => <span>{title}</span>}
      />
      <ReasoningContent className="px-1">
        {children}
      </ReasoningContent>
    </Reasoning>
  );
}

// ─── Shared: source chips (ai-elements Sources) ────────────────────────────

import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from "@/components/ai-elements/chain-of-thought";
import { Citation } from "@/components/tool-ui/citation";
import type { CitationType } from "@/components/tool-ui/citation";
import {
  BarChart3,
  Search,
  Newspaper,
  LineChart,
  Calendar,
  Activity,
  MessageSquareText,
  CheckCircle2,
} from "lucide-react";

// ─── Source data shape (matches _sources from tool results) ─────────────────

interface SourceData {
  provider: string;
  title: string;
  url?: string;
  excerpt?: string;
}

const PROVIDER_DOMAINS: Record<string, string> = {
  finnhub: "finnhub.io",
  fmp: "financialmodelingprep.com",
  reddit: "reddit.com",
  stocktwits: "stocktwits.com",
  technical: "finnhub.io",
  earnings: "finnhub.io",
  options: "financialmodelingprep.com",
};

const PROVIDER_TYPES: Record<string, CitationType> = {
  finnhub: "api",
  fmp: "api",
  reddit: "webpage",
  stocktwits: "webpage",
  technical: "api",
  earnings: "api",
  options: "api",
};

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

/** Extract _sources from a tool result, falling back to provider-only strings */
function extractToolSources(result: Record<string, unknown>): SourceData[] {
  const raw = result._sources;
  if (Array.isArray(raw)) {
    return raw.filter(
      (s): s is SourceData =>
        typeof s === "object" && s !== null && "provider" in s && "title" in s,
    );
  }
  return [];
}

function SourceChips({ sources }: { sources: SourceData[] }) {
  if (!sources.length) return null;
  return (
    <Sources className="mt-1.5">
      <SourcesTrigger count={sources.length} className="text-[10px]" />
      <SourcesContent>
        {sources.map((s, i) => {
          const key = s.provider.toLowerCase().replace(/[^a-z]/g, "");
          const domain =
            s.url
              ? (() => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return PROVIDER_DOMAINS[key]; } })()
              : PROVIDER_DOMAINS[key];
          const type = PROVIDER_TYPES[key] ?? "webpage";

          return (
            <Source key={`${s.provider}-${i}`} provider={s.provider}>
              <Citation
                href={s.url ?? `https://${domain ?? s.provider.toLowerCase() + ".com"}`}
                title={s.title}
                snippet={s.excerpt}
                domain={domain ?? s.provider}
                favicon={domain ? faviconUrl(domain) : undefined}
                type={type}
                variant="inline"
              />
            </Source>
          );
        })}
      </SourcesContent>
    </Sources>
  );
}

// ─── Tool UI registrations ──────────────────────────────────────────────────

function useRegisterAgentToolUIs(runId: string) {
  // ── Market overview → MarketContextCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "get_market_overview",
    render: ({ result }) => {
      if (!result) return <ToolSpinner label="Checking market conditions..." />;

      const spy = result.spy as {
        price: number;
        change_pct: number;
        day_high: number;
        day_low: number;
      } | null;
      const rawVix = result.vix as {
        level: number;
        change_pct: number;
      } | null;
      // Treat VIX of 0 or near-zero as missing data
      const vix = rawVix && rawVix.level > 0.1 ? rawVix : null;
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
        <div className="my-2">
          <MarketContextCard
            regime={regime}
            spxChange={spy?.change_pct}
            vixLevel={vix?.level}
            topSectors={topSectors}
            bottomSectors={bottomSectors}
            todaysApproach=""
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Scan candidates → ScanResultsCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "scan_candidates",
    render: ({ result }) => {
      if (!result) return <ToolSpinner label="Scanning for candidates..." />;

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
        <div className="my-2">
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

  // ── Stock data → StockCard (click-to-sheet) + NewsCard (post-list) ──
  useAssistantToolUI({
    toolName: "get_stock_data",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Researching {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Search} label={`Fetching quote for ${ticker}`} status="active" />
              <ChainOfThoughtStep icon={BarChart3} label="Loading financials" status="pending" />
              <ChainOfThoughtStep icon={Newspaper} label="Scanning news" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
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
        <div className="my-2 space-y-1.5">
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
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Technical analysis → TechnicalCard (compact) ────────────────────
  useAssistantToolUI({
    toolName: "get_technical_analysis",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Technical analysis — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={LineChart} label="Computing RSI, MACD, Bollinger" status="active" />
              <ChainOfThoughtStep icon={Activity} label="SMA crossover analysis" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      if (result.error) {
        return (
          <div className="my-1.5 text-xs text-red-500 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-1.5">
            {String(result.error)}
          </div>
        );
      }

      return (
        <div className="my-2">
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
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Earnings data → EarningsCard (compact) ──────────────────────────
  useAssistantToolUI({
    toolName: "get_earnings_data",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Earnings intelligence — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Calendar} label="Checking earnings calendar" status="active" />
              <ChainOfThoughtStep icon={BarChart3} label="Loading beat/miss history" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
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
        <div className="my-2">
          <EarningsCard
            ticker={ticker}
            nextEarnings={
              nextEarnings
                ? { date: nextEarnings.date, epsEstimate: nextEarnings.eps_estimate }
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
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Options flow → OptionsFlowCard (compact) ──────────────────────
  useAssistantToolUI({
    toolName: "get_options_flow",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Options flow — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Activity} label="Scanning unusual activity" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      if (result.available === false) {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border border-dashed px-3 py-1.5">
            No options data for {ticker}.{" "}
            {result.note && <span>{String(result.note)}</span>}
          </div>
        );
      }

      return (
        <div className="my-2">
          <OptionsFlowCard
            ticker={ticker}
            putCallRatio={result.put_call_ratio as number | null}
            totalCallVolume={result.total_call_volume as number}
            totalPutVolume={result.total_put_volume as number}
            expiration={result.expiration as string}
            contractsAvailable={result.contracts_available as number}
            signal={result.signal as string}
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Reddit sentiment → rich social card ────────────────────────────
  useAssistantToolUI({
    toolName: "get_reddit_sentiment",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reddit sentiment — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={MessageSquareText} label="Scanning WSB, r/stocks, r/options" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      if (!result.available) {
        const reason = result.reason as string | undefined;
        const isBlocked = reason === "blocked";
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border border-dashed px-3 py-1.5">
            <MessageSquare className="inline h-3 w-3 mr-1 text-orange-500" />
            {isBlocked
              ? `Reddit API rate-limited — no sentiment data for ${ticker}.`
              : `No recent Reddit mentions for ${ticker}.`}
          </div>
        );
      }

      const sources = (result.sources ?? []) as {
        provider: string;
        title?: string;
        url?: string;
        score?: number;
      }[];
      const sentiment = result.sentiment as string | undefined;
      const mentionCount = result.mention_count as number | undefined;
      const trending = result.trending as boolean | undefined;

      return (
        <div className="my-2">
          <Card className="overflow-hidden p-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-orange-500" />
                <span className="text-xs font-medium">Reddit</span>
                <span className="text-xs font-semibold font-mono">{ticker}</span>
                {mentionCount != null && (
                  <span className="text-[10px] text-muted-foreground">
                    {mentionCount} mentions
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {trending && (
                  <Badge variant="secondary" className="text-[10px] py-0 bg-orange-500/10 text-orange-500 font-semibold">
                    TRENDING
                  </Badge>
                )}
                {sentiment && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] py-0 font-semibold",
                      sentiment === "bullish" && "bg-emerald-500/10 text-emerald-500",
                      sentiment === "bearish" && "bg-red-500/10 text-red-500",
                      sentiment === "neutral" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {sentiment.toUpperCase()}
                  </Badge>
                )}
              </div>
            </div>
            {/* Posts */}
            {sources.length > 0 && (
              <div className="divide-y">
                {sources.slice(0, 5).map((s, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-4 py-2">
                    <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0 mt-0.5 w-8 text-right">
                      {s.score != null ? (s.score >= 1000 ? `${(s.score / 1000).toFixed(1)}k` : s.score) : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-foreground hover:underline line-clamp-2 leading-snug"
                        >
                          {s.title || "Untitled post"}
                        </a>
                      ) : (
                        <span className="text-xs text-foreground line-clamp-2 leading-snug">
                          {s.title || "Untitled post"}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{s.provider}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Thesis → slim pill + ThesisArtifactSheet ─────────────────────
  useAssistantToolUI({
    toolName: "show_thesis",
    render: ({ result }) => {
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

      const isLong = thesis.direction === "LONG";
      const isPass = thesis.direction === "PASS";
      const DirIcon = isLong ? TrendingUp : TrendingDown;

      return (
        <div className="my-2">
          {/* Slim thesis pill — inline summary */}
          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <span className="text-sm font-semibold font-mono">{thesis.ticker}</span>
              {!isPass ? (
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] gap-1 py-0 font-semibold",
                    isLong
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-red-500/10 text-red-500",
                  )}
                >
                  <DirIcon className="h-2.5 w-2.5" />
                  {thesis.direction}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] py-0">
                  PASS
                </Badge>
              )}

              {thesis.hold_duration && (
                <span className="text-[10px] text-muted-foreground">
                  {thesis.hold_duration}
                </span>
              )}

              <span
                className={cn(
                  "ml-auto flex items-center justify-center rounded-full size-7 text-[11px] font-bold tabular-nums",
                  thesis.confidence_score >= 80
                    ? "bg-emerald-500/15 text-emerald-500"
                    : thesis.confidence_score >= 60
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {thesis.confidence_score}
              </span>
            </div>

            {/* Entry/Target/Stop compact row */}
            {thesis.entry_price != null && !isPass && (
              <div className="flex items-center gap-4 px-4 pb-2.5 text-[10px]">
                <span>
                  <span className="text-muted-foreground uppercase tracking-wide">Entry</span>{" "}
                  <span className="tabular-nums font-medium">${thesis.entry_price!.toFixed(2)}</span>
                </span>
                {thesis.target_price != null && (
                  <span>
                    <span className="text-muted-foreground uppercase tracking-wide">Target</span>{" "}
                    <span className="tabular-nums font-medium text-emerald-500">
                      ${thesis.target_price!.toFixed(2)}
                    </span>
                  </span>
                )}
                {thesis.stop_loss != null && (
                  <span>
                    <span className="text-muted-foreground uppercase tracking-wide">Stop</span>{" "}
                    <span className="tabular-nums font-medium text-red-500">
                      ${thesis.stop_loss!.toFixed(2)}
                    </span>
                  </span>
                )}
              </div>
            )}

            {isPass && thesis.reasoning_summary && (
              <div className="px-4 pb-2.5">
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {thesis.reasoning_summary}
                </p>
              </div>
            )}
          </Card>

          {/* Open sheet for full detail */}
          {!isPass && (
            <div className="mt-1">
              <ThesisArtifactSheet thesis={thesis}>
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Full analysis
                </span>
              </ThesisArtifactSheet>
            </div>
          )}
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
            researchRunId: runId,
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
        return <ToolSpinner label="Preparing trade..." color="emerald" />;
      }

      if (tradeState === "confirmed" && tradeResult) {
        return (
          <div className="my-2">
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

      return (
        <div className="my-2">
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
        return <ToolSpinner label="Synthesizing session..." color="violet" />;
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
        <div className="my-2">
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
  initialMessages,
}: AgentThreadProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/research/agent",
        body: { runId, analystId, config },
      }),
    [runId, analystId, config],
  );

  const runtime = useChatRuntime({
    transport,
    ...(initialMessages ? { messages: initialMessages as import("ai").UIMessage[] } : {}),
  });

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

// Old DefaultComposer removed — replaced by HindsightComposer

// ─── Quick reply chips ──────────────────────────────────────────────────────

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
          <HindsightComposer
            features={{
              placeholder: "Ask a follow-up question…",
              tickerSearch: true,
              slashCommands: true,
            }}
          />
        </div>
      }
    />
  );
}
