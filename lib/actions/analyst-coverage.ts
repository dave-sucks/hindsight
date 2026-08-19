/**
 * Analyst coverage for a ticker — a standing Bullish/Neutral/Bearish ratings
 * snapshot (Finnhub) + the Low/Avg/Median/High consensus price-target range
 * (FMP). Powers the AnalystConsensusWidget on the thesis sheet.
 *
 * Extracted from app/api/theses/[id]/analyst-coverage/route.ts so the
 * thesis-sheet consensus endpoint (/api/theses/:id/analyst-coverage) can fetch it
 * alongside the quote/candles instead of the client making a separate call.
 */
import { getRecommendationTrends } from "@/lib/actions/finnhub.actions";
import { fmp } from "@/lib/market-data/fmp";

interface PriceTargetConsensus {
  symbol?: string;
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}

/**
 * FMP /stable/price-target-summary.
 *
 * NOTE: there is no `numberOfAnalysts` field and never was in the /stable
 * shape — code here used to read `numberOfAnalysts ?? publishers`, and
 * `publishers` is a JSON-encoded STRING of news outlets ("[\"TheFly\",
 * \"Benzinga\",...]"), not a count. That string was being handed to the agent
 * as `numAnalysts` (DAV-191). The real counts are the *Count fields.
 */
interface PriceTargetSummary {
  symbol?: string;
  lastMonthCount?: number;
  lastQuarterCount?: number;
  lastYearCount?: number;
  allTimeCount?: number;
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
    fmp<PriceTargetConsensus[]>(`/stable/price-target-consensus?symbol=${T}`, {
      expectNonEmpty: true,
      timeoutMs: 8_000,
    }),
    fmp<PriceTargetSummary[]>(`/stable/price-target-summary?symbol=${T}`, {
      expectNonEmpty: true,
      timeoutMs: 8_000,
    }),
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
          // Targets published in the last quarter — the count that actually
          // stands behind the current consensus. Falls back to the 1y count
          // for thinly-covered names.
          numAnalysts:
            summaryRow?.lastQuarterCount ||
            summaryRow?.lastYearCount ||
            null,
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
