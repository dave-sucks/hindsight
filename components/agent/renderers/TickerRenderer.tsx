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
  args?: Record<string, unknown>;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
  /** When true, render flat rows only — group provides the ToolProgress wrapper */
  inGroup?: boolean;
}

export function TickerRenderer({ args, result, loading, inGroup }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const tickers: TickerFinding[] = (data?.tickers as TickerFinding[] | undefined)
    ?? (args?.ticker ? [{ ticker: args.ticker as string, summary: result.summary }] : []);

  const rows = tickers.length > 0
    ? tickers.map((t, i) => (
        <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
          {t.summary}
        </ToolProgressTickerItem>
      ))
    : [<ToolProgressItem key="fallback">{result.summary}</ToolProgressItem>];

  if (inGroup) {
    return <>{rows}</>;
  }

  const header = result.progressLabel ?? result.summary;

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{header}</ToolProgressHeader>
      <ToolProgressContent>{rows}</ToolProgressContent>
    </ToolProgress>
  );
}
