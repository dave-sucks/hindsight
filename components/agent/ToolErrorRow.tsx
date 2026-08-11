"use client";

/**
 * ToolErrorRow — the `result.ok === false` branch of ToolCallRow.
 *
 * NOT a sixth renderer (see CLAUDE.md "Never invent per-tool renderers"). The
 * five renderers are reached through the `ui` discriminator, which only exists
 * on a *successful* ToolResult. A failure has no `ui`, no `data.items` and no
 * `progressLabel` — there is nothing for ToolUIRenderer to iterate — so the
 * error path needs its own row. It is generic across every tool: one component,
 * no per-tool branching, same ToolProgress primitives as every other row.
 *
 * Collapsed it reads as one muted line with a red dot:
 *
 *   ● close_position — Invalid input: reason expected TARGET, STOP or MANUAL  ›
 *
 * Expanded it shows the structured detail as JSON. The parse lives in
 * lib/agent/tool-error.ts.
 */

import { memo } from "react";
import { parseToolError, toolErrorDetailJson } from "@/lib/agent/tool-error";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
} from "@/components/ai-elements/tool-progress";
import { JsonBlock } from "@/components/ai-elements/json-block";
import { cn } from "@/lib/utils";

/** Red dot in the same 14px slot every other row icon occupies. */
function ErrorDot({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center", className)} aria-hidden>
      <span className="size-1.5 rounded-full bg-destructive" />
    </span>
  );
}

interface Props {
  toolName: string;
  error: string;
}

/**
 * No `inGroup` variant: ToolCallGroup only buffers parts whose normalized
 * result is ok — a failure has no groupId, so it always flushes the buffer and
 * renders solo. An in-group error row is unreachable, and a prop for it would
 * be an untestable branch implying otherwise.
 */
export const ToolErrorRow = memo(function ToolErrorRow({ toolName, error }: Props) {
  const parsed = parseToolError(error, toolName);
  const detailJson = toolErrorDetailJson(parsed, toolName);

  return (
    <ToolProgress>
      {/* ToolProgressHeader is inline-flex, so its width is content-driven and
          an unbreakable token — a base64 blob or minified payload echoed in a
          thrown error — would push the row past the chat column and scroll the
          whole page sideways. min-w-0 + break-all lets it wrap inside the
          column instead. Every other tool row gets away without this because a
          progressLabel is short prose; only errors carry arbitrary strings. */}
      <ToolProgressHeader icon={ErrorDot} className="items-start text-left">
        <span className="min-w-0 break-all">
          <span className="font-medium text-foreground">{toolName}</span>
          <span> — {parsed.title}</span>
          {parsed.detail && <span>: {parsed.detail}</span>}
        </span>
      </ToolProgressHeader>
      <ToolProgressContent>
        <JsonBlock value={detailJson} />
      </ToolProgressContent>
    </ToolProgress>
  );
});
