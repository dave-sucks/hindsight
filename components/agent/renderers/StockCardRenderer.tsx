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
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function StockCardRenderer({ result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const tickers = (data?.tickers as TickerFinding[]) ?? [];
  const ticker = (result.data as Record<string, unknown>)?.ticker as string ?? "";

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
