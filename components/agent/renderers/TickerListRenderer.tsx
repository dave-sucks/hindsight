"use client";

/**
 * TickerListRenderer — ui: "ticker-list"
 *
 * Used by read_morning_brief and read_signals. Renders one ToolProgressTickerItem
 * per entry in data.tickers[], with source chips below. Falls back to summary text
 * if no tickers are present.
 *
 * Optional `data.context` (prose string): rendered as a non-ticker ToolProgressItem
 * above the ticker rows. Used by tools like read_morning_brief to surface narrative
 * context (market regime, theme overview) that doesn't belong in a ticker row.
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
  read_morning_brief: "Reading Morning Briefing",
  read_signals: "Reading Signals",
  get_portfolio_context: "Getting Current Portfolio",
};

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
  /** When true, render flat rows only — group supplies the ToolProgress wrapper */
  inGroup?: boolean;
}

export function TickerListRenderer({ toolName, result, loading, inGroup }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const tickers = (data?.tickers as TickerItem[] | undefined) ?? [];
  const context = typeof data?.context === "string" ? data.context : null;
  const label = result.progressLabel ?? TOOL_LABELS[toolName] ?? result.summary.slice(0, 60);
  const rawResult = { ...data, _sources: result.sources };
  const sources = loading ? [] : extractToolSources(rawResult as Record<string, unknown>);

  const body = (
    <>
      {context && <ToolProgressItem>{context}</ToolProgressItem>}
      {tickers.length > 0
        ? tickers.map((t, i) => (
            <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
              {t.summary}
            </ToolProgressTickerItem>
          ))
        : !context && <ToolProgressItem>{result.summary}</ToolProgressItem>
      }
      <SourceChips sources={sources} />
    </>
  );

  if (inGroup) {
    // Flat rows inside a group — no nested ToolProgress wrapper.
    return body;
  }

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{label}</ToolProgressHeader>
      <ToolProgressContent>{body}</ToolProgressContent>
    </ToolProgress>
  );
}
