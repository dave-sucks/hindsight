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
import { Skeleton } from "@/components/ui/skeleton";

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

  const readyCount = thesisParts.filter((p) => (p.result ?? p.output) !== undefined).length;
  const pendingCount = thesisParts.length - readyCount;
  const allLoading = readyCount === 0 && loading;

  // Still loading first thesis — show skeleton card(s)
  if (allLoading) {
    const skeletonCount = Math.max(thesisParts.length, 1);
    return (
      <div className="my-2 flex gap-3 overflow-hidden">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="shrink-0 w-72 rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <div className="space-y-1.5 pt-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 flex-1" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Collect all ready thesis results
  const theses = thesisParts
    .map((p): ThesisCardData | null => {
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
      };
    })
    .filter((t): t is ThesisCardData => t !== null);

  if (theses.length === 0) return null;

  return (
    <>
      <ThesisCarousel theses={theses} />
      {pendingCount > 0 && (
        <div className="mt-1 flex gap-2">
          {Array.from({ length: pendingCount }).map((_, i) => (
            <div key={i} className="shrink-0 w-72 rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <div className="space-y-1.5 pt-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
