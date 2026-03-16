"use client";

/**
 * ResearchToolGroup — Custom ToolGroup component for MessagePrimitive.Parts.
 *
 * When consecutive tool calls are grouped by assistant-ui, this component
 * inspects the group and renders "research step" tools as steps inside a
 * single ChainOfThought block. Card-based tools (StockCard, TradeCard, etc.)
 * render normally alongside via {children}.
 *
 * To add a new tool as a CoT step instead of a card, add an entry to
 * RESEARCH_STEPS below — then set its useAssistantToolUI render to return null.
 *
 * Tools that keep cards (get_stock_data, get_news_deep_dive) are also in
 * RESEARCH_STEPS for the step label, but their useAssistantToolUI renders
 * return the card without a ChainOfThought wrapper.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Calendar,
  FileText,
  LineChart as LineChartIcon,
  MessageSquare,
  MessageSquareText,
  Newspaper,
  Search,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from "@/components/ai-elements/chain-of-thought";

// ── Research Step Registry ──────────────────────────────────────────────────

interface ResearchStepConfig {
  /** Icon for the step row */
  icon: LucideIcon;
  /** Loading label (no result yet) */
  loadingLabel: (ticker: string) => string;
  /** Completed label — receives the raw tool result */
  completeLabel: (ticker: string, result: Record<string, unknown>) => string;
  /** Data sources queried by this tool (domain strings for badges) */
  sources?: string[];
}

/** Format a number as a compact dollar amount */
function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

/** Format a percentage with sign */
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/**
 * Tools that render as ChainOfThought steps inside the grouped block.
 *
 * CoT-only tools have their useAssistantToolUI render return null.
 * Card tools (get_stock_data, get_news_deep_dive) also appear here for
 * step labels, but their useAssistantToolUI renders return just the card.
 */
