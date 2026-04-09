"use client";

/**
 * StockCardRenderer — renders the full domain StockCard for get_stock_data results.
 * In Step 2 this is a thin wrapper; full card wiring happens when the tool migrates.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressTickerItem,
} from "@/components/ai-elements/tool-progress";

interface TickerFinding {
  ticker: string;
  tag?: string;
  summary: string;
}

interface Props {
  toolName: string;
  args?: Record<string, unknown>;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function StockCardRenderer({ args, result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  // New runs: data.tickers populated by the tool. Old runs: synthesize from args.ticker.
  const tickers: TickerFinding[] = (data?.tickers as TickerFinding[] | undefined)
    ?? (args?.ticker ? [{ ticker: args.ticker as string, summary: result.summary }] : []);
  const ticker = (args?.ticker as string) ?? (tickers[0]?.ticker ?? "");

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>
        {ticker ? `Researching ${ticker}` : "Stock data"}
      </ToolProgressHeader>
      <ToolProgressContent>
        {tickers.length > 0
          ? tickers.map((t, i) => (
              <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                {t.summary}
              </ToolProgressTickerItem>
            ))
          : <ToolProgressTickerItem ticker={ticker}>{result.summary}</ToolProgressTickerItem>
        }
      </ToolProgressContent>
    </ToolProgress>
  );
}
