"use client";

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressTickerItem,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";

interface TickerFinding {
  ticker: string;
  tag?: string;
  summary: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_earnings_data: "Earnings",
  get_options_flow: "Options flow",
  get_sec_filings: "SEC filings",
};

interface Props {
  toolName: string;
  args?: Record<string, unknown>;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function TickerRenderer({ toolName, args, result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  // New runs: data.tickers populated by the tool. Old runs: synthesize from args.ticker.
  const tickers: TickerFinding[] = (data?.tickers as TickerFinding[] | undefined)
    ?? (args?.ticker ? [{ ticker: args.ticker as string, summary: result.summary }] : []);
  const label = TOOL_LABELS[toolName] ?? toolName;

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{label}</ToolProgressHeader>
      <ToolProgressContent>
        {tickers.length > 0
          ? tickers.map((t, i) => (
              <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                {t.summary}
              </ToolProgressTickerItem>
            ))
          : <ToolProgressItem>{result.summary}</ToolProgressItem>
        }
      </ToolProgressContent>
    </ToolProgress>
  );
}
