"use client";

/**
 * ToolCallGroup — replaces AgentToolGroup in the MessagePrimitive.Parts
 * `components.ToolGroup` slot.
 *
 * Reads tool call parts in their original order. Groups consecutive parts
 * whose result.groupId values match into a single collapsible block.
 * Non-grouped tool calls render individually via ToolCallRow.
 *
 * Unlike the old AgentToolGroup + RESEARCH_STEPS allowlist pattern, grouping
 * here is declared by the tool itself (via ctx.groupId("research") in
 * defineTool). No central allowlist needed.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { ToolCallRow } from "./ToolCallRow";
import { normalizeToolResult } from "@/lib/agent/tool-result";

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
          // Extend current group
          groupBuffer!.push({ part, index: i });
        } else {
          // Flush previous group and start a new one
          flushGroup();
          activeGroupId = partGroupId;
          groupBuffer = [{ part, index: i }];
        }
      } else {
        // No groupId — render solo
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

        // Group: render as a grouped block
        // For now, render each part individually but wrapped.
        // In Steps 3-4, the ResearchGroupBlock component replaces this
        // to get the collapsible "Researching X" header.
        return (
          <ResearchGroupBlock key={`group-${idx}`} groupId={block.groupId} parts={block.parts} />
        );
      })}
    </>
  );
}

// ── ResearchGroupBlock ────────────────────────────────────────────────────────

interface GroupBlockProps {
  groupId: string;
  parts: Array<{ part: ToolCallPart; index: number }>;
}

function ResearchGroupBlock({ parts }: GroupBlockProps) {
  // Collect tickers from all parts in this group for the header label
  const loadingAny = parts.some((p) => (p.part.result ?? p.part.output) === undefined);

  return (
    <div className="flex flex-col gap-1">
      {parts.map(({ part, index }) => {
        const rawResult = part.result ?? part.output;
        const args = (part.args ?? part.input ?? {}) as Record<string, unknown>;
        const isLoading = rawResult === undefined && part.state !== "output-available";
        return (
          <ToolCallRow
            key={`grouped-${index}`}
            toolName={part.toolName}
            args={args}
            rawResult={rawResult}
            loading={isLoading || (loadingAny && rawResult === undefined)}
          />
        );
      })}
    </div>
  );
}
