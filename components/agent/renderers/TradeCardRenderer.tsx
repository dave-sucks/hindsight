"use client";

/**
 * TradeCardRenderer — renders the TradeCard domain component for place_trade /
 * close_position results.
 *
 * In Step 2 this shows a summary card. Full domain card wiring happens when
 * the trade tools are migrated in Steps 3-4.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function TradeCardRenderer({ toolName, result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const status = (data?.status as string) ?? (loading ? "pending" : "unknown");
  const ticker = (data?.ticker as string) ?? (data?.symbol as string) ?? "";
  const direction = (data?.direction as string) ?? "";

  const statusVariant =
    status === "filled" ? "default" :
    status === "closed" ? "secondary" :
    status === "failed" ? "destructive" :
    "outline";

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          {toolName === "place_trade" ? `Placing trade${ticker ? ` — ${direction} ${ticker}` : ""}...` : `Closing position${ticker ? ` — ${ticker}` : ""}...`}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Badge variant={statusVariant}>{status}</Badge>
        <span className="text-sm font-medium">
          {direction && <span className="mr-1">{direction}</span>}
          {ticker}
        </span>
        <span className="text-sm text-muted-foreground ml-auto">{result.summary}</span>
      </CardContent>
    </Card>
  );
}
