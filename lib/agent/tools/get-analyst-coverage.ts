/**
 * get_analyst_coverage — FMP price targets + rating changes + consensus.
 *
 * Surfaces the firm-by-firm analyst table that backs the thesis
 * 'Analyst Consensus' section: who's BUY/HOLD/SELL, what's the average
 * price target, and what specific rating actions hit in the last ~30 days
 * (firm name + analyst name + target deltas).
 *
 * Falls back gracefully on per-endpoint 403s — some FMP tiers gate
 * /grades-historical and /price-target-consensus. Returns partial data with
 * an errors[] array.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";

const FMP_KEY = process.env.FMP_API_KEY!;

interface FmpResult<T> {
  data: T | null;
  error?: string;
}

async function fmp<T>(path: string): Promise<FmpResult<T>> {
  const base = path.startsWith("/v4/")
    ? `https://financialmodelingprep.com/api${path}`
    : `https://financialmodelingprep.com/api/v3${path}`;
  const url = `${base}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { data: null, error: `FMP ${res.status} on ${path.split("?")[0]}` };
    const data = (await res.json()) as T;
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

interface GradeHistoricalRow {
  symbol: string;
  date: string;
  gradingCompany: string;
  previousGrade?: string;
  newGrade: string;
  action?: string; // "upgrade" / "downgrade" / "hold" / etc.
}

interface UpgradeDowngradeRow {
  symbol: string;
  publishedDate: string;
  newsURL?: string;
  newsTitle?: string;
  newsBaseURL?: string;
  newsPublisher?: string;
  analystName?: string;
  analystCompany?: string;
  newGrade?: string;
  previousGrade?: string;
  gradingCompany?: string;
  action?: string;
  priceTarget?: number;
  adjPriceTarget?: number;
  priceWhenPosted?: number;
}

interface QuoteRow {
  symbol?: string;
  price?: number;
}

function classifyRating(grade?: string | null): "BULL" | "NEUTRAL" | "BEAR" | "UNK" {
  if (!grade) return "UNK";
  const g = grade.toLowerCase();
  if (
    g.includes("buy") ||
    g.includes("outperform") ||
    g.includes("overweight") ||
    g.includes("positive") ||
    g.includes("accumulate") ||
    g.includes("strong")
  )
    return "BULL";
  if (
    g.includes("sell") ||
    g.includes("underperform") ||
    g.includes("underweight") ||
    g.includes("negative") ||
    g.includes("reduce")
  )
    return "BEAR";
  if (g.includes("hold") || g.includes("neutral") || g.includes("equal") || g.includes("sector perform")) {
    return "NEUTRAL";
  }
  return "UNK";
}

export const getAnalystCoverage = defineTool({
  description:
    "Get analyst coverage for a stock — consensus rating + price target distribution + " +
    "recent firm-by-firm rating actions (last ~90 days). Backs the thesis 'Analyst Consensus' " +
    "section. Returns the named-firm + named-analyst table (Morgan Stanley/Andrew Percoco/PT $14 " +
    "kind of detail) that pure LLM-paraphrased 'consensus is Hold' cannot match.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    window_days: z
      .number()
      .int()
      .positive()
      .max(180)
      .optional()
      .describe("How many days of rating actions to include (default 90)."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s analyst coverage`,

  execute: async ({ ticker, window_days }) => {
    const T = ticker.toUpperCase();
    const days = window_days ?? 90;

    const [consensusRes, summaryRes, gradesRes, updnRes, quoteRes] = await Promise.all([
      fmp<PriceTargetConsensus[]>(`/v4/price-target-consensus?symbol=${T}`),
      fmp<PriceTargetSummary[]>(`/v4/price-target-summary?symbol=${T}`),
      fmp<GradeHistoricalRow[]>(`/grades-historical/${T}?limit=40`),
      fmp<UpgradeDowngradeRow[]>(`/v4/upgrades-downgrades?symbol=${T}`),
      fmp<QuoteRow[]>(`/quote/${T}`),
    ]);

    const errors: string[] = [];
    if (consensusRes.error) errors.push(`price-target-consensus: ${consensusRes.error}`);
    if (summaryRes.error) errors.push(`price-target-summary: ${summaryRes.error}`);
    if (gradesRes.error) errors.push(`grades-historical: ${gradesRes.error}`);
    if (updnRes.error) errors.push(`upgrades-downgrades: ${updnRes.error}`);

    const consensusRow = consensusRes.data?.[0];
    const summaryRow = summaryRes.data?.[0];
    const currentPrice = quoteRes.data?.[0]?.price ?? null;

    const priceTargets = consensusRow
      ? {
          low: consensusRow.targetLow ?? null,
          average: consensusRow.targetConsensus ?? null,
          median: consensusRow.targetMedian ?? null,
          high: consensusRow.targetHigh ?? null,
          currentPrice,
          impliedUpsidePct:
            currentPrice && consensusRow.targetConsensus
              ? ((consensusRow.targetConsensus - currentPrice) / currentPrice) * 100
              : null,
          numAnalysts:
            summaryRow?.numberOfAnalysts ?? summaryRow?.publishers ?? null,
        }
      : null;

    // Combine /grades-historical and /upgrades-downgrades into one timeline.
    const cutoff = new Date(Date.now() - days * 86400_000);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    type Action = {
      date: string;
      firm: string;
      analyst: string | null;
      action: string | null;
      ratingFrom: string | null;
      ratingTo: string;
      priceTargetFrom: number | null;
      priceTargetTo: number | null;
      source: "grades" | "upgrades";
    };

    const fromGrades: Action[] = (gradesRes.data ?? [])
      .filter((r) => r.date >= cutoffISO)
      .map((r) => ({
        date: r.date,
        firm: r.gradingCompany ?? "Unknown",
        analyst: null,
        action: r.action ?? null,
        ratingFrom: r.previousGrade ?? null,
        ratingTo: r.newGrade,
        priceTargetFrom: null,
        priceTargetTo: null,
        source: "grades" as const,
      }));

    const fromUpdn: Action[] = (updnRes.data ?? [])
      .filter((r) => (r.publishedDate ?? "").slice(0, 10) >= cutoffISO)
      .map((r) => ({
        date: (r.publishedDate ?? "").slice(0, 10),
        firm: r.gradingCompany ?? r.analystCompany ?? "Unknown",
        analyst: r.analystName ?? null,
        action: r.action ?? null,
        ratingFrom: r.previousGrade ?? null,
        ratingTo: r.newGrade ?? "Unknown",
        priceTargetFrom: null,
        priceTargetTo: r.priceTarget ?? r.adjPriceTarget ?? null,
        source: "upgrades" as const,
      }));

    // De-dupe on (date, firm, ratingTo); prefer the row with priceTarget.
    const byKey = new Map<string, Action>();
    for (const r of [...fromUpdn, ...fromGrades]) {
      const key = `${r.date}|${r.firm.toLowerCase()}|${(r.ratingTo ?? "").toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing || (r.priceTargetTo != null && existing.priceTargetTo == null)) {
        byKey.set(key, r);
      }
    }
    const recentActions = Array.from(byKey.values()).sort((a, b) => b.date.localeCompare(a.date));

    // Build consensus from the most-recent action per firm.
    const latestByFirm = new Map<string, Action>();
    for (const r of recentActions) {
      const key = r.firm.toLowerCase();
      if (!latestByFirm.has(key)) latestByFirm.set(key, r);
    }
    let bullish = 0;
    let neutral = 0;
    let bearish = 0;
    let unk = 0;
    for (const r of latestByFirm.values()) {
      const c = classifyRating(r.ratingTo);
      if (c === "BULL") bullish++;
      else if (c === "BEAR") bearish++;
      else if (c === "NEUTRAL") neutral++;
      else unk++;
    }
    const totalRated = bullish + neutral + bearish + unk;
    const consensus =
      totalRated > 0
        ? {
            rating:
              bullish > neutral && bullish > bearish
                ? "BUY"
                : bearish > neutral && bearish > bullish
                  ? "SELL"
                  : "HOLD",
            bullish,
            neutral,
            bearish,
            unknown: unk,
            totalAnalysts: priceTargets?.numAnalysts ?? totalRated,
          }
        : null;

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
          (consensus.unknown > 0 ? ` · ${consensus.unknown} unclassified` : ""),
      });
    } else {
      items.push({
        kind: "ticker",
        ticker: T,
        tag: "no coverage",
        text: "No analyst rating actions in window.",
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
    }
    // Show the most-recent 3-5 actions inline so you can see the firm-by-firm shape.
    for (const r of recentActions.slice(0, 5)) {
      const ratingText =
        r.ratingFrom && r.ratingFrom !== r.ratingTo
          ? `${r.ratingFrom} → ${r.ratingTo}`
          : r.ratingTo;
      const ptText = r.priceTargetTo != null ? ` · PT $${r.priceTargetTo.toFixed(2)}` : "";
      const analystText = r.analyst ? `${r.firm} (${r.analyst})` : r.firm;
      items.push({
        kind: "generic",
        text: `${r.date} — ${analystText}: ${ratingText}${ptText}`,
      });
    }
    if (recentActions.length > 5) {
      items.push({
        kind: "generic",
        text: `… and ${recentActions.length - 5} more actions in the last ${days}d.`,
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
          ? `$${T} analyst coverage — ${consensus?.rating ?? "n/a"} consensus, ${recentActions.length} action(s) in ${days}d.`
          : `$${T} analyst coverage — no data (${errors.join("; ") || "empty"}).`,
      data: {
        ticker: T,
        consensus,
        priceTargets,
        recentActions,
        windowDays: days,
        errors,
        items,
      },
      sources: [
        {
          provider: "FMP",
          title: `${T} Analyst Coverage`,
          url: `https://financialmodelingprep.com/financial-summary/${T}`,
        },
      ],
    };
  },
});
