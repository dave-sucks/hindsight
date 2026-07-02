/**
 * Analyst coverage for a ticker — a standing Bullish/Neutral/Bearish ratings
 * snapshot (Finnhub) + the Low/Avg/Median/High consensus price-target range
 * (FMP). Powers the AnalystConsensusWidget on the thesis sheet.
 *
 * Extracted from app/api/theses/[id]/analyst-coverage/route.ts so the
 * consolidated thesis-sheet endpoint (/triggers?full=1) can fetch it inline
 * alongside the quote/candles instead of the client making a separate call.
 */
import { getRecommendationTrends } from "@/lib/actions/finnhub.actions";

const FMP_KEY = process.env.FMP_API_KEY!;

interface FmpResult<T> {
  data: T | null;
  error?: string;
}

async function fmp<T>(path: string): Promise<FmpResult<T>> {
  const url = `https://financialmodelingprep.com${path}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok)
      return { data: null, error: `FMP ${res.status} on ${path.split("?")[0]}` };
    const data = (await res.json()) as T;
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      "Error Message" in (data as object)
    ) {
      return {
        data: null,
        error: `FMP: ${(data as Record<string, string>)["Error Message"]}`,
      };
    }
    return { data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "fmp error" };
  }
}

interface PriceTargetConsensus {
  symbol?: string;
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}

interface PriceTargetSummary {
  symbol?: string;
  publishers?: number;
  numberOfAnalysts?: number;
}

export interface AnalystCoverageData {
  ticker: string;
  consensus: {
    buy: number;
    hold: number;
    sell: number;
    unknown: number;
    total: number;
    period: string | null;
  } | null;
  priceTargets: {
    low: number | null;
    average: number;
    median: number | null;
    high: number | null;
    numAnalysts: number | null;
  } | null;
  errors?: string[];
}

export async function getAnalystCoverageData(
  ticker: string,
): Promise<AnalystCoverageData> {
  const T = ticker.toUpperCase();

  const [consensusRes, summaryRes, finnhubTrends] = await Promise.all([
    fmp<PriceTargetConsensus[]>(`/stable/price-target-consensus?symbol=${T}`),
    fmp<PriceTargetSummary[]>(`/stable/price-target-summary?symbol=${T}`),
    getRecommendationTrends(T).catch(() => null),
  ]);

  const errors: string[] = [];
  if (consensusRes.error)
    errors.push(`price-target-consensus: ${consensusRes.error}`);
  if (summaryRes.error) errors.push(`price-target-summary: ${summaryRes.error}`);

  const consensusRow = consensusRes.data?.[0];
  const summaryRow = summaryRes.data?.[0];

  const priceTargets =
    consensusRow && consensusRow.targetConsensus != null
      ? {
          low: consensusRow.targetLow ?? null,
          average: consensusRow.targetConsensus,
          median: consensusRow.targetMedian ?? null,
          high: consensusRow.targetHigh ?? null,
          numAnalysts:
            summaryRow?.numberOfAnalysts ?? summaryRow?.publishers ?? null,
        }
      : null;

  // Finnhub returns one record per month (most-recent first). The latest
  // record is the current standing ratings snapshot — strongBuy + buy collapse
  // into Bullish, hold is Neutral, sell + strongSell is Bearish.
  const latest = finnhubTrends?.[0];
  const consensus = latest
    ? (() => {
        const bull = (latest.strongBuy ?? 0) + (latest.buy ?? 0);
        const neutral = latest.hold ?? 0;
        const bear = (latest.sell ?? 0) + (latest.strongSell ?? 0);
        const total = bull + neutral + bear;
        return total > 0
          ? { buy: bull, hold: neutral, sell: bear, unknown: 0, total, period: latest.period ?? null }
          : null;
      })()
    : null;
  if (finnhubTrends == null) errors.push("finnhub /stock/recommendation: no data");

  return {
    ticker: T,
    consensus,
    priceTargets,
    errors: errors.length > 0 ? errors : undefined,
  };
}
