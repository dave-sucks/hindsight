"use client";

/**
 * AgentToolGroup — top-level dispatcher wired into assistant-ui's single
 * `ToolGroup` slot. The framework hands us a contiguous range of tool calls
 * from the message stream; we walk the range in ORIGINAL ORDER and group
 * only consecutive research tools into a single ResearchToolGroup. Every
 * other tool call (theses, decision plan, run summary, complete run, and
 * action tools) renders via its own useAssistantToolUI render in its
 * original position.
 *
 * Action tools (place_trade / close_position / manage_watchlist) render as
 * `null` from their standalone tool-ui registrations. Their results are
 * merged INTO the Decision CoT (record_decision_plan render) by walking
 * forward in the message stream — that's where the failed/success states
 * end up visible to the user. There is no separate "Portfolio actions"
 * group anywhere — one CoT, owned by the decision plan.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, Fragment, Children, type ReactNode } from "react";
import { ResearchToolGroup, RESEARCH_STEPS } from "./research-tool-group";

// ── Shared step shape ──────────────────────────────────────────────────────

export interface ToolStepPart {
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | undefined;
  key: string;
}

type Block =
  | { kind: "research"; steps: ToolStepPart[] }
  | { kind: "passthrough"; childIndex: number };

interface ToolGroupProps {
  startIndex: number;
  endIndex: number;
  children?: ReactNode;
}

export function AgentToolGroup({ startIndex, endIndex, children }: ToolGroupProps) {
  const content = useMessage((m) => m.content);

  const blocks = useMemo<Block[]>(() => {
    const result: Block[] = [];
    let researchBuffer: ToolStepPart[] = [];

    const flushResearch = () => {
      if (researchBuffer.length > 0) {
        result.push({ kind: "research", steps: researchBuffer });
        researchBuffer = [];
      }
    };

    for (let i = startIndex; i <= endIndex; i++) {
      const childIndex = i - startIndex;
      const part = (content as unknown[])[i] as Record<string, unknown> | undefined;

      if (!part || part.type !== "tool-call") {
        flushResearch();
        result.push({ kind: "passthrough", childIndex });
        continue;
      }

      const toolName = part.toolName as string;
      const isResearch = !!RESEARCH_STEPS[toolName];

      if (isResearch) {
        const args = (part.args as Record<string, unknown>)
          ?? (part.input as Record<string, unknown>)
          ?? {};
        const partResult = (part.result as Record<string, unknown> | undefined)
          ?? (part.output as Record<string, unknown> | undefined);
        const ticker = (args.ticker as string) ?? (args.symbol as string) ?? "";
        researchBuffer.push({
          toolName,
          args,
          result: partResult,
          key: `${toolName}-${ticker}-${i}`,
        });
      } else {
        flushResearch();
        result.push({ kind: "passthrough", childIndex });
      }
    }

    flushResearch();
    return result;
  }, [content, startIndex, endIndex]);

  if (blocks.length === 0) {
    return <>{children}</>;
  }

  const childArray = Children.toArray(children);

  return (
    <>
      {blocks.map((block, idx) => {
        if (block.kind === "research") {
          return <ResearchToolGroup key={`r-${idx}`} steps={block.steps} />;
        }
        return (
          <Fragment key={`p-${idx}`}>{childArray[block.childIndex]}</Fragment>
        );
      })}
    </>
  );
}
