import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@/lib/supabase/server";
import { createTradingTools } from "@/lib/chat/tools/trading-tools";
import { createResearchTools } from "@/lib/chat/tools/research-tools";
import { createPortfolioTools } from "@/lib/chat/tools/portfolio-tools";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { messages, runContext } = await req.json();

    // Convert UIMessage[] (from useChat/DefaultChatTransport) → ModelMessage[] (for streamText)
    const modelMessages = await convertToModelMessages(messages);

    const systemPrompt = buildSystemPrompt(runContext);

    // ── Tools (all bound to authenticated user) ─────────────────────────
    const tools = {
      ...createTradingTools(user.id),
      ...createResearchTools(user.id),
      ...createPortfolioTools(user.id),
    };

    const result = streamText({
      model: openai("gpt-4.1"),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[run-followup] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function buildSystemPrompt(
  runContext: {
    analystName?: string;
    config?: Record<string, unknown>;
    theses?: Array<{
      ticker: string;
      direction: string;
      confidence_score: number;
      reasoning_summary?: string;
      thesis_bullets?: string[];
      risk_flags?: string[];
      entry_price?: number | null;
      target_price?: number | null;
      stop_loss?: number | null;
      signal_types?: string[];
    }>;
    tradesPlaced?: Array<{
      ticker: string;
      direction: string;
      entry: number;
    }>;
  } | undefined
): string {
  const parts: string[] = [
    "You are a helpful trading research assistant for Hindsight, an AI-powered paper trading platform.",
    "You just completed a research run and the user wants to ask follow-up questions about the results.",
    "Be concise, direct, and use specific data from the run context below when answering.",
    "Format numbers properly — use $ for prices, % for percentages, and tabular alignment where helpful.",
    "When referencing theses, mention the ticker, direction, and confidence score.",
    "",
    "## Available Tools",
    "You have access to powerful tools. Use them proactively when relevant:",
    "",
    "### Trading Tools",
    "- **place_trade**: Place a new paper trade (buy or short). Always confirm details with the user first.",
    "- **close_position**: Close an open position. Returns realized P&L.",
    "- **modify_position**: Change stop loss or target price on an open trade.",
    "- **add_to_position**: Add more shares to an existing position.",
    "",
    "### Research Tools",
    "- **research_ticker**: Run full research pipeline on a ticker. Returns a complete thesis.",
    "- **get_thesis**: Look up a previously generated thesis by ticker or ID.",
    "- **compare_tickers**: Compare 2-3 tickers side-by-side with a recommendation.",
    "- **explain_decision**: Explain why a trade was or wasn't placed for a ticker.",
    "",
    "### Portfolio Tools",
    "- **portfolio_status**: Get current portfolio: open positions, P&L, sector breakdown.",
    "- **run_summary**: Get details of a specific or most recent research run.",
    "- **performance_report**: Get accuracy stats, win rate, and performance analysis.",
    "",
    "## Tool Usage Guidelines",
    '- When the user says "buy NVDA" or "go long on AAPL", use place_trade.',
    '- When the user asks "how am I doing", use portfolio_status.',
    '- When the user says "research TSLA" or "what do you think about MSFT", use research_ticker.',
    '- When the user asks "why didn\'t we trade X", use explain_decision.',
    "- Always confirm trade actions (place/close/modify) before executing.",
    "- For research requests, go ahead and call the tool without asking — the user expects action.",
  ];

  if (!runContext) return parts.join("\n");

  if (runContext.analystName) {
    parts.push(`\nAnalyst: ${runContext.analystName}`);
  }

  if (runContext.config) {
    const c = runContext.config;
    const configParts: string[] = [];
    if (c.directionBias) configParts.push(`Direction Bias: ${c.directionBias}`);
    if (c.holdDurations) configParts.push(`Hold Durations: ${Array.isArray(c.holdDurations) ? c.holdDurations.join(", ") : c.holdDurations}`);
    if (c.minConfidence) configParts.push(`Min Confidence: ${c.minConfidence}%`);
    if (c.sectors) configParts.push(`Sectors: ${Array.isArray(c.sectors) ? c.sectors.join(", ") : c.sectors}`);
    if (configParts.length > 0) {
      parts.push(`\nConfig: ${configParts.join(" | ")}`);
    }
  }

  if (runContext.theses && runContext.theses.length > 0) {
    parts.push("\n--- THESES FROM THIS RUN ---");
    for (const t of runContext.theses) {
      parts.push(`\n## ${t.ticker} — ${t.direction} (${t.confidence_score}%)`);
      if (t.reasoning_summary) parts.push(t.reasoning_summary);
      if (t.thesis_bullets && t.thesis_bullets.length > 0) {
        parts.push("Bullish factors:");
        t.thesis_bullets.forEach((b) => parts.push(`  - ${b}`));
      }
      if (t.risk_flags && t.risk_flags.length > 0) {
        parts.push("Risk flags:");
        t.risk_flags.forEach((r) => parts.push(`  - ${r}`));
      }
      if (t.entry_price != null) parts.push(`Entry: $${t.entry_price}`);
      if (t.target_price != null) parts.push(`Target: $${t.target_price}`);
      if (t.stop_loss != null) parts.push(`Stop: $${t.stop_loss}`);
      if (t.signal_types && t.signal_types.length > 0) {
        parts.push(`Signals: ${t.signal_types.join(", ")}`);
      }
    }
  }

  if (runContext.tradesPlaced && runContext.tradesPlaced.length > 0) {
    parts.push("\n--- TRADES PLACED ---");
    for (const t of runContext.tradesPlaced) {
      parts.push(`${t.ticker} ${t.direction} @ $${t.entry}`);
    }
  }

  return parts.join("\n");
}
