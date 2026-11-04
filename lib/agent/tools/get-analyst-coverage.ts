/**
 * get_analyst_coverage — the rating split (Finnhub recommendation trends), the
 * Wall Street price-target range and the EPS consensus with its revisions
 * (Nasdaq's feed, stored daily in StreetConsensus). Backs the thesis
 * 'Analyst Consensus' section.
 *
 * No vendor we hold serves the firm-by-firm rating actions (DAV-191), so the
 * tool gives the split, the range and the consensus, never named firms.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";
import { getLiveQuote } from "@/lib/market-data/live-quote";
import { epsDetail } from "@/lib/market-data/street-consensus";
import { streetFor } from "@/lib/market-data/street-consensus-store";

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
    "Get analyst coverage for a stock: the consensus BUY/HOLD/SELL distribution across " +
    "covering analysts, the Wall Street price-target range (low, average, high) and the " +
    "EPS consensus with its revisions over the last 4 weeks. Backs the thesis 'Analyst Consensus' section.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s analyst coverage`,

  execute: async ({ ticker }, ctx) => {
    const T = ticker.toUpperCase();

    // The stored row, pulled fresh when it is missing or a day old.
    const [recsRes, street, live] = await Promise.all([
      finnhub(`/stock/recommendation?symbol=${T}`, 2),
      streetFor(T).catch(() => null),
      getLiveQuote(T, { caller: "other", creds: ctx.alpacaCreds }),
    ]);

    const errors: string[] = [];
    if (recsRes.error) errors.push(`recommendation: ${recsRes.error}`);

    const currentPrice = live.quote?.c ?? null;
    const priceTargets = street
      ? {
          low: street.targetLow,
          average: street.targetAvg,
          median: null,
          high: street.targetHigh,
          currentPrice,
          impliedUpsidePct: currentPrice ? ((street.targetAvg - currentPrice) / currentPrice) * 100 : null,
          numAnalysts: street.analysts,
          asOf: street.asOf,
        }
      : null;

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

    // One source with the row every agent reads: the Nasdaq split on the
    // stored StreetConsensus row; Finnhub's monthly trend only without one.
    const split = street && street.buy + street.hold + street.sell > 0
      ? { bullish: street.buy, neutral: street.hold, bearish: street.sell, asOf: street.asOf }
      : latestRec
        ? { bullish: (latestRec.strongBuy ?? 0) + (latestRec.buy ?? 0), neutral: latestRec.hold ?? 0, bearish: (latestRec.sell ?? 0) + (latestRec.strongSell ?? 0), asOf: latestRec.period ?? null }
        : null;
    if (split) {
      const { bullish, neutral, bearish } = split;
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
          asOf: split.asOf,
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
        text: `Targets — Low $${priceTargets.low?.toFixed(2)} · Avg $${priceTargets.average.toFixed(2)} · High $${priceTargets.high?.toFixed(2)}${upText} · ${priceTargets.numAnalysts} analysts, as of ${priceTargets.asOf}`,
      });
    } else {
      items.push({
        kind: "generic",
        text: "Price-target range: none on file for this stock. Do not cite a consensus target you did not see.",
      });
    }
    const eps = street ? epsDetail(street) : null;
    if (eps) items.push({ kind: "generic", text: `EPS consensus: ${eps}` });

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
        street,
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
        ...(street
          ? [
              {
                provider: "Nasdaq",
                title: `${T} analyst research`,
                url: `https://www.nasdaq.com/market-activity/stocks/${T.toLowerCase()}/analyst-research`,
              },
            ]
          : []),
      ],
    };
  },
});
