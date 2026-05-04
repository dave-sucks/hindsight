"use client";

/**
 * ThesisCardRenderer — ui: "thesis-card"
 *
 * Renders TWO carousels per agent message based on which tools the agent
 * called:
 *
 *   "Read theses" carousel  ← driven by get_theses results
 *   "Wrote / edited theses" carousel  ← driven by record_thesis +
 *     update_thesis + show_thesis (record_thesis alias)
 *
 * Each tool call's renderer instance dispatches based on its tool name.
 * Only the FIRST renderer instance for each carousel actually renders;
 * subsequent calls return null because the carousel collected from all
 * relevant tool parts already includes them.
 *
 * No deduping across carousels — a thesis the agent read AND edited
 * appears in both. The chat is a log of what happened.
 */

import { useMemo, useState } from "react";
import { useMessage } from "@assistant-ui/react";
import type { ToolResult } from "@/lib/agent/tool-result";
import { ThesisCarousel } from "@/components/domain/thesis-carousel";
import { ReadThesesTable } from "@/components/domain/read-theses-table";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { MessageSearch01Icon, QuillWrite01Icon } from "@hugeicons/core-free-icons";
import type { ThesisCardData } from "@/components/domain/thesis-card";

interface Props {
  toolName: string;
  toolCallId?: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

const READ_TOOLS = new Set(["get_theses"]);
const WRITE_TOOLS = new Set(["record_thesis", "show_thesis", "update_thesis"]);

export function ThesisCardRenderer({ toolName, toolCallId, loading }: Props) {
  const content = useMessage((m) => m.content);
  const [openThesis, setOpenThesis] = useState<ThesisCardData | null>(null);

  // Split tool-call parts in this message into Read / Write buckets.
  const { readParts, writeParts } = useMemo(() => {
    const all = (content as unknown[])
      .map((p) => p as Record<string, unknown>)
      .filter((p) => p?.type === "tool-call");
    return {
      readParts: all.filter((p) => READ_TOOLS.has(p.toolName as string)),
      writeParts: all.filter((p) => WRITE_TOOLS.has(p.toolName as string)),
    };
  }, [content]);

  const isRead = READ_TOOLS.has(toolName);
  const isWrite = WRITE_TOOLS.has(toolName);

  // Each call instance renders only when it's the first call of its kind
  // in the message. Subsequent calls of the same kind collapse into the
  // already-rendered surface (table for reads, carousel for writes).
  const myParts = isRead ? readParts : writeParts;
  const myIndex = myParts.findIndex((p) => p.toolCallId === toolCallId);
  if (myIndex > 0) return null;

  // Loading skeleton when this is the first call of its kind and we
  // don't have any results yet.
  const readyCount = myParts.filter(
    (p) => (p.result ?? p.output) !== undefined,
  ).length;
  const allLoading = readyCount === 0 && loading;

  if (isRead) {
    if (allLoading) {
      return <ReadThesesTableSkeleton />;
    }
    const theses = collectReadTheses(readParts);
    if (theses.length === 0) return null;
    const noun = theses.length === 1 ? "thesis" : "theses";
    return (
      <>
        <div className="my-3 space-y-1">
          <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <HugeiconsIcon icon={MessageSearch01Icon} className="size-3.5 shrink-0" />
            <span>{`Reading ${theses.length} ${noun}`}</span>
          </div>
          <ReadThesesTable theses={theses} onRowClick={setOpenThesis} />
        </div>
        {openThesis ? (
          <ThesisSheet
            open={openThesis !== null}
            onOpenChange={(o) => {
              if (!o) setOpenThesis(null);
            }}
            {...openThesis}
          />
        ) : null}
      </>
    );
  }

  if (allLoading) {
    return <ThesisCarouselSkeleton count={Math.max(myParts.length, 1)} />;
  }

  const theses = collectWriteTheses(writeParts);
  if (theses.length === 0) return null;
  const heading = isWrite ? buildWriteHeading(writeParts, theses.length) : null;

  return (
    <div className="my-3 space-y-1">
      {heading ? (
        <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <HugeiconsIcon icon={QuillWrite01Icon} className="size-3.5 shrink-0" />
          <span>{heading}</span>
        </div>
      ) : null}
      <ThesisCarousel theses={theses} />
    </div>
  );
}

// ── Read-table skeleton ──────────────────────────────────────────────────────

function ReadThesesTableSkeleton() {
  return (
    <div className="my-3 space-y-1">
      <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <HugeiconsIcon icon={MessageSearch01Icon} className="size-3.5 shrink-0" />
        <span>Reading theses…</span>
      </div>
      <div className="rounded-xl border bg-card p-1 space-y-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 p-2">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <div className="flex-1" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function ThesisCarouselSkeleton({ count }: { count: number }) {
  return (
    <div className="my-2 flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="shrink-0 w-72 rounded-xl border border-border p-4 space-y-3"
        >
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
        </div>
      ))}
    </div>
  );
}

