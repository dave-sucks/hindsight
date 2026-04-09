"use client";

/**
 * SourceRenderer — for intelligence-read tools: read_morning_brief,
 * read_signals, read_artifact, web_search.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
  ToolProgressTickerItem,
} from "@/components/ai-elements/tool-progress";
import { extractToolSources, SourceChips } from "@/components/assistant-ui/tool-uis/tool-ui-shared";

interface TickerItem {
  ticker: string;
  tag?: string;
  summary: string;
}

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  read_morning_brief: "Morning brief",
  read_signals: "Signals",
  read_artifact: "Reading article",
  web_search: "Web search",
};

export function SourceRenderer({ toolName, result, loading }: Props) {
  const rawResult = { ...result.data as Record<string, unknown>, _sources: result.sources };
  const allSources = loading ? [] : extractToolSources(rawResult);

  const data = result.data as Record<string, unknown> | null;
  const tickers = (data?.tickers as TickerItem[] | undefined) ?? [];

  const headerLabel = TOOL_LABELS[toolName] ?? result.summary.slice(0, 60);

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>
        {headerLabel}
      </ToolProgressHeader>
      <ToolProgressContent>
        {tickers.length > 0
          ? tickers.map((t, i) => (
              <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                {t.summary}
              </ToolProgressTickerItem>
            ))
          : <ToolProgressItem>{result.summary}</ToolProgressItem>
        }
        <SourceChips sources={allSources} />
      </ToolProgressContent>
    </ToolProgress>
  );
}
