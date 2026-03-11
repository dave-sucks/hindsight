import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages, runContext } = await req.json();

    const systemPrompt = buildSystemPrompt(runContext);

    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages,
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
