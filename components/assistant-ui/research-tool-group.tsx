"use client";

/**
 * ResearchToolGroup — Custom ToolGroup component for MessagePrimitive.Parts.
 *
 * When consecutive tool calls are grouped by assistant-ui, this component
 * inspects the group and renders "research step" tools (options flow, analyst
 * targets, etc.) as steps inside a single ChainOfThought block. Card-based
 * tools (StockCard, TradeCard, etc.) render normally alongside.
 *
 * To add a new tool as a CoT step instead of a card, add an entry to
 * RESEARCH_STEPS below — then set its useAssistantToolUI render to return null.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { Activity, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";

// ── Research Step Registry ──────────────────────────────────────────────────

interface ResearchStepConfig {
  /** Icon for the step row */
  icon: LucideIcon;
  /** Loading label (no result yet) */
  loadingLabel: (ticker: string) => string;
  /** Completed label — receives the raw tool result */
  completeLabel: (ticker: string, result: Record<string, unknown>) => string;
}

/**
 * Tools that render as ChainOfThought steps instead of domain cards.
 * Their useAssistantToolUI render functions must return null.
 */
export const RESEARCH_STEPS: Record<string, ResearchStepConfig> = {
  get_options_flow: {
    icon: Activity,
    loadingLabel: (ticker) => `Scanning unusual options activity — ${ticker}`,
    completeLabel: (ticker, result) => {
      const available = result.available !== false;
      if (!available) return `No options data available for ${ticker}`;
      const pcr = result.put_call_ratio ?? "N/A";
      const signal = (result.signal as string) ?? "neutral";
      const contracts = result.contracts_available ?? 0;
      return `P/C ratio: ${pcr} — Signal: ${signal} — ${contracts} contracts`;
    },
  },
  get_analyst_targets: {
    icon: Target,
    loadingLabel: (ticker) => `Fetching Wall Street consensus — ${ticker}`,
    completeLabel: (ticker, result) => {
      const hasTargets =
        result.consensus_target != null ||
        result.high != null ||
        result.low != null;
      if (!hasTargets) return `No analyst coverage found for ${ticker}`;
      const n = result.num_analysts ?? 0;
      const consensus = (result.consensus_target as number)?.toFixed(2) ?? "N/A";
      const low = (result.low as number)?.toFixed(0) ?? "?";
      const high = (result.high as number)?.toFixed(0) ?? "?";
      return `${n} analysts — consensus $${consensus}, range $${low} – $${high}`;
    },
  },
};

// ── ToolGroup Component ─────────────────────────────────────────────────────

interface ToolGroupProps {
  startIndex: number;
  endIndex: number;
  children?: ReactNode;
}

export function ResearchToolGroup({
  startIndex,
  endIndex,
  children,
}: ToolGroupProps) {
  const content = useMessage((m) => m.content);

  // Identify which parts in this range are research-step tools
  const stepParts = useMemo(() => {
    const steps: Array<{
      toolName: string;
      config: ResearchStepConfig;
      args: Record<string, unknown>;
      result: Record<string, unknown> | undefined;
    }> = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const part = (content as unknown[])[i] as Record<string, unknown>;
      // assistant-ui normalizes to "tool-call" but check both formats
      if (part?.type !== "tool-call") continue;
      const toolName = part.toolName as string;
      const config = RESEARCH_STEPS[toolName];
      if (!config) continue;
      // AI SDK v6 uses args/result; persisted replay may use input/output
      const args = (part.args as Record<string, unknown>)
        ?? (part.input as Record<string, unknown>)
        ?? {};
      const result = (part.result as Record<string, unknown> | undefined)
        ?? (part.output as Record<string, unknown> | undefined);
      steps.push({ toolName, config, args, result });
    }

    return steps;
  }, [content, startIndex, endIndex]);

  // No research steps in this group — just render children (card tools) normally
  if (stepParts.length === 0) {
    return <>{children}</>;
  }

  // Build the CoT header — use shared ticker if all steps target the same one
  const tickers = [
    ...new Set(stepParts.map((s) => (s.args.ticker as string) ?? "").filter(Boolean)),
  ];
  const headerLabel =
    tickers.length === 1
      ? `Researching ${tickers[0]}`
      : tickers.length > 1
        ? `Researching ${tickers.join(", ")}`
        : "Research";

  // Open while any step is still loading
  const anyLoading = stepParts.some((s) => s.result === undefined);

  return (
    <>
      <ChainOfThought defaultOpen={anyLoading}>
        <ChainOfThoughtHeader>{headerLabel}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {stepParts.map((step) => {
            const ticker = (step.args.ticker as string) ?? "";
            const label = step.result
              ? step.config.completeLabel(ticker, step.result)
              : step.config.loadingLabel(ticker);
            const status = step.result ? "complete" : "active";

            return (
              <ChainOfThoughtStep
                key={step.toolName}
                icon={step.config.icon}
                label={label}
                status={status}
              />
            );
          })}
        </ChainOfThoughtContent>
      </ChainOfThought>
      {children}
    </>
  );
}
