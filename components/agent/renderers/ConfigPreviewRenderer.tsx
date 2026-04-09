"use client";

/**
 * ConfigPreviewRenderer — renders suggest_config results.
 * The full SuggestConfigRender from tool-ui-config.tsx handles callbacks.
 * For now, this renderer is a pass-through to keep the ToolCallRow dispatch
 * working. The actual suggest_config UI is still registered via
 * useAssistantToolUI until we fully wire the new system in Step 5.
 */

import type { ToolResult } from "@/lib/agent/tool-result";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

// This renderer intentionally renders nothing — the suggest_config tool
// is still handled by useAssistantToolUI registration during Step 2-4.
// In Step 5 this will render the full AgentConfigCard.
export function ConfigPreviewRenderer(_props: Props) {
  return null;
}
