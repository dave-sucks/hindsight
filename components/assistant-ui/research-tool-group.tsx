"use client";

/**
 * ResearchToolGroup — groups consecutive research tool calls into a single
 * collapsible block ("Researching $AAPL").
 *
 * Ticker-specific steps render as ToolProgressTickerItem (logo + $TICKER + summary).
 * Non-ticker steps render as plain ToolProgressItem (dot + text).
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { Search } from "lucide-react";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
  ToolProgressTickerItem,
  ToolProgressSources,
} from "@/components/ai-elements/tool-progress";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

// ── Step Config ─────────────────────────────────────────────────────────────

interface ResearchStepConfig {
  /** Whether this step is about a specific ticker (renders as ToolProgressTickerItem) */
  tickerStep?: boolean;
  loadingLabel: (ticker: string, args?: Record<string, unknown>) => string;
  /** For non-ticker steps: full label text */
  completeLabel: (ticker: string, result: Record<string, unknown>) => string;
  /** For ticker steps: summary text after "$TICKER — " */
  tickerSummary?: (result: Record<string, unknown>) => string;
  sources?: string[];
}

export const RESEARCH_STEPS: Record<string, ResearchStepConfig> = {
  get_market_context: {
    sources: ["finnhub.io"],
    loadingLabel: () => "Checking market conditions...",
    completeLabel: (_ticker, result) => {
      const spy = result.spy as { price?: number; change_pct?: number } | null;
      const rawVix = result.vix as { level?: number } | null;
      const vix = rawVix && rawVix.level && rawVix.level > 0.1 ? rawVix : null;
      let label = "Market check";
      if (spy?.price != null) label += ` — SPY ${fmtPrice(spy.price)} (${fmtPct(spy.change_pct)})`;
      if (vix?.level) label += `, VIX ${vix.level.toFixed(1)}`;
      return label;
    },
  },

  get_stock_data: {
    tickerStep: true,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) => `Pulling ${ticker} data...`,
    completeLabel: (ticker, result) => {
      const company = result.company as { name?: string } | null;
      const quote = result.quote as { price?: number; change_pct?: number } | null;
      let label = `Got ${ticker}`;
      if (company?.name) label += ` — ${company.name}`;
      if (quote?.price != null) label += `, ${fmtPrice(quote.price)} (${fmtPct(quote.change_pct)})`;
      return label;
    },
    tickerSummary: (result) => {
      const company = result.company as { name?: string; sector?: string; market_cap?: number } | null;
      const quote = result.quote as { price?: number; change_pct?: number } | null;
      const financials = result.financials as { pe_ratio?: number } | null;
      const analyst = result.analyst_consensus as { buy?: number; hold?: number; sell?: number; strong_buy?: number; strong_sell?: number } | null;

      const parts: string[] = [];
      if (company?.name) parts.push(company.name);
      if (quote?.price != null) parts.push(`${fmtPrice(quote.price)} (${fmtPct(quote.change_pct)})`);

      const metaParts: string[] = [];
      if (company?.sector) metaParts.push(company.sector);
      if (company?.market_cap) metaParts.push(fmtCompact(company.market_cap * 1e6));
      if (financials?.pe_ratio != null) metaParts.push(`P/E ${financials.pe_ratio.toFixed(1)}`);

      if (analyst) {
        const total = (analyst.strong_buy ?? 0) + (analyst.buy ?? 0) + (analyst.hold ?? 0) + (analyst.sell ?? 0) + (analyst.strong_sell ?? 0);
        if (total > 0) {
          const buyPct = Math.round(((analyst.strong_buy ?? 0) + (analyst.buy ?? 0)) / total * 100);
          metaParts.push(`${buyPct}% Buy`);
        }
      }

      if (metaParts.length > 0) parts.push(metaParts.join(" · "));
      return parts.join(". ");
    },
  },

  get_earnings_data: {
    tickerStep: true,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) => `Checking earnings for ${ticker}...`,
    completeLabel: (ticker, result) => {
      const nextEarnings = result.next_earnings as { date?: string } | null;
      const beatRate = result.beat_rate as string | undefined;
      let label = `Earnings for ${ticker}`;
      if (nextEarnings?.date) label += ` — next report ${nextEarnings.date}`;
      if (beatRate && beatRate !== "no history") label += `. Beat rate: ${beatRate}`;
      return label;
    },
    tickerSummary: (result) => {
      const nextEarnings = result.next_earnings as { date?: string } | null;
      const beatRate = result.beat_rate as string | undefined;
      const parts: string[] = [];
      if (nextEarnings?.date) parts.push(`next report ${nextEarnings.date}`);
      if (beatRate && beatRate !== "no history") parts.push(`beat rate: ${beatRate}`);
      return parts.length > 0 ? `Earnings — ${parts.join(", ")}` : "No earnings data";
    },
  },

  get_options_flow: {
    tickerStep: true,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) => `Scanning options for ${ticker}...`,
    completeLabel: (ticker, result) => {
      if (result.available === false) return `No options data for ${ticker}`;
      const signal = (result.signal as string) ?? "neutral";
      const pcr = result.put_call_ratio;
      return `Options for ${ticker} — P/C ratio ${pcr ?? "N/A"}, signal: ${signal}`;
    },
    tickerSummary: (result) => {
      if (result.available === false) return "No options data available";
      const signal = (result.signal as string) ?? "neutral";
      const pcr = result.put_call_ratio;
      return `Options — P/C ratio ${pcr ?? "N/A"}, signal: ${signal}`;
    },
  },

  get_sec_filings: {
    tickerStep: true,
    sources: ["sec.gov"],
    loadingLabel: (ticker) => `Checking SEC filings for ${ticker}...`,
    completeLabel: (ticker, result) => {
      const filings = (result.filings ?? result) as unknown[];
      const count = Array.isArray(filings) ? filings.length : 0;
      if (count === 0) return `No recent SEC filings for ${ticker}`;
      return `${count} SEC filing${count !== 1 ? "s" : ""} for ${ticker}`;
    },
    tickerSummary: (result) => {
      const filings = (result.filings ?? result) as unknown[];
      const count = Array.isArray(filings) ? filings.length : 0;
      if (count === 0) return "No recent SEC filings";
      return `${count} SEC filing${count !== 1 ? "s" : ""}`;
    },
  },

  get_portfolio_state: {
    sources: ["alpaca.markets"],
    loadingLabel: () => "Loading portfolio...",
    completeLabel: (_ticker, result) => {
      const theses = (result.run_theses as unknown[] | undefined)?.length ?? 0;
      const positions = (result.open_positions as unknown[] | undefined)?.length ?? 0;
      return `Portfolio — ${theses} theses, ${positions} positions`;
    },
  },

  close_position: {
    sources: ["alpaca.markets"],
    loadingLabel: (ticker) => `Closing ${ticker}...`,
    completeLabel: (ticker, result) => {
      const pnl = result.realized_pnl as number | undefined;
      const outcome = result.outcome as string | undefined;
      if (pnl != null) return `Closed ${ticker} — ${outcome} ($${pnl.toFixed(2)})`;
      return `Closed ${ticker}`;
    },
  },

  web_search: {
    sources: ["perplexity.ai"],
    loadingLabel: (_ticker, args) => {
      const query = (args as Record<string, unknown>)?.query as string | undefined;
      return query ? `Searching: "${query.slice(0, 60)}"` : "Searching the web...";
    },
    completeLabel: (_ticker, result) => {
      const count = result.resultCount as number | undefined;
      const query = result.query as string | undefined;
      if (count != null && query) return `Found ${count} result${count !== 1 ? "s" : ""} for "${query.slice(0, 50)}"`;
      if (result.error) return `Search failed: ${String(result.error).slice(0, 60)}`;
      return "Web search complete";
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractTicker(args: Record<string, unknown>): string {
  return (args.ticker as string) ?? (args.symbol as string) ?? "";
}

function extractSearchItems(result: Record<string, unknown>): Array<{ headline: string; domain: string }> {
  const results = result.results as Array<{ headline: string; sourceUrls?: string[] }> | undefined;
  if (!results) return [];
  return results.slice(0, 3).map((r) => {
    let domain = "";
    try { domain = r.sourceUrls?.[0] ? new URL(r.sourceUrls[0]).hostname.replace(/^www\./, "") : ""; } catch { /* */ }
    return { headline: r.headline, domain };
  });
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

  const stepParts = useMemo(() => {
    const steps: Array<{
      toolName: string;
      config: ResearchStepConfig;
      args: Record<string, unknown>;
      result: Record<string, unknown> | undefined;
      key: string;
    }> = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const part = (content as unknown[])[i] as Record<string, unknown>;
      if (part?.type !== "tool-call") continue;
      const toolName = part.toolName as string;
      const config = RESEARCH_STEPS[toolName];
      if (!config) continue;
      const args = (part.args as Record<string, unknown>)
        ?? (part.input as Record<string, unknown>)
        ?? {};
      const result = (part.result as Record<string, unknown> | undefined)
        ?? (part.output as Record<string, unknown> | undefined);
      const ticker = extractTicker(args);
      steps.push({ toolName, config, args, result, key: `${toolName}-${ticker}-${i}` });
    }

    return steps;
  }, [content, startIndex, endIndex]);

  if (stepParts.length === 0) {
    return <>{children}</>;
  }

  const tickers = [...new Set(stepParts.map((s) => extractTicker(s.args)).filter(Boolean))];
  const hasMarketTools = stepParts.some((s) => s.toolName === "get_market_context");
  const hasWebSearch = stepParts.some((s) => s.toolName === "web_search");
  const headerLabel = tickers.length === 1
    ? `Researching ${tickers[0]}`
    : tickers.length > 1
      ? `Researching ${tickers.join(", ")}`
      : hasMarketTools
        ? "Market scan"
        : hasWebSearch
          ? "Web search"
          : "Research";

  const anyLoading = stepParts.some((s) => s.result === undefined);
  const allSources = [...new Set(stepParts.flatMap((s) => s.config.sources ?? []))];

  return (
    <>
      <ToolProgress defaultOpen={anyLoading}>
        <ToolProgressHeader loading={anyLoading} icon={hasWebSearch ? Search : undefined}>
          {headerLabel}
        </ToolProgressHeader>
        <ToolProgressContent>
          {stepParts.map((step) => {
            const ticker = extractTicker(step.args);
            const isComplete = step.result !== undefined;

            // Loading state: always plain item
            if (!isComplete) {
              return (
                <ToolProgressItem key={step.key} active>
                  {step.config.loadingLabel(ticker, step.args)}
                </ToolProgressItem>
              );
            }

            // Ticker-specific steps: render with logo + $TICKER + summary
            if (step.config.tickerStep && ticker && step.config.tickerSummary) {
              return (
                <ToolProgressTickerItem key={step.key} ticker={ticker}>
                  {step.config.tickerSummary(step.result!)}
                </ToolProgressTickerItem>
              );
            }

            // Non-ticker steps (market context, portfolio, web search): plain item
            return (
              <div key={step.key}>
                <ToolProgressItem>{step.config.completeLabel(ticker, step.result!)}</ToolProgressItem>
                {step.toolName === "web_search" && (() => {
                  const items = extractSearchItems(step.result!);
                  return items.length > 0 ? (
                    <div className="pl-5 space-y-0.5 mt-0.5">
                      {items.map((item, i) => (
                        <ToolProgressItem key={i}>
                          {item.domain ? `${item.domain} — ` : ""}{item.headline}
                        </ToolProgressItem>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })}
          <ToolProgressSources domains={allSources} />
        </ToolProgressContent>
      </ToolProgress>
      {children}
    </>
  );
}
