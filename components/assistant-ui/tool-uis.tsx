"use client";

import { createContext, useContext, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAssistantToolUI } from "@assistant-ui/react";
import {
  ArrowRight,
  Check,
  TrendingUp,
  TrendingDown,
  FileText,
  MessageSquare,
  BarChart3,
  Search,
  Newspaper,
  LineChart,
  Calendar,
  Activity,
  MessageSquareText,
  CheckCircle2,
  Target,
  Users,
  Globe,
  ExternalLink,
  Flame,
  Briefcase,
  GitCompare,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AgentConfigCard,
  type AgentConfigData,
} from "@/components/domain/agent-config-card";
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
  RunSummaryCard,
  SecFilingsCard,
  AnalystTargetsCard,
  PeersCard,
} from "@/components/domain";
import { ThesisArtifactSheet } from "@/components/research/ThesisArtifactSheet";
import { XPost } from "@/components/manifest-ui/x-post";
import { PostList } from "@/components/manifest-ui/post-list";
import { OrderConfirm } from "@/components/manifest-ui/order-confirm";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";
import { Citation } from "@/components/tool-ui/citation";
import type { CitationType } from "@/components/tool-ui/citation";
import { StockLogo } from "@/components/StockLogo";
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

// ─── Source helpers (shared by research tool UIs) ───────────────────────────

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
  twitter: "stocktwits.com",
  "fmp social": "financialmodelingprep.com",
  technical: "finnhub.io",
  earnings: "finnhub.io",
  options: "financialmodelingprep.com",
};

const PROVIDER_TYPES: Record<string, CitationType> = {
  finnhub: "api",
  fmp: "api",
  reddit: "webpage",
  stocktwits: "webpage",
  twitter: "webpage",
  "fmp social": "api",
  technical: "api",
  earnings: "api",
  options: "api",
};

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

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

// ─── Research tool UI registrations (agent run) ─────────────────────────────

/**
 * Register all 15 research tool UIs for the agent run.
 * Extracted from AgentThread.tsx — renders domain cards with ChainOfThought loading.
 */
