"use client";

/**
 * ResearchToolGroup — groups consecutive research/intel tool calls into a
 * single collapsible "Researching $X" block.
 *
 * Tools handled here: get_market_context, get_stock_data, get_earnings_data,
 * get_options_flow, get_sec_filings, get_portfolio_state, web_search, plus the
 * intelligence-read tools (read_morning_brief, read_signals, read_artifact)
 * which already have their own renderers but can also fall through to this
 * group when adjacent to other research tools.
 *
 * Pure research only — has nothing to do with portfolio actions. Action tool
 * outcomes (place_trade / close_position / manage_watchlist) are merged into
 * the Decision CoT (DecisionPlanRender in tool-ui-research.tsx) by reading
 * forward in the message stream.
 */

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
import type { ToolStepPart } from "@/components/assistant-ui/agent-tool-group";

// ── Step Config ─────────────────────────────────────────────────────────────

export interface ResearchStepConfig {
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
  web_search: {
    loadingLabel: (_ticker, args) => {
      const query = (args as Record<string, unknown>)?.query as string | undefined;
      return query ? `Searching: "${query.slice(0, 60)}"` : "Searching the web...";
    },
  },
};

function extractTicker(args: Record<string, unknown>): string {
  return (args.ticker as string) ?? (args.symbol as string) ?? "";
}

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  steps: ToolStepPart[];
}

export function ResearchToolGroup({ steps }: Props) {
  const tickers = useMemo(
    () => [...new Set(steps.map((s) => extractTicker(s.args)).filter(Boolean))],
    [steps],
  );

  if (steps.length === 0) return null;

  const hasMarketTools = steps.some((s) => s.toolName === "get_market_context");
  const hasWebSearch = steps.some((s) => s.toolName === "web_search");
  const headerLabel = tickers.length === 1
    ? `Researching ${tickers[0]}`
    : tickers.length > 1
      ? `Researching ${tickers.join(", ")}`
      : hasMarketTools
        ? "Market scan"
        : hasWebSearch
          ? "Web search"
          : "Research";

  const anyLoading = steps.some((s) => s.result === undefined);
  const allSources = steps
    .filter((s) => s.result !== undefined)
    .flatMap((s) => extractToolSources(s.result!));

  return (
    <ToolProgress defaultOpen={anyLoading}>
      <ToolProgressHeader loading={anyLoading} icon={hasWebSearch ? Search : undefined}>
        {headerLabel}
      </ToolProgressHeader>
      <ToolProgressContent>
        {steps.map((step) => renderResearchRow(step))}
        <SourceChips sources={allSources} />
      </ToolProgressContent>
    </ToolProgress>
  );
}

function renderResearchRow(step: ToolStepPart): ReactNode {
  const config = RESEARCH_STEPS[step.toolName];
  if (!config) return null;

  const ticker = extractTicker(step.args);
  const isComplete = step.result !== undefined;

  if (!isComplete) {
    return (
      <ToolProgressItem key={step.key} active>
        {config.loadingLabel(ticker, step.args)}
      </ToolProgressItem>
    );
  }

  const resultTickers = step.result?.tickers as { ticker: string; tag?: string; summary: string }[] | undefined;
  const resultSummary = step.result?.summary as string | undefined;

  if (config.tickerStep && resultTickers?.length) {
    return resultTickers.map((t, j) => (
      <ToolProgressTickerItem key={`${step.key}-${j}`} ticker={t.ticker} tag={t.tag}>
        {t.summary}
      </ToolProgressTickerItem>
    ));
  }

  if (resultSummary) {
    return <ToolProgressItem key={step.key}>{resultSummary}</ToolProgressItem>;
  }

  return <ToolProgressItem key={step.key}>Complete</ToolProgressItem>;
}