export const RESEARCH_STEPS: Record<string, ResearchStepConfig> = {
  // ── Market scan phase ──────────────────────────────────────────────
  get_market_overview: {
    icon: TrendingUp,
    sources: ["finnhub.io"],
    loadingLabel: () =>
      "Checking market conditions — pulling SPY, VIX, and sector ETFs from Finnhub",
    completeLabel: (_ticker, result) => {
      const spy = result.spy as { price?: number; change_pct?: number } | null;
      const rawVix = result.vix as { level?: number } | null;
      const vix = rawVix && rawVix.level && rawVix.level > 0.1 ? rawVix : null;
      const sectors = (result.sectors ?? []) as { symbol: string; change_pct: number }[];

      const spyStr = spy ? `SPY ${fmtPrice(spy.price)} (${fmtPct(spy.change_pct)})` : "SPY data unavailable";
      const vixStr = vix ? `VIX ${vix.level!.toFixed(1)}` : "";

      const leaders = sectors.filter(s => s.change_pct > 0).slice(0, 2).map(s => s.symbol).join(", ");
      const laggards = sectors.filter(s => s.change_pct < 0).slice(-2).reverse().map(s => s.symbol).join(", ");

      let label = `Market check — ${spyStr}`;
      if (vixStr) label += `, ${vixStr}`;
      if (leaders) label += `. Leading: ${leaders}`;
      if (laggards) label += `. Lagging: ${laggards}`;
      return label;
    },
  },

  scan_candidates: {
    icon: Search,
    sources: ["finnhub.io", "financialmodelingprep.com", "stocktwits.com"],
    loadingLabel: () =>
      "Scanning for trade candidates — checking earnings calendar, market movers, and social trends",
    completeLabel: (_ticker, result) => {
      const earnings = (result.earnings ?? []) as unknown[];
      const movers = (result.movers ?? []) as unknown[];
      const total = (result.total_found as number) ?? earnings.length + movers.length;
      return `Found ${total} candidates — ${earnings.length} from earnings, ${movers.length} movers`;
    },
  },

  // ── Per-ticker research phase ──────────────────────────────────────
  get_stock_data: {
    icon: BarChart3,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) =>
      `Pulling quote, financials, and news for ${ticker} from Finnhub`,
    completeLabel: (ticker, result) => {
      const quote = result.quote as { price?: number; change_pct?: number } | null;
      const company = result.company as { name?: string; sector?: string } | null;
      const news = (result.news ?? []) as unknown[];

      let label = `Got ${ticker}`;
      if (company?.name) label += ` — ${company.name}`;
      if (quote?.price != null) label += `, ${fmtPrice(quote.price)} (${fmtPct(quote.change_pct)})`;
      if (news.length > 0) label += `. ${news.length} news article${news.length !== 1 ? "s" : ""}`;
      return label;
    },
  },

  get_technical_analysis: {
    icon: LineChartIcon,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Running technical analysis on ${ticker} — RSI, moving averages, volume`,
    completeLabel: (ticker, result) => {
      if (result.error) return `No technical data available for ${ticker}`;

      const rsi = result.rsi_14 as number | null;
      const trend = result.trend as string | null;
      const sma20 = result.price_vs_sma20 as string | null;
      const sma50 = result.price_vs_sma50 as string | null;

      let label = `Technicals for ${ticker}`;
      if (rsi != null) {
        const rsiLevel = rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : "neutral";
        label += ` — RSI ${rsi.toFixed(1)} (${rsiLevel})`;
      }
      if (sma20) label += `, ${sma20} SMA-20`;
      if (sma50) label += ` & ${sma50} SMA-50`;
      if (trend) label += `. Trend: ${trend}`;
      return label;
    },
  },

  get_earnings_data: {
    icon: Calendar,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) =>
      `Checking earnings history and upcoming reports for ${ticker}`,
    completeLabel: (ticker, result) => {
      const nextEarnings = result.next_earnings as { date?: string; eps_estimate?: number | null } | null;
      const quarters = (result.recent_quarters ?? []) as unknown[];
      const beatRate = result.beat_rate as string | undefined;

      let label = `Earnings for ${ticker}`;
      if (nextEarnings?.date) {
        label += ` — next report ${nextEarnings.date}`;
        if (nextEarnings.eps_estimate != null) label += `, est $${nextEarnings.eps_estimate.toFixed(2)}`;
      } else {
        label += ` — no upcoming report scheduled`;
      }
      if (quarters.length > 0) {
        label += `. ${quarters.length} quarters`;
        if (beatRate) label += `, beat rate: ${beatRate}`;
      }
      return label;
    },
  },

  get_options_flow: {
    icon: Activity,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Scanning unusual options activity for ${ticker} via FMP`,
    completeLabel: (ticker, result) => {
      const available = result.available !== false;
      if (!available) return `No options data available for ${ticker}`;
      const pcr = result.put_call_ratio ?? "N/A";
      const signal = (result.signal as string) ?? "neutral";
      const contracts = result.contracts_available ?? 0;
      return `Options for ${ticker} — P/C ratio ${pcr} (${signal}). ${contracts} contracts`;
    },
  },

  get_reddit_sentiment: {
    icon: MessageSquare,
    sources: ["reddit.com"],
    loadingLabel: (ticker) =>
      `Scanning Reddit for ${ticker} mentions — WSB, r/stocks, r/options, r/investing`,
    completeLabel: (ticker, result) => {
      if (!result.available) return `No Reddit mentions found for ${ticker}`;
      const mentions = result.mention_count as number | undefined;
      const sentiment = result.sentiment as string | undefined;
      let label = `Reddit for ${ticker}`;
      if (mentions != null) label += ` — ${mentions} mention${mentions !== 1 ? "s" : ""}`;
      if (sentiment) label += `, sentiment: ${sentiment}`;
      return label;
    },
  },

  get_twitter_sentiment: {
    icon: MessageSquareText,
    sources: ["stocktwits.com", "financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Checking StockTwits and social sentiment for ${ticker}`,
    completeLabel: (ticker, result) => {
      if (!result.available) return `No StockTwits data found for ${ticker}`;
      const mentions = result.mention_count as number | undefined;
      const sentiment = result.sentiment as string | undefined;
      const watchlist = result.watchlist_count as number | undefined;

      let label = `StockTwits for ${ticker}`;
      if (mentions != null) label += ` — ${mentions} post${mentions !== 1 ? "s" : ""}`;
      if (sentiment) label += `, sentiment: ${sentiment}`;
      if (watchlist != null) label += `. ${(watchlist / 1000).toFixed(0)}K watchlist`;
      return label;
    },
  },

  get_sec_filings: {
    icon: FileText,
    sources: ["sec.gov"],
    loadingLabel: (ticker) =>
      `Looking up SEC filings for ${ticker} on EDGAR`,
    completeLabel: (ticker, result) => {
      const filings = (result.filings ?? result) as { type?: string; date?: string }[];
      const filingsArr = Array.isArray(filings) ? filings : [];
      if (filingsArr.length === 0) return `No recent SEC filings found for ${ticker}`;
      const latest = filingsArr[0];
      let label = `SEC filings for ${ticker} — ${filingsArr.length} filing${filingsArr.length !== 1 ? "s" : ""}`;
      if (latest?.type) label += `. Most recent: ${latest.type}`;
      if (latest?.date) label += ` on ${latest.date}`;
      return label;
    },
  },

  get_analyst_targets: {
    icon: Target,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Fetching Wall Street analyst consensus for ${ticker} via FMP`,
    completeLabel: (ticker, result) => {
      const hasTargets =
        result.consensus_target != null ||
        result.high != null ||
        result.low != null;
      if (!hasTargets) return `No analyst coverage found for ${ticker}`;
      const n = result.num_analysts ?? 0;
      const consensus = (result.consensus_target as number)?.toFixed(2) ?? "N/A";
      const low = (result.low as number)?.toFixed(0) ?? "?";
      const high = (result.high as number)?.toFixed(0) ?? "?";
      return `Analyst targets for ${ticker} — ${n} analysts, consensus $${consensus}, range $${low}–$${high}`;
    },
  },

  get_company_peers: {
    icon: Users,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) =>
      `Finding peer companies for ${ticker} via Finnhub`,
    completeLabel: (ticker, result) => {
      const peers = (result.peers ?? []) as { ticker: string }[];
      if (peers.length === 0) return `No peer companies found for ${ticker}`;
      const names = peers.slice(0, 5).map(p => p.ticker).join(", ");
      const extra = peers.length > 5 ? ` +${peers.length - 5} more` : "";
      return `Peers for ${ticker} — ${peers.length} companies: ${names}${extra}`;
    },
  },

  get_news_deep_dive: {
    icon: Newspaper,
    sources: ["finnhub.io", "financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Deep diving into news and press releases for ${ticker}`,
    completeLabel: (ticker, result) => {
      const stockNews = (result.stock_news ?? []) as unknown[];
      const pressReleases = (result.press_releases ?? []) as unknown[];
      const total = stockNews.length + pressReleases.length;
      if (total === 0) return `No recent news found for ${ticker}`;
      return `Found ${stockNews.length} article${stockNews.length !== 1 ? "s" : ""} and ${pressReleases.length} press release${pressReleases.length !== 1 ? "s" : ""} for ${ticker}`;
    },
  },
};

