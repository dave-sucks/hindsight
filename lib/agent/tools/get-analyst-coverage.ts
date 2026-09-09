/**
 * get_analyst_coverage — consensus rating (Finnhub) + price-target range (FMP).
 *
 * Backs the thesis 'Analyst Consensus' section: how the street is positioned
 * and where the consensus target sits versus the live price.
 *
 * 2026-08-19 (DAV-191) — the firm-by-firm rating-action timeline is GONE, and
 * it was never actually working. It was built on FMP `/stable/grades-historical`
 * + `/stable/upgrades-downgrades`, both of which return 404 `[]` on our plan,
 * and the tool derived its `consensus` block *from that same empty timeline* —
 * so every call in production returned `consensus: null` + `recentActions: []`
 * while reporting success. No vendor we pay for serves the named-firm/named-
 * analyst table (Finnhub `/stock/upgrade-downgrade` is 403 too), so rather than
 * fake it, consensus now comes from Finnhub `/stock/recommendation`, which is
 * healthy and gives the real buy/hold/sell distribution.
 *
 * Price targets stay on FMP — `/stable/price-target-consensus` and
 * `/stable/price-target-summary` were both verified 200 with live data.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";

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

interface QuoteRow {
  symbol?: string;
  price?: number;
}

/** Finnhub /stock/recommendation row — one per month, newest first. */
interface RecommendationRow {
  symbol?: string;
  period?: string;
  strongBuy?: number;
  buy?: number;
  hold?: number;
  sell?: number;
  strongSell?: number;
}

export const getAnalystCoverage = defineTool({
  description:
    "Get analyst coverage for a stock — the consensus BUY/HOLD/SELL distribution across " +
    "covering analysts. The price-target range is not available on the current data plan " +
    "and is reported as absent. Backs the thesis 'Analyst Consensus' section.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s analyst coverage`,

  execute: async ({ ticker }) => {
    const T = ticker.toUpperCase();

    // Price-target range: FMP's endpoints were removed 2026-09-08 — the tier
    // we hold refused 26 of 28 book names — and Finnhub gates
    // /stock/price-target on a higher plan. So the range is reported as
    // absent rather than silently empty; consensus rating still comes from
    // Finnhub recommendation trends.
    const recsRes = await finnhub(`/stock/recommendation?symbol=${T}`, 2);

    const errors: string[] = [];
    if (recsRes.error) errors.push(`recommendation: ${recsRes.error}`);

    const currentPrice = null as number | null;
    const priceTargets = null as {
      low: number | null;
      average: number | null;
      median: number | null;
      high: number | null;
      currentPrice: number | null;
      impliedUpsidePct: number | null;
      numAnalysts: number | null;
    } | null;

    // Consensus from Finnhub's most-recent monthly recommendation snapshot.
    const recRows = Array.isArray(recsRes.data)
      ? (recsRes.data as RecommendationRow[])
      : [];
    const latestRec = recRows
      .slice()
      .sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""))[0];

    let consensus: {
      rating: string;
      bullish: number;
      neutral: number;
      bearish: number;
      totalAnalysts: number;
      asOf: string | null;
    } | null = null;

    if (latestRec) {
      const bullish = (latestRec.strongBuy ?? 0) + (latestRec.buy ?? 0);
      const neutral = latestRec.hold ?? 0;
      const bearish = (latestRec.sell ?? 0) + (latestRec.strongSell ?? 0);
      const totalRated = bullish + neutral + bearish;
      if (totalRated > 0) {
        consensus = {
          rating:
            bullish > neutral && bullish > bearish
              ? "BUY"
              : bearish > neutral && bearish > bullish
                ? "SELL"
                : "HOLD",
          bullish,
          neutral,
          bearish,
          totalAnalysts: totalRated,
          asOf: latestRec.period ?? null,
        };
      }
    }

    // Build the items[] preview.
    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [];

    if (consensus) {
      items.push({
        kind: "ticker",
        ticker: T,
        tag: consensus.rating,
        text:
          `${consensus.bullish} Bullish · ${consensus.neutral} Neutral · ${consensus.bearish} Bearish` +
          ` (${consensus.totalAnalysts} analysts${consensus.asOf ? `, as of ${consensus.asOf}` : ""})`,
      });
    } else {
      items.push({
        kind: "ticker",
        ticker: T,
        tag: "no coverage",
        text: "No analyst recommendation data available.",
      });
    }

    if (priceTargets?.average != null) {
      const upText =
        priceTargets.impliedUpsidePct != null
          ? ` (${priceTargets.impliedUpsidePct >= 0 ? "+" : ""}${priceTargets.impliedUpsidePct.toFixed(1)}% vs $${currentPrice?.toFixed(2)})`
          : "";
      items.push({
        kind: "generic",
        text: `Targets — Low $${priceTargets.low?.toFixed(2)} · Avg $${priceTargets.average.toFixed(2)} · High $${priceTargets.high?.toFixed(2)}${upText}`,
      });
    } else {
      items.push({
        kind: "generic",
        text: "Price-target range: not available on the current data plan. Do not cite a consensus target you did not see.",
      });
    }

    if (errors.length > 0) {
      items.push({
        kind: "generic",
        text: `Partial data — ${errors.length} endpoint(s) unavailable: ${errors.join("; ")}`,
      });
    }

    return {
      summary:
        consensus || priceTargets
          ? `$${T} analyst coverage — ${consensus?.rating ?? "n/a"} consensus${priceTargets?.average != null ? `, avg target $${priceTargets.average.toFixed(2)}` : ""}.`
          : `$${T} analyst coverage — no data (${errors.join("; ") || "empty"}).`,
      data: {
        ticker: T,
        consensus,
        priceTargets,
        errors,
        items,
      },
      sources: [
        ...(consensus
          ? [
              {
                provider: "Finnhub",
                title: `${T} Recommendation Trends`,
                url: "https://finnhub.io/docs/api/recommendation-trends",
              },
            ]
          : []),
      ],
    };
  },
});
