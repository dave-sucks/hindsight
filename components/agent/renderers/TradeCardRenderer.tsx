"use client";

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressTickerItem,
  type TickerActionIcon,
} from "@/components/ai-elements/tool-progress";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function TradeCardRenderer({ toolName, result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const ticker = (data?.ticker as string) ?? (data?.symbol as string) ?? "";
  const status = ((data?.status as string) ?? "").toUpperCase();
  const isClose = toolName === "close_position";

  const actionIcon: TickerActionIcon =
    status === "FAILED" ? "failed" : isClose ? "sell" : "buy";

  const label = isClose ? "Closing position" : "Placing trade";

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>{label}</ToolProgressHeader>
      <ToolProgressContent>
        {ticker ? (
          <ToolProgressTickerItem ticker={ticker} actionIcon={actionIcon}>
            {result.summary}
          </ToolProgressTickerItem>
        ) : (
          <ToolProgressTickerItem ticker="" actionIcon={actionIcon}>
            {result.summary}
          </ToolProgressTickerItem>
        )}
      </ToolProgressContent>
    </ToolProgress>
  );
}