// ── Card collection ──────────────────────────────────────────────────────────

/**
 * get_theses returns `data.theses` (raw enriched rows) and `data.cards`
 * (ThesisCardData[] in render shape). Use cards when present, fall back
 * to a minimal mapping from theses for older results.
 */
function collectReadTheses(
  parts: Record<string, unknown>[],
): ThesisCardData[] {
  const out: ThesisCardData[] = [];
  for (const p of parts) {
    const r = (p.result ?? p.output) as Record<string, unknown> | undefined;
    if (!r) continue;
    const data = (r.ok === true && r.data ? r.data : r) as Record<
      string,
      unknown
    >;
    const cards = (data.cards as ThesisCardData[] | undefined) ?? [];
    for (const c of cards) {
      if (c?.ticker && c?.direction) out.push(c);
    }
  }
  return out;
}

/**
 * Write-side parts: record_thesis (+show_thesis alias) carry their card
 * data on the input args. update_thesis returns it under data.card. Both
 * shapes flow through a single mapper.
 */
function collectWriteTheses(
  parts: Record<string, unknown>[],
): ThesisCardData[] {
  const out: ThesisCardData[] = [];
  for (const p of parts) {
    const r = (p.result ?? p.output) as Record<string, unknown> | undefined;
    if (!r) continue;
    const data = (r.ok === true && r.data ? r.data : r) as Record<
      string,
      unknown
    >;

    // update_thesis: data.card holds the post-update snapshot.
    if (data.card && (data.card as ThesisCardData).ticker) {
      out.push(data.card as ThesisCardData);
      continue;
    }

    // record_thesis / show_thesis: read input args + result envelope, same
    // as the original renderer. Keeps backward compat with persisted
    // RunMessages that pre-date the data.card shape.
    const inputArgs = (p.args ?? p.input ?? {}) as Record<string, unknown>;
    const display =
      inputArgs.ticker && inputArgs.direction ? inputArgs : data;
    if (!display.ticker || !display.direction) continue;

    out.push({
      thesis_id:
        (data.thesis_id as string | undefined) ??
        (data.existing_thesis_id as string | undefined),
      ticker: display.ticker as string,
      direction: display.direction as "LONG" | "SHORT" | "PASS",
      confidence_score:
        (display.confidence_score as number) ??
        (display.confidenceScore as number) ??
        0,
      reasoning_summary: display.reasoning_summary as string | undefined,
      thesis_bullets: (display.thesis_bullets as string[]) ?? [],
      risk_flags: (display.risk_flags as string[]) ?? [],
      entry_price: display.entry_price as number | null | undefined,
      target_price: display.target_price as number | null | undefined,
      stop_loss: display.stop_loss as number | null | undefined,
      hold_duration: display.hold_duration as string | undefined,
      signal_types: (display.signal_types as string[]) ?? [],
      company_name: display.company_name as string | null | undefined,
      exchange: display.exchange as string | null | undefined,
      fundamentals: display.fundamentals as ThesisCardData["fundamentals"],
      status: (data.status as ThesisCardData["status"]) ?? "ACTIVE",
    });
  }
  return out;
}

// ── Heading text ─────────────────────────────────────────────────────────────

function buildWriteHeading(
  parts: Record<string, unknown>[],
  count: number,
): string {
  const recordCount = parts.filter(
    (p) => p.toolName === "record_thesis" || p.toolName === "show_thesis",
  ).length;
  const updateCount = parts.filter((p) => p.toolName === "update_thesis").length;
  const noun = count === 1 ? "thesis" : "theses";
  if (recordCount > 0 && updateCount === 0) return `Wrote ${count} ${noun}`;
  if (updateCount > 0 && recordCount === 0) return `Edited ${count} ${noun}`;
  return `Wrote / edited ${count} ${noun}`;
}
