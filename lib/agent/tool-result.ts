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
  | "generic"          // fallback: summary + sources
  | "ticker"           // per-ticker research result
  | "source"           // intelligence read (brief, signals, artifact)
  | "stock-card"       // get_stock_data — CoT row
  | "trade-card"       // place_trade / close_position — CoT row
  | "thesis-card"      // record_thesis — carousel card
  | "portfolio"        // portfolio state / review — CoT row
  | "decision-summary" // record_decision_plan / complete_run — CoT row
  | "run-summary"      // record_run_summary — summary card with ranked picks
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

  return { ok: true, ui, summary, data, sources };
}

function inferLegacyUI(toolName: string): ToolUI {
  if (toolName === "get_stock_data") return "stock-card";
  if (toolName === "place_trade") return "trade-card";
  if (toolName === "record_thesis" || toolName === "show_thesis") return "thesis-card";
  if (toolName === "get_portfolio_state") return "portfolio";
  if (toolName === "record_run_summary" || toolName === "summarize_run") return "run-summary";
  if (toolName === "complete_run" || toolName === "record_decision_plan") return "decision-summary";
  if (toolName === "suggest_config") return "config-preview";
  if (
    toolName === "get_earnings_data" ||
    toolName === "get_options_flow" ||
    toolName === "get_sec_filings"
  ) return "ticker";
  if (
    toolName === "read_morning_brief" ||
    toolName === "read_signals" ||
    toolName === "read_artifact" ||
    toolName === "web_search"
  ) return "source";
  return "generic";
}
