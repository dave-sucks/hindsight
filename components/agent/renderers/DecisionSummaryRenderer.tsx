"use client";

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
  ToolProgressTickerItem,
  type TickerActionIcon,
} from "@/components/ai-elements/tool-progress";

interface PlannedAction {
  ticker: string;
  action: string;
  reasoning?: string;
}

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

function plannedActionIcon(action: string): TickerActionIcon | undefined {
  const a = action.toUpperCase();
  if (a === "INITIATE" || a === "ADD") return "buy";
  if (a === "REDUCE" || a === "EXIT") return "sell";
  if (a === "WATCH") return "watch";
  if (a === "REMOVE_WATCH") return "unwatch";
  return undefined;
}

export function DecisionSummaryRenderer({ toolName, result, loading }: Props) {
  // complete_run: show briefing outcome, only open if it failed
  if (toolName === "complete_run" || toolName === "summarize_run") {
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
    if (briefingStatus === "success") briefingLine = "Briefing: written and verified";
    else if (briefingStatus === "failed") briefingLine = `Briefing: failed${briefingError ? ` — ${briefingError}` : ""}`;
    else if (briefingStatus === "skipped") briefingLine = `Briefing: skipped${briefingError ? ` — ${briefingError}` : ""}`;

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

  // record_decision_plan: show planned actions as ticker CoT rows
  const data = result.data as Record<string, unknown> | null;
  const plannedActions = (data?.planned_actions as PlannedAction[] | undefined) ?? [];

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading}>Managing portfolio</ToolProgressHeader>
      <ToolProgressContent>
        {plannedActions.length > 0
          ? plannedActions.map((p, i) => (
              <ToolProgressTickerItem
                key={`${p.ticker}-${i}`}
                ticker={p.ticker}
                tag={p.action}
                actionIcon={plannedActionIcon(p.action)}
              >
                {p.reasoning ?? ""}
              </ToolProgressTickerItem>
            ))
          : <ToolProgressItem>{result.summary}</ToolProgressItem>
        }
      </ToolProgressContent>
    </ToolProgress>
  );
}