export function useRegisterResearchToolUIs(_runId: string) {
  // ── Market overview → MarketContextCard ─────────────────────────────
  useAssistantToolUI({
    toolName: "get_market_overview",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Market conditions</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={TrendingUp} label="Fetching S&P 500, VIX" status="active" />
              <ChainOfThoughtStep icon={BarChart3} label="Loading sector performance" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

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

      const apiErrors = result.api_errors as string[] | undefined;

      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Market conditions</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={TrendingUp} label="Fetched S&P 500, VIX" status="complete" />
              <ChainOfThoughtStep icon={BarChart3} label={`Loaded ${sectors.length} sector ETFs`} status="complete" />
              {apiErrors?.length ? (
                <ChainOfThoughtStep icon={Activity} label={`Data issues: ${apiErrors.slice(0, 2).join("; ")}`} status="active" />
              ) : null}
            </ChainOfThoughtContent>
          </ChainOfThought>
          <MarketContextCard
            regime={regime}
            spxChange={spy?.change_pct}
            vixLevel={vix?.level}
            topSectors={topSectors}
            bottomSectors={bottomSectors}
            todaysApproach={apiErrors?.length ? `Data issues: ${apiErrors.slice(0, 2).join("; ")}` : ""}
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
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Scanning for candidates</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Search} label="Checking earnings calendar" status="active" />
              <ChainOfThoughtStep icon={TrendingUp} label="Scanning gainers & losers" status="pending" />
              <ChainOfThoughtStep icon={Activity} label="Social trends (StockTwits)" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
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
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Scanning for candidates</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Search} label={`Found ${earnings.length} earnings catalysts`} status="complete" />
              <ChainOfThoughtStep icon={TrendingUp} label={`Found ${movers.length} top movers`} status="complete" />
              <ChainOfThoughtStep icon={Activity} label="Checked StockTwits trending" status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
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

  // ── Stock data → StockCard + PostList (news) ──────────────────────
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
          <ChainOfThought>
            <ChainOfThoughtHeader>Researched {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Search} label={`Quote: $${quote?.price?.toFixed(2) ?? "—"} (${quote?.change_pct != null ? (quote.change_pct >= 0 ? "+" : "") + quote.change_pct.toFixed(2) + "%" : "—"})`} status="complete" />
              <ChainOfThoughtStep icon={BarChart3} label={company?.name ? `${company.name} — ${company.sector ?? "Unknown sector"}` : "Company profile loaded"} status="complete" />
              <ChainOfThoughtStep icon={Newspaper} label={`${news.length} news article${news.length !== 1 ? "s" : ""} found`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
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
          {news.length > 0 && (
            <PostList
              data={{
                posts: news.slice(0, 5).map((article) => ({
                  title: article.headline,
                  excerpt: article.summary || undefined,
                  category: article.source,
                  publishedAt: article.date,
                  url: article.url,
                })),
              }}
              actions={{
                onReadMore: (post) => {
                  if (post.url) window.open(post.url, "_blank", "noopener,noreferrer");
                },
              }}
              appearance={{ variant: "carousel", showAuthor: false }}
            />
          )}
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Technical analysis → TechnicalCard ────────────────────────────
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
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-1.5">
            {String(result.error)}
          </div>
        );
      }

      const rsi = result.rsi_14 as number | null;
      const trend = result.trend as string | null;

      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Technical analysis — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={LineChart} label={rsi != null ? `RSI-14: ${rsi.toFixed(1)}` : "RSI computed"} status="complete" />
              <ChainOfThoughtStep icon={Activity} label={trend ? `Trend: ${trend}` : "SMA crossover analysis"} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <TechnicalCard
            ticker={ticker}
            currentPrice={result.current_price as number}
            rsi14={rsi}
            sma20={result.sma_20 as number | null}
            sma50={result.sma_50 as number | null}
            priceVsSma20={result.price_vs_sma20 as string | null}
            priceVsSma50={result.price_vs_sma50 as string | null}
            positionIn52wRange={result.position_in_52w_range as string | null}
            volumeRatio={result.volume_ratio as string | null}
            trend={trend}
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Earnings data → EarningsCard ──────────────────────────────────
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
          <ChainOfThought>
            <ChainOfThoughtHeader>Earnings intelligence — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Calendar} label={nextEarnings ? `Next earnings: ${nextEarnings.date}` : "No upcoming earnings"} status="complete" />
              <ChainOfThoughtStep icon={BarChart3} label={`${quarters.length} quarters analyzed — beat rate: ${result.beat_rate ?? "—"}`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
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

  // ── Options flow → OptionsFlowCard ────────────────────────────────
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

      const signal = result.signal as string;
      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Options flow — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Activity} label={`P/C ratio: ${result.put_call_ratio ?? "—"} — Signal: ${signal ?? "neutral"}`} status="complete" />
              <ChainOfThoughtStep icon={BarChart3} label={`${result.contracts_available ?? 0} contracts analyzed`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <OptionsFlowCard
            ticker={ticker}
            putCallRatio={result.put_call_ratio as number | null}
            totalCallVolume={result.total_call_volume as number}
            totalPutVolume={result.total_put_volume as number}
            expiration={result.expiration as string}
            contractsAvailable={result.contracts_available as number}
            signal={signal}
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Reddit sentiment → XPost cards ────────────────────────────────
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

      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Reddit sentiment — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={MessageSquareText} label={`Scanned WSB, r/stocks, r/options, r/investing`} status="complete" />
              <ChainOfThoughtStep icon={Search} label={`${mentionCount ?? 0} mentions — sentiment: ${sentiment ?? "unknown"}`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          {sources.length > 0 && (
            <div className="space-y-1.5">
              {sources.slice(0, 5).map((s, i) => (
                <XPost
                  key={i}
                  data={{
                    author: s.provider || "Reddit",
                    username: s.provider?.replace(/^r\//, "") || "reddit",
                    avatar: "R",
                    content: s.title || "Untitled post",
                    likes: s.score != null ? String(s.score) : undefined,
                  }}
                />
              ))}
            </div>
          )}
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── StockTwits sentiment → XPost cards ────────────────────────────
  useAssistantToolUI({
    toolName: "get_twitter_sentiment",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>StockTwits sentiment — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={MessageSquareText} label="Scanning StockTwits feed" status="active" />
              <ChainOfThoughtStep icon={Search} label="Checking FMP social sentiment" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      if (!result.available) {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border border-dashed px-3 py-1.5">
            <MessageSquare className="inline h-3 w-3 mr-1 text-blue-500" />
            No StockTwits data available for {ticker}.
          </div>
        );
      }

      const postsList = (result.posts ?? []) as {
        body: string;
        username: string;
        created_at?: string;
        likes?: number;
      }[];
      const sentiment = result.sentiment as string | undefined;
      const mentionCount = result.mention_count as number | undefined;

      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>StockTwits sentiment — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={MessageSquareText} label="Scanned StockTwits feed" status="complete" />
              <ChainOfThoughtStep icon={Search} label={`${mentionCount ?? 0} posts — sentiment: ${sentiment ?? "unknown"}`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          {postsList.length > 0 && (
            <div className="space-y-1.5">
              {postsList.slice(0, 5).map((p, i) => (
                <XPost
                  key={i}
                  data={{
                    author: p.username,
                    username: p.username,
                    content: p.body,
                    likes: p.likes != null && p.likes > 0 ? String(p.likes) : undefined,
                    time: p.created_at,
                  }}
                />
              ))}
            </div>
          )}
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── SEC Filings → SecFilingsCard ──────────────────────────────────
  useAssistantToolUI({
    toolName: "get_sec_filings",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>SEC filings — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={FileText} label="Looking up CIK on EDGAR" status="active" />
              <ChainOfThoughtStep icon={Search} label="Fetching recent filings" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }
      const filings = (result.filings ?? result) as { type: string; date: string; description: string; url?: string | null }[];
      const filingsArr = Array.isArray(filings) ? filings : [];
      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>SEC filings — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={FileText} label="Looked up CIK on EDGAR" status="complete" />
              <ChainOfThoughtStep icon={Search} label={`Found ${filingsArr.length} recent filings`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <SecFilingsCard ticker={ticker} filings={filingsArr} />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Analyst Targets → AnalystTargetsCard ──────────────────────────
  useAssistantToolUI({
    toolName: "get_analyst_targets",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Analyst targets — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Target} label="Fetching Wall Street consensus" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }
      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Analyst targets — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Target} label={`${result.num_analysts ?? 0} analysts — consensus: $${(result.consensus_target as number)?.toFixed(2) ?? "—"}`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <AnalystTargetsCard
            ticker={ticker}
            consensusTarget={result.consensus_target as number | null}
            high={result.high as number | null}
            low={result.low as number | null}
            median={result.median as number | null}
            numAnalysts={result.num_analysts as number | null}
            currentPrice={result.current_price as number | null}
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Company Peers → PeersCard ─────────────────────────────────────
  useAssistantToolUI({
    toolName: "get_company_peers",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Company peers — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Users} label="Fetching peer companies" status="active" />
              <ChainOfThoughtStep icon={BarChart3} label="Loading comparison metrics" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }
      const peers = (result.peers ?? []) as { ticker: string; name?: string; price?: number | null; change_pct?: number | null; pe_ratio?: number | null; market_cap?: number | null }[];
      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>Company peers — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Users} label={`Found ${peers.length} peer companies`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <PeersCard
            ticker={ticker}
            peers={peers}
            sector={result.sector as string | undefined}
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── News Deep Dive → PostList ─────────────────────────────────────
  useAssistantToolUI({
    toolName: "get_news_deep_dive",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>News deep dive — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Newspaper} label="Fetching stock news" status="active" />
              <ChainOfThoughtStep icon={FileText} label="Loading press releases" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }
      const stockNews = (result.stock_news ?? []) as { headline: string; source: string; url?: string; published_at?: string }[];
      const pressReleases = (result.press_releases ?? []) as { headline: string; source: string; url?: string; published_at?: string }[];
      const allNews = [...stockNews, ...pressReleases].map((n) => ({
        headline: n.headline,
        source: n.source,
        url: n.url,
        date: n.published_at,
      }));

      if (allNews.length === 0) {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border border-dashed px-3 py-1.5">
            No additional news found for {ticker}.
          </div>
        );
      }

      return (
        <div className="my-2">
          <ChainOfThought>
            <ChainOfThoughtHeader>News deep dive — {ticker}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Newspaper} label={`${stockNews.length} news articles`} status="complete" />
              <ChainOfThoughtStep icon={FileText} label={`${pressReleases.length} press releases`} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <PostList
            data={{
              posts: allNews.slice(0, 5).map((article) => ({
                title: article.headline,
                category: article.source,
                publishedAt: article.date,
                url: article.url,
              })),
            }}
            actions={{
              onReadMore: (post) => {
                if (post.url) window.open(post.url, "_blank", "noopener,noreferrer");
              },
            }}
            appearance={{ variant: "carousel", showAuthor: false }}
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Thesis → slim pill + ThesisArtifactSheet ──────────────────────
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
                      ? "bg-positive/10 text-positive"
                      : "bg-negative/10 text-negative",
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

              <Badge
                variant="secondary"
                className={cn(
                  "ml-auto flex items-center justify-center rounded-full size-7 text-[11px] font-bold tabular-nums",
                  thesis.confidence_score >= 80
                    ? "bg-positive/10 text-positive"
                    : thesis.confidence_score >= 60
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {thesis.confidence_score}
              </Badge>
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
                    <span className="tabular-nums font-medium text-positive">
                      ${thesis.target_price!.toFixed(2)}
                    </span>
                  </span>
                )}
                {thesis.stop_loss != null && (
                  <span>
                    <span className="text-muted-foreground uppercase tracking-wide">Stop</span>{" "}
                    <span className="tabular-nums font-medium text-negative">
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

      const status = result.status as string;

      if (status === "failed") {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Trade failed: {String(result.error || result.note || "Unknown error")}
          </div>
        );
      }

      return (
        <div className="my-2">
          <TradeCard
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            entryPrice={(result.fill_price as number) ?? (result.entry_price as number)}
            shares={result.shares as number}
            targetPrice={result.target_price as number | undefined}
            stopLoss={result.stop_loss as number | undefined}
            status="OPEN"
          />
        </div>
      );
    },
  });

  // ── Run summary → RunSummaryCard ──────────────────────────────────
  useAssistantToolUI({
    toolName: "summarize_run",
    render: ({ result }) => {
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

// ─── Builder/Editor tool UIs ────────────────────────────────────────────────

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

/** Builder/editor get_market_context → MarketContextCard (domain card) */
const BuilderMarketContextRender: ToolCallMessagePartComponent = ({ result, status }) => {
  const r = (result ?? {}) as Record<string, unknown>;

  if (status?.type !== "complete" && !result) {
    return (
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader>Market conditions</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep icon={TrendingUp} label="Fetching SPY, VIX" status="active" />
          <ChainOfThoughtStep icon={BarChart3} label="Loading sectors" status="pending" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    );
  }

  if (r.error) return null;

  const spy = r.spy as Record<string, unknown> | null;
  const vix = r.vix as Record<string, unknown> | null;
  const sectors = Array.isArray(r.sectors) ? r.sectors as Array<Record<string, unknown>> : [];

  const spxChange = spy ? Number(spy.change ?? 0) : undefined;
  const vixLevel = vix ? Number(vix.level ?? 0) : undefined;

  const topSectors = sectors
    .filter((s) => Number(s.changesPercentage ?? s.change ?? 0) > 0)
    .slice(0, 3)
    .map((s) => ({
      name: String(s.sector ?? "").replace("Services", "").trim(),
      change: Number(s.changesPercentage ?? s.change ?? 0),
    }));
  const bottomSectors = sectors
    .filter((s) => Number(s.changesPercentage ?? s.change ?? 0) < 0)
    .slice(-3)
    .reverse()
    .map((s) => ({
      name: String(s.sector ?? "").replace("Services", "").trim(),
      change: Number(s.changesPercentage ?? s.change ?? 0),
    }));

  const regime: MarketContextData["regime"] =
    vixLevel && vixLevel > 25
      ? "volatile"
      : spxChange && spxChange > 0.5
        ? "trending_up"
        : spxChange && spxChange < -0.5
          ? "trending_down"
          : "range_bound";

  return (
    <div className="my-2">
      <MarketContextCard
        regime={regime}
        spxChange={spxChange}
        vixLevel={vixLevel}
        topSectors={topSectors}
        bottomSectors={bottomSectors}
        todaysApproach=""
      />
      <SourceChips sources={extractToolSources(r)} />
    </div>
  );
};
BuilderMarketContextRender.displayName = "BuilderMarketContextRender";

/** Builder/editor search_reddit → XPost cards (domain card) */
const BuilderRedditRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  const results = Array.isArray(r.results) ? r.results as Array<Record<string, unknown>> : [];
  const query = String(a.query ?? r.query ?? "");

  if (status?.type !== "complete" && !result) {
    return (
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader>Reddit — {query}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep icon={MessageSquareText} label="Searching Reddit communities" status="active" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className="my-2">
      <ChainOfThought>
        <ChainOfThoughtHeader>Reddit — {query}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep icon={MessageSquareText} label={`Found ${results.length} posts`} status="complete" />
        </ChainOfThoughtContent>
      </ChainOfThought>
      <div className="space-y-1.5">
        {results.slice(0, 5).map((post, i) => (
          <XPost
            key={i}
            data={{
              author: `r/${String(post.subreddit ?? "")}`,
              username: String(post.subreddit ?? "reddit"),
              avatar: "R",
              content: String(post.title ?? "Untitled post"),
              likes: post.score != null ? String(post.score) : undefined,
            }}
          />
        ))}
      </div>
      <SourceChips sources={extractToolSources(r)} />
    </div>
  );
};
BuilderRedditRender.displayName = "BuilderRedditRender";

/** Builder/editor get_stock_quote → StockCard (domain card) */
const BuilderStockQuoteRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  const ticker = String(a.symbol ?? r.ticker ?? "").toUpperCase();

  if (status?.type !== "complete" && !result) {
    return (
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader>Fetching {ticker}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep icon={Search} label={`Loading quote for ${ticker}`} status="active" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    );
  }

  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }

  return (
    <div className="my-2">
      <StockCard
        ticker={ticker}
        companyName={typeof r.name === "string" ? r.name : undefined}
        price={typeof r.price === "number" ? r.price : null}
        change={typeof r.change === "number" ? r.change : null}
        changePct={typeof r.changePercent === "number" ? r.changePercent : null}
        exchange={typeof r.exchange === "string" ? r.exchange : null}
        marketCap={typeof r.marketCap === "number" ? r.marketCap : null}
        dayHigh={typeof r.dayHigh === "number" ? r.dayHigh : null}
        dayLow={typeof r.dayLow === "number" ? r.dayLow : null}
        high52w={typeof r.yearHigh === "number" ? r.yearHigh : null}
        low52w={typeof r.yearLow === "number" ? r.yearLow : null}
      />
      <SourceChips sources={extractToolSources(r)} />
    </div>
  );
};
BuilderStockQuoteRender.displayName = "BuilderStockQuoteRender";

// ─── Trending Stocks tool UI ────────────────────────────────────────────────

const TrendingStocksRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  const category = String(a.category ?? r.category ?? "gainers");
  const stocks = Array.isArray(r.stocks) ? (r.stocks as Array<Record<string, unknown>>) : [];

  if (status?.type !== "complete" && !result) {
    return (
      <div className="my-2 rounded-lg border p-3 flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
        <Flame className="h-4 w-4" />
        Loading trending {category}…
      </div>
    );
  }

  if (stocks.length === 0) return null;

  const categoryLabel = category === "actives" ? "Most Active" : category.charAt(0).toUpperCase() + category.slice(1);

  return (
    <div className="my-2 rounded-lg border overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/20 flex items-center gap-2">
        <Flame className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Trending: {categoryLabel}
        </span>
      </div>
      <div className="divide-y">
        {stocks.slice(0, 8).map((stock, i) => {
          const pct = Number(stock.changePercent ?? 0);
          const isUp = pct >= 0;
          return (
            <div key={i} className="px-3 py-2 flex items-center gap-3 hover:bg-muted/10 transition-colors">
              <StockLogo ticker={String(stock.ticker ?? "")} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold font-mono">
                    {String(stock.ticker ?? "")}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {String(stock.name ?? "")}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm tabular-nums font-semibold">
                  ${Number(stock.price ?? 0).toFixed(2)}
                </p>
                <p
                  className={cn(
                    "text-xs tabular-nums font-mono",
                    isUp ? "text-emerald-500" : "text-red-500"
                  )}
                >
                  {isUp ? "+" : ""}{pct.toFixed(2)}%
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
TrendingStocksRender.displayName = "TrendingStocksRender";

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
    render: BuilderMarketContextRender,
  });
  useAssistantToolUI({
    toolName: "search_reddit",
    render: BuilderRedditRender,
  });
  // Research pipeline tools
  useAssistantToolUI({ toolName: "research_ticker", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "get_thesis", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "compare_tickers", render: CompareTickersRender });
  useAssistantToolUI({ toolName: "explain_decision", render: ExplainDecisionRender });
  // Inline stock tools — now using StockCard domain card
  useAssistantToolUI({ toolName: "get_stock_quote", render: BuilderStockQuoteRender });
  useAssistantToolUI({ toolName: "get_trending_stocks", render: TrendingStocksRender });
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
    render: BuilderMarketContextRender,
  });
  useAssistantToolUI({
    toolName: "search_reddit",
    render: BuilderRedditRender,
  });
  // Research pipeline tools
  useAssistantToolUI({ toolName: "research_ticker", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "get_thesis", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "compare_tickers", render: CompareTickersRender });
  useAssistantToolUI({ toolName: "explain_decision", render: ExplainDecisionRender });
  // Inline stock tools — now using StockCard domain card
  useAssistantToolUI({ toolName: "get_stock_quote", render: BuilderStockQuoteRender });
  useAssistantToolUI({ toolName: "get_trending_stocks", render: TrendingStocksRender });
}

/** @deprecated Use useRegisterBuilderToolUIs or useRegisterEditorToolUIs */
export const useRegisterToolUIs = useRegisterBuilderToolUIs;

// ─── Trading / Research / Portfolio tool UIs (run-followup chat) ────────────

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
