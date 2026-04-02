"use client";

/**
 * ResearchToolGroup — groups consecutive research tool calls into a single
 * collapsible block ("Researching $AAPL").
 *
 * Each step renders as a flat dot + one-line summary. No per-step icons,
 * no rich descriptions, no nested expandables. Source domains are collected
 * and shown once at the bottom.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { Search } from "lucide-react";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
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

// ── Step Config (simplified — label functions only) ─────────────────────────

interface ResearchStepConfig {
  loadingLabel: (ticker: string, args?: Record<string, unknown>) => string;
  completeLabel: (ticker: string, result: Record<string, unknown>) => string;
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
    sources: ["finnhub.io"],
    loadingLabel: (ticker) => `Pulling ${ticker} data...`,
    completeLabel: (ticker, result) => {
      const quote = result.quote as { price?: number; change_pct?: number } | null;
      const company = result.company as { name?: string } | null;
      const technicals = result.technicals as { trend?: string; rsi_14?: number } | null;
      let label = `Got ${ticker}`;
      if (company?.name) label += ` — ${company.name}`;
      if (quote?.price != null) label += `, ${fmtPrice(quote.price)} (${fmtPct(quote.change_pct)})`;
      if (technicals?.trend) label += `. Trend: ${technicals.trend}`;
      if (technicals?.rsi_14 != null) label += `, RSI ${technicals.rsi_14.toFixed(1)}`;
      return label;
    },
  },

  get_earnings_data: {
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
  },

  get_options_flow: {
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) => `Scanning options for ${ticker}...`,
    completeLabel: (ticker, result) => {
      if (result.available === false) return `No options data for ${ticker}`;
      const signal = (result.signal as string) ?? "neutral";
      const pcr = result.put_call_ratio;
      return `Options for ${ticker} — P/C ratio ${pcr ?? "N/A"}, signal: ${signal}`;
    },
  },

  get_sec_filings: {
    sources: ["sec.gov"],
    loadingLabel: (ticker) => `Checking SEC filings for ${ticker}...`,
    completeLabel: (ticker, result) => {
      const filings = (result.filings ?? result) as unknown[];
      const count = Array.isArray(filings) ? filings.length : 0;
      if (count === 0) return `No recent SEC filings for ${ticker}`;
      return `${count} SEC filing${count !== 1 ? "s" : ""} for ${ticker}`;
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

/** Extract search result items from web_search result for display */
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

  // Dynamic header
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

  // Collect all unique source domains
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
            const label = isComplete
              ? step.config.completeLabel(ticker, step.result!)
              : step.config.loadingLabel(ticker, step.args);

            return (
              <div key={step.key}>
                <ToolProgressItem active={!isComplete}>{label}</ToolProgressItem>
                {/* Web search results: show top 3 as sub-items */}
                {isComplete && step.toolName === "web_search" && (() => {
                  const items = extractSearchItems(step.result!);
                  return items.length > 0 ? (
                    <div className="pl-4 space-y-0.5 mt-0.5">
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
