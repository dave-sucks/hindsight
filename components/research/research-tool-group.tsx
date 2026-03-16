"use client";

/**
 * ResearchToolGroup — wraps consecutive tool calls into a single
 * ChainOfThought block with descriptive, human-readable steps.
 *
 * Used as the ToolGroup component in MessagePrimitive.Parts.
 * Receives { startIndex, endIndex, children } from assistant-ui.
 *
 * - CoT-only tools (technicals, earnings, options, etc.) render as
 *   descriptive steps inside the collapsible block.
 * - Card tools (stock data, news) render their cards below via {children}.
 * - Standalone tools (thesis, trade, summary) pass through via {children}.
 */

import { type PropsWithChildren, useMemo } from "react";
import { useMessage } from "@assistant-ui/react";
import type { ToolCallMessagePart } from "@assistant-ui/core";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from "@/components/ai-elements/chain-of-thought";
import {
  BarChart3,
  Search,
  Newspaper,
  LineChart,
  Calendar,
  Activity,
  MessageSquareText,
  Target,
  Users,
  TrendingUp,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Tool categories ────────────────────────────────────────────────────────

/** Tools that render ONLY as CoT steps (no card) */
const COT_ONLY_TOOLS = new Set([
  "get_market_overview",
  "scan_candidates",
  "get_technical_analysis",
  "get_earnings_data",
  "get_options_flow",
  "get_reddit_sentiment",
  "get_twitter_sentiment",
  "get_sec_filings",
  "get_analyst_targets",
  "get_company_peers",
]);

// ─── Step rendering ─────────────────────────────────────────────────────────

interface StepInfo {
  icon: LucideIcon;
  label: string;
  badges: string[];
  status: "complete" | "active" | "pending";
}

function renderPendingStep(toolName: string, args: Record<string, unknown>): StepInfo {
  const ticker = (args?.ticker as string) ?? "";

  const steps: Record<string, StepInfo> = {
    get_market_overview: {
      icon: TrendingUp,
      label: "Checking today's market conditions via Finnhub — fetching S&P 500, VIX, and sector ETFs",
      badges: ["finnhub.io"],
      status: "active",
    },
    scan_candidates: {
      icon: Search,
      label: "Scanning for trade candidates — checking Finnhub earnings calendar, FMP market movers, and StockTwits trending",
      badges: ["finnhub.io", "financialmodelingprep.com", "stocktwits.com"],
      status: "active",
    },
    get_stock_data: {
      icon: Search,
      label: `Researching ${ticker} — pulling quote, company profile, financials, and news from Finnhub`,
      badges: ["finnhub.io"],
      status: "active",
    },
    get_technical_analysis: {
      icon: LineChart,
      label: `Pulling price history from FMP for ${ticker} to calculate RSI, moving averages, and volume trends`,
      badges: ["financialmodelingprep.com"],
      status: "active",
    },
    get_earnings_data: {
      icon: Calendar,
      label: `Checking Finnhub earnings calendar and EPS history for ${ticker}`,
      badges: ["finnhub.io"],
      status: "active",
    },
    get_options_flow: {
      icon: Activity,
      label: `Scanning FMP options chain for ${ticker} to check for unusual activity`,
      badges: ["financialmodelingprep.com"],
      status: "active",
    },
    get_reddit_sentiment: {
      icon: MessageSquareText,
      label: `Searching Reddit for ${ticker} mentions across r/wallstreetbets, r/stocks, r/options`,
      badges: ["reddit.com"],
      status: "active",
    },
    get_twitter_sentiment: {
      icon: MessageSquareText,
      label: `Checking StockTwits feed and FMP social sentiment for ${ticker}`,
      badges: ["stocktwits.com", "financialmodelingprep.com"],
      status: "active",
    },
    get_sec_filings: {
      icon: FileText,
      label: `Looking up ${ticker} on SEC EDGAR for recent regulatory filings`,
      badges: ["sec.gov"],
      status: "active",
    },
    get_analyst_targets: {
      icon: Target,
      label: `Fetching Wall Street analyst price targets from FMP for ${ticker}`,
      badges: ["financialmodelingprep.com"],
      status: "active",
    },
    get_company_peers: {
      icon: Users,
      label: `Getting peer companies from Finnhub for ${ticker} to compare valuations`,
      badges: ["finnhub.io"],
      status: "active",
    },
    get_news_deep_dive: {
      icon: Newspaper,
      label: `Deep diving into news for ${ticker} — checking FMP stock news and press releases`,
      badges: ["financialmodelingprep.com"],
      status: "active",
    },
  };

  return steps[toolName] ?? {
    icon: Search,
    label: `Running ${toolName}${ticker ? ` for ${ticker}` : ""}`,
    badges: [],
    status: "active",
  };
}

function renderCompleteStep(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): StepInfo {
  const ticker = (args?.ticker as string) ?? "";

  switch (toolName) {
    case "get_market_overview": {
      const spy = result.spy as { price?: number; change_pct?: number } | null;
      const rawVix = result.vix as { level?: number } | null;
      const vix = rawVix && rawVix.level && rawVix.level > 0.1 ? rawVix : null;
      const sectors = (result.sectors ?? []) as { symbol: string; change_pct: number }[];
      const top = sectors.filter(s => s.change_pct > 0).slice(0, 2).map(s => s.symbol).join(", ");
      const bottom = sectors.filter(s => s.change_pct < 0).slice(-2).reverse().map(s => s.symbol).join(", ");

      const spyStr = spy?.price ? `SPY $${spy.price.toFixed(2)} (${spy.change_pct != null ? (spy.change_pct >= 0 ? "+" : "") + spy.change_pct.toFixed(1) + "%" : "—"})` : "SPY data unavailable";
      const vixStr = vix?.level ? `VIX ${vix.level.toFixed(1)}` : "";
      const regime = vix && vix.level! > 25 ? "high volatility" : vix && vix.level! < 16 ? "low volatility" : "moderate volatility";

      return {
        icon: TrendingUp,
        label: `Market check — ${spyStr}${vixStr ? `, ${vixStr} (${regime})` : ""}. ${top ? `Leading: ${top}.` : ""} ${bottom ? `Lagging: ${bottom}.` : ""}`.trim(),
        badges: ["finnhub.io"],
        status: "complete",
      };
    }

    case "scan_candidates": {
      const earnings = (result.earnings ?? []) as unknown[];
      const movers = (result.movers ?? []) as unknown[];
      const total = (result.total_found as number) ?? earnings.length + movers.length;
      return {
        icon: Search,
        label: `Found ${total} candidates — ${earnings.length} from earnings calendar, ${movers.length} from market movers and social trending`,
        badges: ["finnhub.io", "financialmodelingprep.com", "stocktwits.com"],
        status: "complete",
      };
    }

    case "get_stock_data": {
      const quote = result.quote as { price?: number; change_pct?: number } | null;
      const company = result.company as { name?: string; sector?: string } | null;
      const news = (result.news ?? []) as unknown[];
      const priceStr = quote?.price ? `$${quote.price.toFixed(2)} (${quote.change_pct != null ? (quote.change_pct >= 0 ? "+" : "") + quote.change_pct.toFixed(2) + "%" : ""})` : "";
      return {
        icon: Search,
        label: `Got ${ticker}${company?.name ? ` — ${company.name}` : ""}${priceStr ? `. ${priceStr}` : ""}${company?.sector ? `. ${company.sector}` : ""}. ${news.length} news articles.`,
        badges: ["finnhub.io"],
        status: "complete",
      };
    }

    case "get_technical_analysis": {
      if (result.error) {
        return {
          icon: LineChart,
          label: `Technicals for ${ticker} — could not get price data. ${String(result.error)}`,
          badges: ["financialmodelingprep.com"],
          status: "complete",
        };
      }
      const rsi = result.rsi_14 as number | null;
      const rsiLevel = rsi != null ? (rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : "neutral") : "";
      const trend = result.trend as string | null;
      const sma20 = result.sma_20 as number | null;
      const sma50 = result.sma_50 as number | null;
      const vs20 = result.price_vs_sma20 as string | null;
      const vs50 = result.price_vs_sma50 as string | null;
      return {
        icon: LineChart,
        label: `Technicals for ${ticker} — ${rsi != null ? `RSI ${rsi.toFixed(1)} (${rsiLevel})` : "RSI unavailable"}. ${vs20 ? `${vs20} SMA-20${sma20 ? ` ($${sma20.toFixed(2)})` : ""}` : ""}${vs50 ? `, ${vs50} SMA-50${sma50 ? ` ($${sma50.toFixed(2)})` : ""}` : ""}. ${trend ? `Trend: ${trend}.` : ""}`.trim(),
        badges: ["financialmodelingprep.com"],
        status: "complete",
      };
    }

    case "get_earnings_data": {
      const next = result.next_earnings as { date?: string; eps_estimate?: number | null } | null;
      const quarters = (result.recent_quarters ?? []) as unknown[];
      const beatRate = result.beat_rate as string | null;
      return {
        icon: Calendar,
        label: `Earnings for ${ticker} — ${next?.date ? `next report ${next.date}` : "no upcoming earnings"}. ${beatRate ? `Beat rate: ${beatRate}.` : ""} ${next?.eps_estimate != null ? `EPS estimate: $${next.eps_estimate.toFixed(2)}.` : ""} ${quarters.length} quarters analyzed.`.trim(),
        badges: ["finnhub.io"],
        status: "complete",
      };
    }

    case "get_options_flow": {
      if (result.available === false) {
        return {
          icon: Activity,
          label: `Options for ${ticker} — no options data available${result.note ? `. ${String(result.note)}` : ""}`,
          badges: ["financialmodelingprep.com"],
          status: "complete",
        };
      }
      const pcr = result.put_call_ratio as number | null;
      const signal = result.signal as string | null;
      const contracts = result.contracts_available as number | null;
      return {
        icon: Activity,
        label: `Options for ${ticker} — ${pcr != null ? `P/C ratio ${pcr.toFixed(2)}` : "P/C ratio unavailable"} (${signal ?? "neutral"} signal). ${contracts ?? 0} contracts analyzed.`,
        badges: ["financialmodelingprep.com"],
        status: "complete",
      };
    }

    case "get_reddit_sentiment": {
      if (!result.available) {
        const reason = result.reason as string | undefined;
        return {
          icon: MessageSquareText,
          label: reason === "blocked"
            ? `Reddit for ${ticker} — API rate-limited, couldn't check sentiment`
            : `Reddit for ${ticker} — no recent mentions found`,
          badges: ["reddit.com"],
          status: "complete",
        };
      }
      const mentions = result.mention_count as number | null;
      const sentiment = result.sentiment as string | null;
      const trending = result.trending as boolean | null;
      return {
        icon: MessageSquareText,
        label: `Reddit for ${ticker} — ${mentions ?? 0} mentions, sentiment: ${sentiment ?? "unknown"}${trending ? " (trending)" : ""}`,
        badges: ["reddit.com"],
        status: "complete",
      };
    }

    case "get_twitter_sentiment": {
      if (!result.available) {
        return {
          icon: MessageSquareText,
          label: `StockTwits for ${ticker} — no data available`,
          badges: ["stocktwits.com"],
          status: "complete",
        };
      }
      const mentions = result.mention_count as number | null;
      const sentiment = result.sentiment as string | null;
      const watchlist = result.watchlist_count as number | null;
      return {
        icon: MessageSquareText,
        label: `StockTwits for ${ticker} — ${mentions ?? 0} posts, sentiment: ${sentiment ?? "unknown"}${watchlist ? `. ${(watchlist / 1000).toFixed(0)}K watchlist` : ""}`,
        badges: ["stocktwits.com", "financialmodelingprep.com"],
        status: "complete",
      };
    }

    case "get_sec_filings": {
      const filings = (result.filings ?? result) as { type?: string; date?: string }[];
      const filingsArr = Array.isArray(filings) ? filings : [];
      const top = filingsArr.slice(0, 3).map(f => `${f.type ?? "?"} (${f.date ?? "?"})`).join(", ");
      return {
        icon: FileText,
        label: `SEC filings for ${ticker} — ${filingsArr.length} found${top ? `. Recent: ${top}` : ""}`,
        badges: ["sec.gov"],
        status: "complete",
      };
    }

    case "get_analyst_targets": {
      const numAnalysts = result.num_analysts as number | null;
      const consensus = result.consensus_target as number | null;
      const currentPrice = result.current_price as number | null;
      const high = result.high as number | null;
      const low = result.low as number | null;
      let upside = "";
      if (consensus != null && currentPrice != null && currentPrice > 0) {
        const pct = ((consensus - currentPrice) / currentPrice * 100).toFixed(1);
        upside = ` (${Number(pct) >= 0 ? "+" : ""}${pct}% from current)`;
      }
      return {
        icon: Target,
        label: `Analyst targets for ${ticker} — ${numAnalysts ?? 0} analysts. Consensus: ${consensus != null ? `$${consensus.toFixed(2)}` : "—"}${upside}${high != null && low != null ? `. Range: $${low.toFixed(2)} — $${high.toFixed(2)}` : ""}`,
        badges: ["financialmodelingprep.com"],
        status: "complete",
      };
    }

    case "get_company_peers": {
      const peers = (result.peers ?? []) as { ticker?: string }[];
      const tickers = peers.slice(0, 6).map(p => p.ticker).filter(Boolean).join(", ");
      const sector = result.sector as string | null;
      return {
        icon: Users,
        label: `Peers for ${ticker}${sector ? ` (${sector})` : ""} — ${peers.length} companies${tickers ? `: ${tickers}` : ""}${peers.length > 6 ? "..." : ""}`,
        badges: ["finnhub.io"],
        status: "complete",
      };
    }

    case "get_news_deep_dive": {
      const stockNews = (result.stock_news ?? []) as unknown[];
      const press = (result.press_releases ?? []) as unknown[];
      return {
        icon: Newspaper,
        label: `News for ${ticker} — ${stockNews.length} articles and ${press.length} press releases found`,
        badges: ["financialmodelingprep.com"],
        status: "complete",
      };
    }

    default:
      return {
        icon: Search,
        label: `Completed ${toolName}${ticker ? ` for ${ticker}` : ""}`,
        badges: [],
        status: "complete",
      };
  }
}

// ─── Header logic ───────────────────────────────────────────────────────────

function getGroupHeader(parts: ToolCallMessagePart[]): string {
  // Find common ticker across all parts
  const tickers = new Set<string>();
  for (const part of parts) {
    const ticker = (part.args as Record<string, unknown>)?.ticker as string | undefined;
    if (ticker) tickers.add(ticker);
  }

  // Check if this group is just market/scan (no ticker-specific tools)
  const toolNames = parts.map(p => p.toolName);
  const isMarketScan = toolNames.every(n => n === "get_market_overview" || n === "scan_candidates");

  if (isMarketScan) return "Market scan";
  if (tickers.size === 1) return `Researching ${[...tickers][0]}`;
  if (tickers.size > 1) return `Researching ${[...tickers].join(", ")}`;
  return "Research";
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ResearchToolGroup({
  startIndex,
  endIndex,
  children,
}: PropsWithChildren<{ startIndex: number; endIndex: number }>) {
  const content = useMessage((m) => m.content);

  const { steps, anyPending, header } = useMemo(() => {
    const toolParts: ToolCallMessagePart[] = [];
    const stepInfos: StepInfo[] = [];
    let hasPending = false;

    for (let i = startIndex; i <= endIndex; i++) {
      const part = content[i];
      if (!part || part.type !== "tool-call") continue;

      const toolPart = part as ToolCallMessagePart;
      toolParts.push(toolPart);

      // Only render steps for CoT-only tools and card tools (not standalone)
      const args = (toolPart.args ?? {}) as Record<string, unknown>;
      const result = toolPart.result as Record<string, unknown> | undefined;

      if (result === undefined) {
        hasPending = true;
        stepInfos.push(renderPendingStep(toolPart.toolName, args));
      } else {
        stepInfos.push(renderCompleteStep(toolPart.toolName, args, result));
      }
    }

    return {
      steps: stepInfos,
      anyPending: hasPending,
      header: getGroupHeader(toolParts),
    };
  }, [content, startIndex, endIndex]);

  // If no steps (shouldn't happen), just render children
  if (steps.length === 0) return <>{children}</>;

  return (
    <div className="my-2 space-y-1.5">
      <ChainOfThought defaultOpen={anyPending}>
        <ChainOfThoughtHeader>{header}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {steps.map((step, i) => (
            <ChainOfThoughtStep
              key={i}
              icon={step.icon}
              label={step.label}
              status={step.status}
            >
              {step.badges.length > 0 && (
                <ChainOfThoughtSearchResults>
                  {step.badges.map((badge) => (
                    <ChainOfThoughtSearchResult key={badge}>
                      {badge}
                    </ChainOfThoughtSearchResult>
                  ))}
                </ChainOfThoughtSearchResults>
              )}
            </ChainOfThoughtStep>
          ))}
        </ChainOfThoughtContent>
      </ChainOfThought>
      {/* Card/standalone tool renders from useAssistantToolUI */}
      {children}
    </div>
  );
}
