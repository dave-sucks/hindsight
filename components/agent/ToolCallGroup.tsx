"use client";

/**
 * ToolCallGroup — replaces AgentToolGroup in the MessagePrimitive.Parts
 * `components.ToolGroup` slot.
 *
 * Reads tool call parts in their original order. Groups consecutive parts
 * whose result.groupId values match into a single collapsible block.
 * Non-grouped tool calls render individually via ToolCallRow.
 *
 * Groups render as ONE flat ToolProgress block — no nested collapsibles.
 * Each group extracts data.tickers from every result in the group and
 * renders them all as flat ToolProgressTickerItem rows.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { ToolCallRow } from "./ToolCallRow";
import { normalizeToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressTickerItem,
  type TickerActionIcon,
} from "@/components/ai-elements/tool-progress";
import { ThesisCarousel } from "@/components/domain/thesis-carousel";
import type { ThesisCardData } from "@/components/domain/thesis-card";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCallPart {
  type: string;
  toolName: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  output?: unknown;
  state?: string;
}

interface TickerItem {
  ticker: string;
  tag?: string;
  summary: string;
  actionIcon?: TickerActionIcon;
}

type Block =
  | { kind: "solo"; part: ToolCallPart; index: number }
  | { kind: "group"; groupId: string; parts: Array<{ part: ToolCallPart; index: number }> };

interface ToolGroupProps {
  startIndex: number;
  endIndex: number;
  children?: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ToolCallGroup({ startIndex, endIndex }: ToolGroupProps) {
  const content = useMessage((m) => m.content);

  const blocks = useMemo<Block[]>(() => {
    const result: Block[] = [];
    let groupBuffer: Array<{ part: ToolCallPart; index: number }> | null = null;
    let activeGroupId: string | null = null;

    const flushGroup = () => {
      if (groupBuffer && groupBuffer.length > 0) {
        result.push({ kind: "group", groupId: activeGroupId!, parts: groupBuffer });
        groupBuffer = null;
        activeGroupId = null;
      }
    };

    for (let i = startIndex; i <= endIndex; i++) {
      const part = (content as unknown[])[i] as ToolCallPart | undefined;
      if (!part || part.type !== "tool-call") {
        flushGroup();
        continue;
      }

      const rawResult = part.result ?? part.output;
      const normalized = rawResult != null
        ? normalizeToolResult(part.toolName, rawResult)
        : null;

      const partGroupId = normalized?.ok ? normalized.groupId ?? null : null;

      if (partGroupId) {
        if (partGroupId === activeGroupId) {
          groupBuffer!.push({ part, index: i });
        } else {
          flushGroup();
          activeGroupId = partGroupId;
          groupBuffer = [{ part, index: i }];
        }
      } else {
        flushGroup();
        result.push({ kind: "solo", part, index: i });
      }
    }

    flushGroup();
    return result;
  }, [content, startIndex, endIndex]);

  if (blocks.length === 0) return null;

  return (
    <>
      {blocks.map((block, idx) => {
        if (block.kind === "solo") {
          const part = block.part;
          const rawResult = part.result ?? part.output;
          const args = part.args ?? part.input ?? {};
          const isLoading = rawResult === undefined && part.state !== "output-available";
          return (
            <ToolCallRow
              key={`solo-${block.index}`}
              toolName={part.toolName}
              args={args as Record<string, unknown>}
              rawResult={rawResult}
              loading={isLoading}
            />
          );
        }

        if (block.groupId === "thesis") {
          return <ThesisCarouselBlock key={`group-${idx}`} parts={block.parts} loading={block.parts.some(p => (p.part.result ?? p.part.output) === undefined)} />;
        }

        if (block.groupId === "execution") {
          return <ExecutionGroupBlock key={`group-${idx}`} parts={block.parts} />;
        }

        return <ResearchGroupBlock key={`group-${idx}`} parts={block.parts} />;
      })}
    </>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract flat TickerItem[] from a normalized result, falling back to args.ticker. */
function extractTickerItems(
  toolName: string,
  rawResult: unknown,
  args: Record<string, unknown>,
): TickerItem[] {
  const normalized = normalizeToolResult(toolName, rawResult);
  if (!normalized.ok) return [];
  const data = normalized.data as Record<string, unknown> | null;
  const tickers = data?.tickers as TickerItem[] | undefined;
  if (tickers && tickers.length > 0) return tickers;
  // Fallback for old runs / tools without data.tickers
  const ticker = args.ticker as string | undefined;
  if (ticker) return [{ ticker, summary: normalized.summary }];
  return [];
}

// ── ResearchGroupBlock ────────────────────────────────────────────────────────

interface GroupBlockProps {
  parts: Array<{ part: ToolCallPart; index: number }>;
}

