"use client";

/**
 * TickerListRenderer — ui: "ticker-list"
 *
 * Used by read_morning_brief and read_signals. Renders one ToolProgressTickerItem
 * per entry in data.tickers[], with source chips below. Falls back to summary text
 * if no tickers are present.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressTickerItem,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";
import { extractToolSources, SourceChips } from "@/components/assistant-ui/tool-uis/tool-ui-shared";

interface TickerItem {
  ticker: string;
  tag?: string;
  summary: string;
}

const TOOL_LABELS: Record<string, string> = {
  read_morning_brief: "Morning brief",
  read_signals: "Signals",
  get_portfolio_context: "Portfolio",
};

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function TickerListRenderer({ toolName, result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const tickers = (data?.tickers as TickerItem[] | undefined) ?? [];
  const label = TOOL_LABELS[toolName] ?? result.summary.slice(0, 60);
  const rawResult = { ...data, _sources: result.sources };
  const sources = loading ? [] : extractToolSources(rawResult as Record<string, unknown>);

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
        <SourceChips sources={sources} />
      </ToolProgressContent>
    </ToolProgress>
  );
}
