"use client";

/**
 * ThesisCardRenderer — renders the full ThesisCard with sheet for record_thesis results.
 *
 * ThesisCard already contains a Sheet trigger internally, so clicking the card
 * opens the full thesis detail sheet without any extra wiring here.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import { Card, CardContent } from "@/components/ui/card";
import { ThesisCard, type ThesisCardData } from "@/components/domain/thesis-card";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function ThesisCardRenderer({ result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const ticker = (data?.ticker as string) ?? "";
  const direction = (data?.direction as string) ?? "";
  const confidence = (data?.confidence_score as number) ?? (data?.confidenceScore as number) ?? null;

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Recording thesis{ticker ? ` for ${ticker}` : ""}...
        </CardContent>
      </Card>
    );
  }

  if (!data || !ticker || !direction) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          {result.summary}
        </CardContent>
      </Card>
    );
  }

  // Map ToolResult data to ThesisCardData
  const thesisData: ThesisCardData = {
    ticker,
    direction: direction as "LONG" | "SHORT" | "PASS",
    confidence_score: confidence ?? 0,
    reasoning_summary: data.reasoning_summary as string | undefined,
    thesis_bullets: (data.thesis_bullets as string[]) ?? [],
    risk_flags: (data.risk_flags as string[]) ?? [],
    entry_price: data.entry_price as number | null | undefined,
    target_price: data.target_price as number | null | undefined,
    stop_loss: data.stop_loss as number | null | undefined,
    hold_duration: data.hold_duration as string | undefined,
    signal_types: (data.signal_types as string[]) ?? [],
    company_name: data.company_name as string | null | undefined,
    exchange: data.exchange as string | null | undefined,
    fundamentals: data.fundamentals as ThesisCardData["fundamentals"],
    status: (data.status as ThesisCardData["status"]) ?? "ACTIVE",
  };

  return <ThesisCard {...thesisData} />;
}
