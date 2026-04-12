/**
 * ToolResult — canonical shape for all agent tool returns in the new pipeline.
 *
 * Every tool using defineTool() returns one of these. The `ui` field is a
 * discriminator that ToolCallRow reads to dispatch to the correct renderer.
 *
 * Legacy tools (ResearchToolResult envelope) are shimmed to this shape in
 * ToolCallRow via normalizeToolResult().
 */

// ── UI discriminator ─────────────────────────────────────────────────────────

export type ToolUI =
  | "generic"          // fallback: dot + summary text
  | "ticker"           // logo + ticker + summary (research + action tools)
  | "ticker-list"      // multiple ticker rows from data.tickers[] (signals)
  | "morning-brief"    // morning brief: market context + sections + risk flags
  | "source"           // favicon + title + site (artifact reads, web search)
  | "thesis-card"      // ThesisCarousel — first call collects all theses via forward-read
  | "decision-summary" // complete_run status row
  | "run-summary"      // RunSummaryCard — the ONE summary card
  | "config-preview";  // suggest_config (builder/editor only)

// ── Source attribution ───────────────────────────────────────────────────────

export interface ToolSource {
  provider: string;
  title: string;
  url?: string;
  excerpt?: string;
}

// ── Result shape ─────────────────────────────────────────────────────────────

export type ToolResult<T = unknown> =
  | {
      ok: true;
      ui: ToolUI;
      /** Phase groupId — consecutive tools with same groupId collapse in UI */
      groupId?: string;
      summary: string;
      data: T;
      sources: ToolSource[];
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      sources: ToolSource[];
    };

// ── Compatibility shim ───────────────────────────────────────────────────────

/**
 * Convert any tool result shape (legacy ResearchToolResult or new ToolResult)
 * to a normalized ToolResult. Used by ToolCallRow for historical replay.
 */
export function normalizeToolResult(
  toolName: string,
  raw: unknown,
): ToolResult {
  if (raw == null) {
    return { ok: true, ui: "generic", summary: "Complete", data: null, sources: [] };
  }

  // Already a new ToolResult
  if (typeof raw === "object" && "ok" in (raw as object)) {
    return raw as ToolResult;
  }

  const r = raw as Record<string, unknown>;

  // Error shape from old tools (bare errors)
  if (r.error && !r.summary && !r.data) {
    return {
      ok: false,
      error: r.error as string,
      retryable: false,
      sources: [],
    };
  }

  // Legacy ResearchToolResult: { summary, _sources, data, tickers? }
  const summary = (r.summary as string) ?? "Complete";
  const sources = (r._sources as ToolSource[]) ?? [];
  const data = r.data ?? r;
  const ui = inferLegacyUI(toolName);
  const groupId = inferLegacyGroupId(toolName);

  return { ok: true, ui, summary, data, sources, ...(groupId !== undefined ? { groupId } : {}) };
}

function inferLegacyGroupId(toolName: string): string | undefined {
  if (
    toolName === "get_stock_data" ||
    toolName === "get_earnings_data" ||
    toolName === "get_options_flow" ||
    toolName === "get_sec_filings" ||
    toolName === "get_market_context"
  ) return "Researching";
  if (
    toolName === "place_trade" ||
    toolName === "close_position" ||
    toolName === "manage_position" ||
    toolName === "manage_watchlist"
  ) return "Executing";
  return undefined;
}

function inferLegacyUI(toolName: string): ToolUI {
  if (toolName === "record_thesis" || toolName === "show_thesis") return "thesis-card";
  if (toolName === "record_run_summary" || toolName === "summarize_run") return "run-summary";
  if (toolName === "complete_run") return "decision-summary";
  if (toolName === "suggest_config") return "config-preview";
  if (toolName === "read_morning_brief") return "morning-brief";
  if (toolName === "read_signals") return "ticker-list";
  if (toolName === "read_artifact" || toolName === "web_search") return "source";
  return "ticker";
}
