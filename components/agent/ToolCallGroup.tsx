"use client";

/**
 * ToolCallGroup — generic collapsible group.
 *
 * Groups consecutive tool-call parts with the same groupId into one
 * ToolProgress block. Every child renders via <ToolCallRow inGroup />.
 * Solo parts (no groupId) render via <ToolCallRow /> directly.
 *
 * Zero knowledge of group type. Zero special-case blocks.
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { ToolCallRow } from "./ToolCallRow";
import { normalizeToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
} from "@/components/ai-elements/tool-progress";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCallPart {
  type: string;
  toolName: string;
  toolCallId?: string;
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
          const { part } = block;
          const rawResult = part.result ?? part.output;
          const args = part.args ?? part.input ?? {};
          const isLoading = rawResult === undefined && part.state !== "output-available";
          return (
            <ToolCallRow
              key={`solo-${block.index}`}
              toolName={part.toolName}
              toolCallId={part.toolCallId}
              args={args as Record<string, unknown>}
              rawResult={rawResult}
              loading={isLoading}
            />
          );
        }

        // Generic group — ONE ToolProgress, all children via ToolCallRow
        const loadingAny = block.parts.some(
          (p) => (p.part.result ?? p.part.output) === undefined,
        );
        const tickers = [
          ...new Set(
            block.parts
              .map(({ part }) => {
                const args = (part.args ?? part.input ?? {}) as Record<string, unknown>;
                return args.ticker as string | undefined;
              })
              .filter(Boolean) as string[],
          ),
        ];
        const header = tickers.length > 0 ? tickers.join(", ") : block.groupId;

        return (
          <ToolProgress key={`group-${idx}`} defaultOpen={true}>
            <ToolProgressHeader loading={loadingAny}>{header}</ToolProgressHeader>
            <ToolProgressContent>
              {block.parts.map(({ part, index }) => {
                const rawResult = part.result ?? part.output;
                const args = part.args ?? part.input ?? {};
                const isLoading = rawResult === undefined && part.state !== "output-available";
                return (
                  <ToolCallRow
                    key={index}
                    toolName={part.toolName}
                    toolCallId={part.toolCallId}
                    args={args as Record<string, unknown>}
                    rawResult={rawResult}
                    loading={isLoading}
                    inGroup
                  />
                );
              })}
            </ToolProgressContent>
          </ToolProgress>
        );
      })}
    </>
  );
}
