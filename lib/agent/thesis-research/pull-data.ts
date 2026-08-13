/**
 * pull-data.ts — Phase-1 structured data pulls for a thesis write.
 *
 * Extracted from lib/agent/tools/write-thesis-research.ts (THESIS_WRITER_V2)
 * so the V2 writer pipeline can run the pulls as its own deterministic
 * phase (an Inngest step) instead of inside a model-invoked meta-tool.
 * Parallel-pulls 7 sources (Finnhub / FMP / SEC EDGAR) with partial
 * tolerance and formats them into the markdown ground-truth data block.
 */

import type { ToolContext } from "@/lib/agent/tool-context";
import {
  formatDataBlock,
  type DataBlockInputs,
} from "@/lib/agent/thesis-research/format-data-block";
// Import each data tool's factory directly so we don't pull
// createResearchTools (which would create a circular import via the
// barrel). At call time we instantiate each with the caller's ctx.
import { getStockData } from "@/lib/agent/tools/get-stock-data";
import { getFinancialsDeep } from "@/lib/agent/tools/get-financials-deep";
import { getAnalystCoverage } from "@/lib/agent/tools/get-analyst-coverage";
import { getInsiderActivity } from "@/lib/agent/tools/get-insider-activity";
import { getEarningsHistory } from "@/lib/agent/tools/get-earnings-history";
import { getPeersWithMetrics } from "@/lib/agent/tools/get-peers-with-metrics";
import { getSecFilings } from "@/lib/agent/tools/get-sec-filings";

// Match the loose tool-runtime shape the bake-off route uses. The AI SDK's
// strict tool-runtime opts are over-specified for our internal sub-call.
type RunnableTool = {
  execute: (
    args: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;
};

const SUB_TOOL_OPTS = {
  toolCallId: "thesis-research-pull",
  messages: [] as never[],
};

interface ToolEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function unwrap<T>(result: unknown): T | null {
  const env = result as ToolEnvelope<T>;
  if (!env || typeof env !== "object" || env.ok === false) return null;
  return (env.data ?? null) as T | null;
}

interface StockDataShape {
  quote?: {
    price: number;
    change: number;
    changePct: number;
    high: number;
    low: number;
    open: number;
    prevClose: number;
  } | null;
  company?: {
    name: string;
    sector: string;
    marketCap: number | null;
    exchange: string;
    country: string;
  } | null;
  financials?: {
    peRatio: number | null;
    pbRatio: number | null;
    high52w: number | null;
    low52w: number | null;
    avgVolume10d: number | null;
    beta: number | null;
  } | null;
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
  priceTargets?: {
    consensus?: number;
    high?: number;
    low?: number;
    median?: number;
    numAnalysts?: number;
  } | null;
}

export interface ThesisPullResult {
  /** Markdown ground-truth block the research model is grounded on. */
  rawDataBlock: string;
  /** Source keys whose pull rejected outright (partial tolerance). */
  pullErrors: string[];
  /** Live quote price, when the stock pull succeeded — used by decision validation. */
  currentPrice: number | null;
  /** Company name / exchange passthrough for record_thesis card data. */
  companyName: string | null;
  exchange: string | null;
  pulledAt: string;
}

/**
 * Run the 7 parallel structured pulls and format the data block.
 * Never throws — a total failure returns an (honest) empty-ish block
 * with every source listed in pullErrors.
 */
export async function pullThesisData(
  ticker: string,
  ctx: ToolContext,
): Promise<ThesisPullResult> {
  const T = ticker.toUpperCase();
  const pulledAt = new Date();

  const stockTool = getStockData(ctx) as unknown as RunnableTool;
  const financialsTool = getFinancialsDeep(ctx) as unknown as RunnableTool;
  const analystCovTool = getAnalystCoverage(ctx) as unknown as RunnableTool;
  const insiderTool = getInsiderActivity(ctx) as unknown as RunnableTool;
  const earningsHistTool = getEarningsHistory(ctx) as unknown as RunnableTool;
  const peersTool = getPeersWithMetrics(ctx) as unknown as RunnableTool;
  const filingsTool = getSecFilings(ctx) as unknown as RunnableTool;

  const [
    stockRes,
    financialsRes,
    analystCovRes,
    insiderRes,
    earningsHistRes,
    peersRes,
    filingsRes,
  ] = await Promise.allSettled([
    stockTool.execute({ ticker: T, include_technicals: true }, SUB_TOOL_OPTS),
    financialsTool.execute({ ticker: T }, SUB_TOOL_OPTS),
    analystCovTool.execute({ ticker: T, window_days: 90 }, SUB_TOOL_OPTS),
    insiderTool.execute({ ticker: T, window_days: 90 }, SUB_TOOL_OPTS),
    earningsHistTool.execute({ ticker: T, quarters: 8 }, SUB_TOOL_OPTS),
    // peer_count 3 — see the 2026-05-18 data-block trim note in git history.
    peersTool.execute({ ticker: T, peer_count: 3 }, SUB_TOOL_OPTS),
    filingsTool.execute({ symbol: T }, SUB_TOOL_OPTS),
  ]);

  const stockData =
    stockRes.status === "fulfilled" ? unwrap<StockDataShape>(stockRes.value) : null;
  const financials =
    financialsRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["financials"]>(financialsRes.value)
      : null;
  const analystCoverage =
    analystCovRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["analystCoverage"]>(analystCovRes.value)
      : null;
  const insider =
    insiderRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["insider"]>(insiderRes.value)
      : null;
  const earningsHistory =
    earningsHistRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["earningsHistory"]>(earningsHistRes.value)
      : null;
  const peers =
    peersRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["peers"]>(peersRes.value)
      : null;
  const filings =
    filingsRes.status === "fulfilled"
      ? unwrap<DataBlockInputs["filings"]>(filingsRes.value)
      : null;

  // Map get_stock_data's snapshot shape into the formatter's StockDataInput.
  const sd = stockData;
  const stockBlockInput: DataBlockInputs["stockData"] = {
    ticker: T,
    companyName: sd?.company?.name ?? null,
    exchange: sd?.company?.exchange ?? null,
    sector: sd?.company?.sector ?? null,
    industry: null,
    description: null,
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

  const rawDataBlock = formatDataBlock({
    ticker: T,
    pulledAt,
    stockData: stockBlockInput,
    financials,
    analystCoverage,
    insider,
    earningsHistory,
    peers,
    filings,
  });

  const pullErrors: string[] = [];
  if (stockRes.status === "rejected" || stockData == null) pullErrors.push("stock_data");
  if (financialsRes.status === "rejected") pullErrors.push("financials");
  if (analystCovRes.status === "rejected") pullErrors.push("analyst_coverage");
  if (insiderRes.status === "rejected") pullErrors.push("insider");
  if (earningsHistRes.status === "rejected") pullErrors.push("earnings_history");
  if (peersRes.status === "rejected") pullErrors.push("peers");
  if (filingsRes.status === "rejected") pullErrors.push("filings");

  return {
    rawDataBlock,
    pullErrors,
    currentPrice: sd?.quote?.price ?? sd?.technicals?.currentPrice ?? null,
    companyName: sd?.company?.name ?? null,
    exchange: sd?.company?.exchange ?? null,
    pulledAt: pulledAt.toISOString(),
  };
}
