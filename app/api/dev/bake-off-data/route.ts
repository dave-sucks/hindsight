/**
 * POST /api/dev/bake-off-data
 *
 * Bake-off surface for THESIS_RESEARCH_V2 Phase 0. Pulls all the structured
 * data the eventual `write_thesis_research` meta-tool would pull, formats
 * it into the markdown data block, wraps it in the synthesis prompt, and
 * returns both so you can paste them into Perplexity / Claude / ChatGPT /
 * Gemini chat UIs and score the outputs.
 *
 * Auth-gated to a logged-in Supabase user — no abuse surface.
 *
 * Body:
 *   { ticker: string, analystContext?: string, mode?: "mint" | "refresh",
 *     existingThesisSummary?: string }
 * Returns:
 *   { dataBlock: string, fullPrompt: string, pulledAt: string,
 *     toolErrors: Record<toolName, string | null> }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createResearchTools } from "@/lib/agent/tools";
import {
  formatDataBlock,
  type DataBlockInputs,
} from "@/lib/agent/thesis-research/format-data-block";
import { buildSynthesisPrompt } from "@/lib/agent/thesis-research/build-synthesis-prompt";

// Loosen typing on the AI SDK tool object — its execute signature is fully
// typed for the AI SDK consumer but we're calling it from outside the
// streamText/generateText loop. The runtime contract is stable; this cast
// just bypasses the strict opts shape the framework would otherwise enforce.
type RunnableTool = {
  execute: (args: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>;
};

const DEV_TOOL_OPTS = {
  toolCallId: "dev-bake-off",
  messages: [] as never[],
};

interface ToolResultEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function unwrap<T = unknown>(result: unknown): { data: T | null; error: string | null } {
  const envelope = result as ToolResultEnvelope<T>;
  if (!envelope || typeof envelope !== "object") {
    return { data: null, error: "Tool returned non-object result" };
  }
  if (envelope.ok === false) {
    return { data: null, error: envelope.error ?? "Tool failed without message" };
  }
  return { data: (envelope.data ?? null) as T | null, error: null };
}

export async function POST(req: NextRequest) {
  // Auth gate.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    ticker?: string;
    analystContext?: string;
    mode?: "mint" | "refresh";
    existingThesisSummary?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!ticker || !/^[A-Z.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "ticker required (1-8 uppercase letters)" }, { status: 400 });
  }
  const analystContext =
    (body.analystContext ?? "Generalist equity research analyst writing a balanced thesis on this name.").trim();
  const mode: "mint" | "refresh" = body.mode === "refresh" ? "refresh" : "mint";

  // Build tools with a minimal context. accountId/userId are placeholders;
  // these tools don't write to the DB, only fetch.
  const tools = createResearchTools({
    runId: `dev-bake-off-${Date.now()}`,
    userId: user.id,
    accountId: user.id, // single-tenant placeholder
  }) as unknown as Record<string, RunnableTool>;

  const pulledAt = new Date();

  // Fire all data pulls in parallel.
  const [
    stockRes,
    financialsRes,
    analystCovRes,
    insiderRes,
    earningsHistRes,
    peersRes,
    filingsRes,
  ] = await Promise.allSettled([
    tools.get_stock_data.execute({ ticker, include_technicals: true }, DEV_TOOL_OPTS),
    tools.get_financials_deep.execute({ ticker }, DEV_TOOL_OPTS),
    tools.get_analyst_coverage.execute({ ticker, window_days: 90 }, DEV_TOOL_OPTS),
    tools.get_insider_activity.execute({ ticker, window_days: 90 }, DEV_TOOL_OPTS),
    tools.get_earnings_history.execute({ ticker, quarters: 8 }, DEV_TOOL_OPTS),
    tools.get_peers_with_metrics.execute({ ticker, peer_count: 5 }, DEV_TOOL_OPTS),
    tools.get_sec_filings.execute({ symbol: ticker }, DEV_TOOL_OPTS),
  ]);

  const stockUnwrapped =
    stockRes.status === "fulfilled"
      ? unwrap<{
          quote?: { price: number; change: number; changePct: number; high: number; low: number; open: number; prevClose: number } | null;
          company?: { name: string; sector: string; marketCap: number | null; exchange: string; country: string } | null;
          financials?: { peRatio: number | null; pbRatio: number | null; high52w: number | null; low52w: number | null; avgVolume10d: number | null; beta: number | null } | null;
          technicals?: {
            currentPrice: number;
            rsi14: number | null;
            sma20: number | null;
            sma50: number | null;
            priceVsSma20: string | null;
            priceVsSma50: string | null;
            positionIn52wRange: string;
            volumeRatio: string | null;
            trend: string;
          } | null;
          news?: { headline: string; source: string; date: string; url: string }[];
          priceTargets?: { consensus?: number; high?: number; low?: number; median?: number; numAnalysts?: number } | null;
        }>(stockRes.value)
      : { data: null, error: stockRes.reason instanceof Error ? stockRes.reason.message : "rejected" };

  const financialsUnwrapped =
    financialsRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["financials"]>(financialsRes.value)
      : { data: null, error: "rejected" };
  const analystCovUnwrapped =
    analystCovRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["analystCoverage"]>(analystCovRes.value)
      : { data: null, error: "rejected" };
  const insiderUnwrapped =
    insiderRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["insider"]>(insiderRes.value)
      : { data: null, error: "rejected" };
  const earningsHistUnwrapped =
    earningsHistRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["earningsHistory"]>(earningsHistRes.value)
      : { data: null, error: "rejected" };
  const peersUnwrapped =
    peersRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["peers"]>(peersRes.value)
      : { data: null, error: "rejected" };
  const filingsUnwrapped =
    filingsRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["filings"]>(filingsRes.value)
      : { data: null, error: "rejected" };

  // Map get_stock_data's shape to the formatter's StockDataInput shape.
  const sd = stockUnwrapped.data;
  const stockData: DataBlockInputs["stockData"] = {
    ticker,
    companyName: sd?.company?.name ?? null,
    exchange: sd?.company?.exchange ?? null,
    sector: sd?.company?.sector ?? null,
    industry: null, // Finnhub doesn't separately expose industry
    description: null, // Not returned by get_stock_data; would need a separate /stock/profile2 description field
    quote: sd?.quote
      ? {
          current: sd.quote.price ?? null,
          changePercent: sd.quote.changePct ?? null,
          open: sd.quote.open ?? null,
          dayHigh: sd.quote.high ?? null,
          dayLow: sd.quote.low ?? null,
          week52High: sd?.financials?.high52w ?? null,
          week52Low: sd?.financials?.low52w ?? null,
          marketCap: sd?.company?.marketCap ?? null,
          volume: sd?.financials?.avgVolume10d ?? null,
          beta: sd?.financials?.beta ?? null,
          pe: sd?.financials?.peRatio ?? null,
        }
      : undefined,
    technicals: sd?.technicals
      ? {
          rsi14: sd.technicals.rsi14,
          sma20: sd.technicals.sma20,
          sma50: sd.technicals.sma50,
          priceVsSma20: sd.technicals.priceVsSma20,
          priceVsSma50: sd.technicals.priceVsSma50,
          positionIn52wRange: sd.technicals.positionIn52wRange,
          volumeRatio: sd.technicals.volumeRatio,
          trend: sd.technicals.trend,
        }
      : undefined,
    recentNews: sd?.news ?? [],
    analystTargets: sd?.priceTargets ?? null,
  };

  const dataBlock = formatDataBlock({
    ticker,
    pulledAt,
    stockData,
    financials: financialsUnwrapped.data,
    analystCoverage: analystCovUnwrapped.data,
    insider: insiderUnwrapped.data,
    earningsHistory: earningsHistUnwrapped.data,
    peers: peersUnwrapped.data,
    filings: filingsUnwrapped.data,
  });

  const fullPrompt = buildSynthesisPrompt({
    ticker,
    analystContext,
    mode,
    existingThesisSummary: body.existingThesisSummary,
    dataBlock,
  });

  return NextResponse.json({
    ticker,
    pulledAt: pulledAt.toISOString(),
    dataBlock,
    fullPrompt,
    toolErrors: {
      get_stock_data: stockUnwrapped.error,
      get_financials_deep: financialsUnwrapped.error,
      get_analyst_coverage: analystCovUnwrapped.error,
      get_insider_activity: insiderUnwrapped.error,
      get_earnings_history: earningsHistUnwrapped.error,
      get_peers_with_metrics: peersUnwrapped.error,
      get_sec_filings: filingsUnwrapped.error,
    },
  });
}