/** Extract ticker from tool args — tools use either `ticker` or `symbol` */
function extractTicker(args: Record<string, unknown>): string {
  return (args.ticker as string) ?? (args.symbol as string) ?? "";
}

/** Favicon URL from a domain string */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

// ── ToolGroup Component ─────────────────────────────────────────────────────

interface ToolGroupProps {
  startIndex: number;
  endIndex: number;
  children?: ReactNode;
}

export function ResearchToolGroup({
  startIndex,
  endIndex,
  children,
}: ToolGroupProps) {
  const content = useMessage((m) => m.content);

  // Identify which parts in this range are research-step tools
  const stepParts = useMemo(() => {
    const steps: Array<{
      toolName: string;
      config: ResearchStepConfig;
      args: Record<string, unknown>;
      result: Record<string, unknown> | undefined;
    }> = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const part = (content as unknown[])[i] as Record<string, unknown>;
      // assistant-ui normalizes to "tool-call" but check both formats
      if (part?.type !== "tool-call") continue;
      const toolName = part.toolName as string;
      const config = RESEARCH_STEPS[toolName];
      if (!config) continue;
      // AI SDK v6 uses args/result; persisted replay may use input/output
      const args = (part.args as Record<string, unknown>)
        ?? (part.input as Record<string, unknown>)
        ?? {};
      const result = (part.result as Record<string, unknown> | undefined)
        ?? (part.output as Record<string, unknown> | undefined);
      steps.push({ toolName, config, args, result });
    }

    return steps;
  }, [content, startIndex, endIndex]);

  // No research steps in this group — just render children (card tools) normally
  if (stepParts.length === 0) {
    return <>{children}</>;
  }

  // Build the CoT header — use shared ticker if all steps target the same one
  const tickers = [
    ...new Set(stepParts.map((s) => extractTicker(s.args)).filter(Boolean)),
  ];

  // Determine header based on tools in the group
  const hasMarketTools = stepParts.some(
    (s) => s.toolName === "get_market_overview" || s.toolName === "scan_candidates",
  );
  const headerLabel =
    tickers.length === 1
      ? `Researching ${tickers[0]}`
      : tickers.length > 1
        ? `Researching ${tickers.join(", ")}`
        : hasMarketTools
          ? "Market scan"
          : "Research";

  // Open while any step is still loading
  const anyLoading = stepParts.some((s) => s.result === undefined);

  // Collect all unique source domains across steps
  const allSources = [
    ...new Set(stepParts.flatMap((s) => s.config.sources ?? [])),
  ];

  return (
    <>
      <ChainOfThought defaultOpen={anyLoading}>
        <ChainOfThoughtHeader>{headerLabel}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {stepParts.map((step) => {
            const ticker = extractTicker(step.args);
            const label = step.result
              ? step.config.completeLabel(ticker, step.result)
              : step.config.loadingLabel(ticker);
            const status = step.result ? "complete" : "active";

            return (
              <ChainOfThoughtStep
                key={step.toolName}
                icon={step.config.icon}
                label={label}
                status={status}
              />
            );
          })}
          {!anyLoading && allSources.length > 0 && (
            <ChainOfThoughtSearchResults>
              {allSources.map((domain) => (
                <ChainOfThoughtSearchResult key={domain}>
                  <img
                    src={faviconUrl(domain)}
                    alt=""
                    width={12}
                    height={12}
                    className="size-3 rounded-sm"
                  />
                  {domain}
                </ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          )}
        </ChainOfThoughtContent>
      </ChainOfThought>
      {children}
    </>
  );
}
