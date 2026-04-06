"use client";

/**
 * ResearchToolGroup — groups consecutive research tool calls into a single
 * collapsible block ("Researching $AAPL").
 *
 * Uses the unified envelope (summary, tickers, _sources) from each tool result
 * for rendering. No per-tool field extraction logic.
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
} from "@/components/ai-elements/tool-progress";
import { extractToolSources, SourceChips } from "@/components/assistant-ui/tool-uis/tool-ui-shared";

// ── Step Config ─────────────────────────────────────────────────────────────

interface ResearchStepConfig {
  tickerStep?: boolean;
  loadingLabel: (ticker: string, args?: Record<string, unknown>) => string;
}

export const RESEARCH_STEPS: Record<string, ResearchStepConfig> = {
  get_market_context: {
    loadingLabel: () => "Checking market conditions...",
  },
  get_stock_data: {
    tickerStep: true,
    loadingLabel: (ticker) => `Pulling ${ticker} data...`,
  },
  get_earnings_data: {
    tickerStep: true,
    loadingLabel: (ticker) => `Checking earnings for ${ticker}...`,
  },
  get_options_flow: {
    tickerStep: true,
    loadingLabel: (ticker) => `Scanning options for ${ticker}...`,
  },
  get_sec_filings: {
    tickerStep: true,
    loadingLabel: (ticker) => `Checking SEC filings for ${ticker}...`,
  },
  get_portfolio_state: {
    loadingLabel: () => "Loading portfolio...",
  },
  close_position: {
    loadingLabel: (ticker) => `Closing ${ticker}...`,
  },
  web_search: {
    loadingLabel: (_ticker, args) => {
      const query = (args as Record<string, unknown>)?.query as string | undefined;
      return query ? `Searching: "${query.slice(0, 60)}"` : "Searching the web...";
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractTicker(args: Record<string, unknown>): string {
  return (args.ticker as string) ?? (args.symbol as string) ?? "";
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
  const allSources = stepParts
    .filter((s) => s.result !== undefined)
    .flatMap((s) => extractToolSources(s.result!));

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

            if (!isComplete) {
              return (
                <ToolProgressItem key={step.key} active>
                  {step.config.loadingLabel(ticker, step.args)}
                </ToolProgressItem>
              );
            }

            // Use unified envelope: tickers[] for ticker steps, summary for everything else
            const resultTickers = step.result?.tickers as { ticker: string; tag?: string; summary: string }[] | undefined;
            const resultSummary = step.result?.summary as string | undefined;

            if (step.config.tickerStep && resultTickers?.length) {
              return resultTickers.map((t, j) => (
                <ToolProgressTickerItem key={`${step.key}-${j}`} ticker={t.ticker} tag={t.tag}>
                  {t.summary}
                </ToolProgressTickerItem>
              ));
            }

            // Non-ticker steps: show summary
            if (resultSummary) {
              return <ToolProgressItem key={step.key}>{resultSummary}</ToolProgressItem>;
            }

            // Fallback for old persisted runs without envelope
            return <ToolProgressItem key={step.key}>Complete</ToolProgressItem>;
          })}
          <SourceChips sources={allSources} />
        </ToolProgressContent>
      </ToolProgress>
      {children}
    </>
  );
}
