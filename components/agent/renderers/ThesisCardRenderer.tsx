"use client";

/**
 * ThesisCardRenderer — ui: "thesis-card"
 *
 * The FIRST record_thesis/show_thesis call in a message reads forward through
 * all thesis parts, collects every ThesisCardData, and renders the ThesisCarousel.
 * Every subsequent thesis call returns null — the carousel already contains it.
 */

import { useMemo } from "react";
import { useMessage } from "@assistant-ui/react";
import type { ToolResult } from "@/lib/agent/tool-result";
import { ThesisCarousel } from "@/components/domain/thesis-carousel";
import type { ThesisCardData } from "@/components/domain/thesis-card";

interface Props {
  toolName: string;
  toolCallId?: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function ThesisCardRenderer({ toolCallId, loading }: Props) {
  const content = useMessage((m) => m.content);

  const thesisParts = useMemo(() => {
    return (content as unknown[])
      .map((p) => p as Record<string, unknown>)
      .filter(
        (p) =>
          p?.type === "tool-call" &&
          (p.toolName === "record_thesis" || p.toolName === "show_thesis"),
      );
  }, [content]);

  // Only the first thesis call renders the carousel
  const myIndex = thesisParts.findIndex((p) => p.toolCallId === toolCallId);
  if (myIndex > 0) return null;

  // Still loading — show placeholder if no results yet
  if (loading && thesisParts.every((p) => (p.result ?? p.output) === undefined)) {
    return (
      <div className="my-2 text-sm text-muted-foreground">Recording theses…</div>
    );
  }

  // Collect all ready thesis results
  const theses: ThesisCardData[] = thesisParts
    .map((p) => {
      const r = (p.result ?? p.output) as Record<string, unknown> | undefined;
      if (!r) return null;
      // Unwrap ToolResult envelope if present
      const data = (r.ok === true && r.data ? r.data : r) as Record<string, unknown>;
      if (!data.ticker || !data.direction) return null;
      return {
        ticker: data.ticker as string,
        direction: data.direction as "LONG" | "SHORT" | "PASS",
        confidence_score: (data.confidence_score as number) ?? (data.confidenceScore as number) ?? 0,
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
      } satisfies ThesisCardData;
    })
    .filter((t): t is ThesisCardData => t !== null);

  if (theses.length === 0) return null;

  return <ThesisCarousel theses={theses} />;
}
