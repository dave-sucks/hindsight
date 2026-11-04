/**
 * Analyst coverage for a ticker: the standing Bullish/Neutral/Bearish ratings
 * snapshot (Finnhub), and the Wall Street price-target range and next-quarter
 * EPS consensus from the newest StreetConsensus row (Nasdaq's feed, stored
 * daily). Powers the AnalystConsensusWidget.
 *
 * Extracted from app/api/theses/[id]/analyst-coverage/route.ts so the
 * thesis-sheet consensus endpoint (/api/theses/:id/analyst-coverage) can fetch it
 * alongside the quote/candles instead of the client making a separate call.
 */
import { getRecommendationTrends } from "@/lib/actions/finnhub.actions";
import { newestStreetRows } from "@/lib/market-data/street-consensus-store";

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
  /** The card measures the move to the average from its own live price. */
  priceTargets: {
    low: number | null;
    average: number;
    median: number | null;
    high: number | null;
    numAnalysts: number | null;
    asOf: string;
  } | null;
  /** Next-quarter EPS consensus and its revisions over the last 4 weeks. */
  eps: { nextQuarter: number; up: number | null; down: number | null } | null;
  errors?: string[];
}

export async function getAnalystCoverageData(
  ticker: string,
): Promise<AnalystCoverageData> {
  const T = ticker.toUpperCase();

  const [finnhubTrends, street] = await Promise.all([
    getRecommendationTrends(T).catch(() => null),
    newestStreetRows([T]).then((m) => m.get(T) ?? null).catch(() => null),
  ]);

  const errors: string[] = [];
  const priceTargets: AnalystCoverageData["priceTargets"] = street
    ? { low: street.targetLow, average: street.targetAvg, median: null, high: street.targetHigh, numAnalysts: street.analysts, asOf: street.asOf }
    : null;
  const eps: AnalystCoverageData["eps"] =
    street?.epsNextQuarter != null
      ? { nextQuarter: street.epsNextQuarter, up: street.epsNextQuarterUp, down: street.epsNextQuarterDown }
      : null;

  // Finnhub returns one record per month (most-recent first). The latest
  // record is the current standing ratings snapshot — strongBuy + buy collapse
  // into Bullish, hold is Neutral, sell + strongSell is Bearish.
  // One source with the agents' row: the Nasdaq split on the StreetConsensus
  // row. Finnhub's monthly trend only when no row exists for the stock.
  const latest = finnhubTrends?.[0];
  const consensus = street && street.buy + street.hold + street.sell > 0
    ? { buy: street.buy, hold: street.hold, sell: street.sell, unknown: 0, total: street.buy + street.hold + street.sell, period: street.asOf }
    : latest
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
    eps,
    errors: errors.length > 0 ? errors : undefined,
  };
}
