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

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function TickerRenderer({ toolName, result, loading }: Props) {
  // result.data may have a `tickers` array (legacy ResearchToolResult shape)
  // or the data itself may have ticker-level detail
  const data = result.data as Record<string, unknown> | null;
  const tickers = (data?.tickers as TickerFinding[]) ?? [];

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{toolName}</ToolProgressHeader>
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