function ResearchGroupBlock({ parts }: GroupBlockProps) {
  const loadingAny = parts.some((p) => (p.part.result ?? p.part.output) === undefined);

  const loadedItems: TickerItem[] = [];
  const loadingTickers: string[] = [];

  for (const { part } of parts) {
    const rawResult = part.result ?? part.output;
    const args = (part.args ?? part.input ?? {}) as Record<string, unknown>;

    if (rawResult == null) {
      const t = args.ticker as string | undefined;
      if (t) loadingTickers.push(t);
      continue;
    }

    loadedItems.push(...extractTickerItems(part.toolName, rawResult, args));
  }

  const headerTickers = [...new Set(
    parts
      .map(({ part }) => {
        const args = (part.args ?? part.input ?? {}) as Record<string, unknown>;
        return args.ticker as string | undefined;
      })
      .filter(Boolean) as string[]
  )];

  const headerText = headerTickers.length > 0
    ? `Researching ${headerTickers.join(", ")}`
    : "Researching";

  return (
    <ToolProgress defaultOpen={true}>
      <ToolProgressHeader loading={loadingAny}>{headerText}</ToolProgressHeader>
      <ToolProgressContent>
        {loadedItems.map((t, i) => (
          <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag} actionIcon={t.actionIcon}>
            {t.summary}
          </ToolProgressTickerItem>
        ))}
        {loadingTickers.map((ticker, i) => (
          <ToolProgressTickerItem key={`loading-${i}`} ticker={ticker} active>
            Researching…
          </ToolProgressTickerItem>
        ))}
      </ToolProgressContent>
    </ToolProgress>
  );
}

// ── ExecutionGroupBlock ───────────────────────────────────────────────────────

function ExecutionGroupBlock({ parts }: GroupBlockProps) {
  const loadingAny = parts.some((p) => (p.part.result ?? p.part.output) === undefined);

  const loadedItems: TickerItem[] = [];
  const loadingItems: Array<{ ticker: string; toolName: string }> = [];

  for (const { part } of parts) {
    const rawResult = part.result ?? part.output;
    const args = (part.args ?? part.input ?? {}) as Record<string, unknown>;

    if (rawResult == null) {
      const t = args.ticker as string | undefined;
      if (t) loadingItems.push({ ticker: t, toolName: part.toolName });
      continue;
    }

    loadedItems.push(...extractTickerItems(part.toolName, rawResult, args));
  }

  // Build dynamic header from actionIcons in loaded items
  let buys = 0, sells = 0, watches = 0, unwatches = 0;
  for (const item of loadedItems) {
    if (item.actionIcon === "buy") buys++;
    else if (item.actionIcon === "sell" || item.actionIcon === "closed-win" || item.actionIcon === "closed-loss") sells++;
    else if (item.actionIcon === "watch") watches++;
    else if (item.actionIcon === "unwatch") unwatches++;
  }
  // Also count loading items by toolName
  for (const item of loadingItems) {
    if (item.toolName === "close_position") sells++;
    else if (item.toolName === "place_trade") buys++;
    else if (item.toolName === "manage_watchlist") watches++;
  }

  const summaryParts: string[] = [];
  if (buys > 0) summaryParts.push(`buying ${buys}`);
  if (sells > 0) summaryParts.push(`closing ${sells}`);
  if (watches > 0) summaryParts.push(`watching ${watches}`);
  if (unwatches > 0) summaryParts.push(`removing ${unwatches}`);

  const headerText = summaryParts.length > 0
    ? `Managing portfolio — ${summaryParts.join(", ")}`
    : "Managing portfolio";

  if (loadedItems.length === 0 && loadingItems.length === 0) {
    return (
      <ToolProgress defaultOpen={loadingAny}>
        <ToolProgressHeader loading={loadingAny}>{headerText}</ToolProgressHeader>
      </ToolProgress>
    );
  }

  return (
    <ToolProgress defaultOpen={true}>
      <ToolProgressHeader loading={loadingAny}>{headerText}</ToolProgressHeader>
      <ToolProgressContent>
        {loadedItems.map((t, i) => (
          <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag} actionIcon={t.actionIcon}>
            {t.summary}
          </ToolProgressTickerItem>
        ))}
        {loadingItems.map((item, i) => (
          <ToolProgressTickerItem key={`loading-${i}`} ticker={item.ticker} active>
            {item.toolName === "close_position"
              ? "Closing position…"
              : item.toolName === "manage_watchlist"
              ? "Updating watchlist…"
              : "Placing trade…"}
          </ToolProgressTickerItem>
        ))}
      </ToolProgressContent>
    </ToolProgress>
  );
}

// ── ThesisCarouselBlock ───────────────────────────────────────────────────────

interface ThesisCarouselProps {
  parts: Array<{ part: ToolCallPart; index: number }>;
  loading: boolean;
}

function ThesisCarouselBlock({ parts, loading }: ThesisCarouselProps) {
  if (loading && parts.every(({ part }) => (part.result ?? part.output) === undefined)) {
    return (
      <div className="my-2 text-sm text-muted-foreground">Recording theses…</div>
    );
  }

  const theses: ThesisCardData[] = [];

  for (const { part } of parts) {
    const rawResult = part.result ?? part.output;
    if (rawResult == null) continue;
    const normalized = normalizeToolResult(part.toolName, rawResult);
    if (!normalized.ok) continue;
    const data = normalized.data as Record<string, unknown> | null;
    if (!data?.ticker || !data?.direction) continue;

    theses.push({
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
    });
  }

  if (theses.length === 0) return null;

  return <ThesisCarousel theses={theses} />;
}
