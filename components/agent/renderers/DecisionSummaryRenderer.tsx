"use client";

import { useMemo } from "react";
import { useMessage } from "@assistant-ui/react";
import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
  ToolProgressTickerItem,
  type TickerActionIcon,
} from "@/components/ai-elements/tool-progress";

// ── Types ─────────────────────────────────────────────────────────────────────

type PlannedAction = {
  ticker: string;
  action: string;
  reasoning?: string;
};

type ExecutedOutcome = {
  tag: string;
  detail?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_TOOL_NAMES = new Set(["place_trade", "close_position", "manage_watchlist"]);

function normalizeTicker(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().trim();
}

function tagToActionIcon(tag: string | undefined): TickerActionIcon | undefined {
  switch (tag) {
    case "Buy":         return "buy";
    case "Sell":        return "sell";
    case "Watch":       return "watch";
    case "Unwatch":     return "unwatch";
    case "Closed-Win":
    case "Closed":      return "closed-win";
    case "Closed-Loss": return "closed-loss";
    case "Failed":
    case "NoOp":        return "failed";
    default:            return undefined;
  }
}

function plannedActionIcon(action: string): TickerActionIcon | undefined {
  const a = action.toUpperCase();
  if (a === "INITIATE" || a === "ADD") return "buy";
  if (a === "REDUCE" || a === "EXIT") return "sell";
  if (a === "WATCH") return "watch";
  if (a === "REMOVE_WATCH") return "unwatch";
  return undefined;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  toolName: string;
  toolCallId?: string;
  partIndex?: number;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

// ── complete_run renderer (simple CoT — briefing status only) ─────────────────

function CompleteRunRenderer({ result, loading }: { result: Extract<ToolResult, { ok: true }>; loading: boolean }) {
  if (loading) {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader loading>Completing run…</ToolProgressHeader>
      </ToolProgress>
    );
  }

  const data = result.data as Record<string, unknown> | null;
  const briefingStatus = data?.briefing as "success" | "failed" | "skipped" | undefined;
  const briefingError = data?.briefingError as string | null | undefined;

  let briefingLine: string | null = null;
  if (briefingStatus === "success") {
    briefingLine = "Briefing: written and verified";
  } else if (briefingStatus === "failed") {
    briefingLine = `Briefing: failed${briefingError ? ` — ${briefingError}` : ""}`;
  } else if (briefingStatus === "skipped") {
    briefingLine = `Briefing: skipped${briefingError ? ` — ${briefingError}` : ""}`;
  }

  return (
    <ToolProgress defaultOpen={briefingStatus === "failed"}>
      <ToolProgressHeader>Completing run</ToolProgressHeader>
      {briefingLine && (
        <ToolProgressContent>
          <ToolProgressItem>{briefingLine}</ToolProgressItem>
        </ToolProgressContent>
      )}
    </ToolProgress>
  );
}

// ── record_decision_plan renderer (forward-read pattern) ─────────────────────

function DecisionPlanRenderer({
  toolCallId,
  partIndex,
  result,
  loading,
}: {
  toolCallId?: string;
  partIndex?: number;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}) {
  const content = useMessage((m) => m.content) as unknown[];

  // Find our index — prefer toolCallId lookup, fall back to partIndex
  const myIndex = useMemo(() => {
    if (toolCallId) {
      const idx = content.findIndex((p) => {
        const part = p as Record<string, unknown> | undefined;
        return part?.type === "tool-call" && part.toolCallId === toolCallId;
      });
      if (idx >= 0) return idx;
    }
    return partIndex ?? -1;
  }, [content, toolCallId, partIndex]);

  // Walk forward from our position to collect executed action outcomes by ticker
  const outcomesByTicker = useMemo(() => {
    const map = new Map<string, ExecutedOutcome>();
    if (myIndex < 0) return map;
    for (let i = myIndex + 1; i < content.length; i++) {
      const part = content[i] as Record<string, unknown> | undefined;
      if (!part || part.type !== "tool-call") continue;
      const toolName = part.toolName as string | undefined;
      if (!toolName || !ACTION_TOOL_NAMES.has(toolName)) continue;

      const args = (part.args as Record<string, unknown> | undefined)
        ?? (part.input as Record<string, unknown> | undefined)
        ?? {};
      const ticker = normalizeTicker(args.ticker ?? args.symbol);
      if (!ticker) continue;

      const rawResult = (part.result as Record<string, unknown> | undefined)
        ?? (part.output as Record<string, unknown> | undefined);
      const tickerFindings = rawResult?.tickers as
        | { ticker: string; tag?: string; summary?: string }[]
        | undefined;
      const finding = tickerFindings?.find((t) => normalizeTicker(t.ticker) === ticker);

      map.set(ticker, { tag: finding?.tag ?? "", detail: finding?.summary });
    }
    return map;
  }, [content, myIndex]);

  const data = result.data as Record<string, unknown> | null;
  const plannedActions = (data?.planned_actions as PlannedAction[] | undefined) ?? [];

  // Build dynamic header from executed outcomes (or planned counts as fallback)
  const headerLabel = useMemo(() => {
    let bought = 0, sold = 0, closedWin = 0, closedLoss = 0;
    let watching = 0, unwatched = 0, failed = 0, held = 0, passed = 0;

    for (const p of plannedActions) {
      const ticker = normalizeTicker(p.ticker);
      const outcome = outcomesByTicker.get(ticker);
      if (outcome) {
        switch (outcome.tag) {
          case "Buy":         bought += 1; break;
          case "Sell":        sold += 1; break;
          case "Closed-Win":
          case "Closed":      closedWin += 1; break;
          case "Closed-Loss": closedLoss += 1; break;
          case "Watch":       watching += 1; break;
          case "Unwatch":     unwatched += 1; break;
          case "Failed":
          case "NoOp":        failed += 1; break;
        }
      } else {
        const a = p.action.toUpperCase();
        if (a === "INITIATE" || a === "ADD") bought += 1;
        else if (a === "REDUCE" || a === "EXIT") sold += 1;
        else if (a === "WATCH") watching += 1;
        else if (a === "REMOVE_WATCH") unwatched += 1;
        else if (a === "HOLD") held += 1;
        else if (a === "PASS") passed += 1;
      }
    }

    const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
    const parts: string[] = [];
    if (held > 0)       parts.push(`holding ${plural(held, "stock")}`);
    if (bought > 0)     parts.push(`bought ${plural(bought, "position")}`);
    if (sold > 0)       parts.push(`sold ${plural(sold, "position")}`);
    if (closedWin > 0)  parts.push(`closed ${plural(closedWin, "winner")}`);
    if (closedLoss > 0) parts.push(`closed ${plural(closedLoss, "loss")}`);
    if (watching > 0)   parts.push(`added ${plural(watching, "watchlist item")}`);
    if (unwatched > 0)  parts.push(`removed ${plural(unwatched, "watchlist item")}`);
    if (passed > 0)     parts.push(`${passed} passed`);
    if (failed > 0)     parts.push(`${failed} failed`);

    if (parts.length === 0) return "Managing portfolio";
    let sentence: string;
    if (parts.length === 1) sentence = parts[0];
    else if (parts.length === 2) sentence = `${parts[0]} and ${parts[1]}`;
    else sentence = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
    return `Managing portfolio — ${sentence}`;
  }, [plannedActions, outcomesByTicker]);

  if (loading) {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader loading>Managing portfolio…</ToolProgressHeader>
      </ToolProgress>
    );
  }

  return (
    <ToolProgress defaultOpen>
      <ToolProgressHeader>{headerLabel}</ToolProgressHeader>
      <ToolProgressContent>
        {plannedActions.map((p, i) => {
          const ticker = normalizeTicker(p.ticker);
          const outcome = outcomesByTicker.get(ticker);
          const displayTag = outcome?.tag || p.action;
          const icon = outcome ? tagToActionIcon(outcome.tag) : plannedActionIcon(p.action);
          const detail = outcome?.detail || p.reasoning || "";
          return (
            <ToolProgressTickerItem
              key={`${p.ticker}-${i}`}
              ticker={p.ticker}
              tag={displayTag}
              actionIcon={icon}
            >
              {detail}
            </ToolProgressTickerItem>
          );
        })}
      </ToolProgressContent>
    </ToolProgress>
  );
}

// ── DecisionSummaryRenderer (dispatcher) ─────────────────────────────────────

export function DecisionSummaryRenderer({ toolName, toolCallId, partIndex, result, loading }: Props) {
  if (toolName === "complete_run" || toolName === "summarize_run") {
    return <CompleteRunRenderer result={result} loading={loading} />;
  }
  return (
    <DecisionPlanRenderer
      toolCallId={toolCallId}
      partIndex={partIndex}
      result={result}
      loading={loading}
    />
  );
}
