/**
 * get_peers_with_metrics — Finnhub peers + parallel snapshot fan-out.
 *
 * Pulls the peer list for a ticker and then fan-outs `get_stock_data`-style
 * fetches against each peer to assemble the side-by-side comparison table
 * (P/E, revenue growth, YTD return, RSI, market cap). Backs the thesis
 * 'Peer Comparison' / relative-strength dimension.
 *
 * Bounded fan-out (default 5 peers) to keep API quota sane. SEC EDGAR isn't
 * involved here — pure Finnhub + FMP per ticker.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub, calcRSI } from "@/lib/agent/research-helpers";
import { getBars } from "@/lib/alpaca";

interface PeerMetrics {
  ticker: string;
  marketCap: number | null;
  peRatio: number | null;
  revenueGrowthYoYPct: number | null;
  ytdReturnPct: number | null;
  rsi14: number | null;
  leaderScore: number; // 0-100 composite
}

async function fetchPeerMetrics(ticker: string): Promise<PeerMetrics> {
  // Candle data via Alpaca (Finnhub `/stock/candle` is paid-only post-2024).
  // See lib/alpaca.ts:getBars — defaults to feed=iex for free-plan compat.
  const todayISO = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgoISO = new Date(Date.now() - 90 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const ytdStartISO = `${new Date().getUTCFullYear()}-01-01`;

  const [profileRes, metricRes, ytdBars, recent90Bars] = await Promise.all([
    finnhub(`/stock/profile2?symbol=${ticker}`, 1),
    finnhub(`/stock/metric?symbol=${ticker}&metric=all`, 1),
    getBars(ticker, { start: ytdStartISO, end: todayISO }).catch(() => []),
    getBars(ticker, { start: ninetyDaysAgoISO, end: todayISO }).catch(() => []),
  ]);

  const profile = profileRes.data as { marketCapitalization?: number } | null;
  const metric = metricRes.data as { metric?: Record<string, number> } | null;
  // Convert Alpaca bar arrays into the {s, c} shape the downstream code uses.
  const ytdCandle: { s: string; c: number[] } | null =
    ytdBars.length > 0 ? { s: "ok", c: ytdBars.map((b) => b.close) } : null;
  const recentCandle: { s: string; c: number[] } | null =
    recent90Bars.length > 0
      ? { s: "ok", c: recent90Bars.map((b) => b.close) }
      : null;

  // Finnhub returns market cap in $M units.
  const marketCap =
    profile?.marketCapitalization != null ? profile.marketCapitalization * 1e6 : null;
  const peRatio = (metric?.metric?.peNormalizedAnnual ?? metric?.metric?.peBasicExclExtraTTM ?? null) as
    | number
    | null;
  const revenueGrowthYoYPct =
    (metric?.metric?.revenueGrowthTTMYoy ??
      metric?.metric?.revenueGrowth5Y ??
      null) as number | null;

  const ytdReturnPct =
    ytdCandle?.s === "ok" && ytdCandle.c?.length && ytdCandle.c.length >= 2
      ? ((ytdCandle.c[ytdCandle.c.length - 1] - ytdCandle.c[0]) / ytdCandle.c[0]) * 100
      : null;

  const rsi14 =
    recentCandle?.s === "ok" && recentCandle.c?.length ? calcRSI(recentCandle.c) : null;

  // Composite leader score — normalized blend of growth + YTD return.
  let leaderScore = 50;
  if (revenueGrowthYoYPct != null) {
    // 30% growth → +25 points; -10% growth → -10 points.
    leaderScore += Math.max(-15, Math.min(25, revenueGrowthYoYPct * 0.83));
  }
  if (ytdReturnPct != null) {
    // 50% YTD → +20; -30% YTD → -15.
    leaderScore += Math.max(-15, Math.min(20, ytdReturnPct * 0.4));
  }
  leaderScore = Math.max(0, Math.min(100, Math.round(leaderScore)));

  return {
    ticker,
    marketCap,
    peRatio,
    revenueGrowthYoYPct,
    ytdReturnPct,
    rsi14,
    leaderScore,
  };
}

export const getPeersWithMetrics = defineTool({
  description:
    "Get the peer set for a stock plus side-by-side metrics: market cap, P/E, revenue growth " +
    "YoY, YTD return, RSI(14), composite leader score. Backs the thesis 'Peer Comparison' / " +
    "relative-strength dimension. Fans out to ~5 peers via Finnhub /stock/peers + per-peer " +
    "snapshot.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    peer_count: z
      .number()
      .int()
      .min(3)
      .max(8)
      .optional()
      .describe("How many peers to compare (default 5)."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s peer comparison`,

  execute: async ({ ticker, peer_count }) => {
    const T = ticker.toUpperCase();
    const N = peer_count ?? 5;

    const peersRes = await finnhub(`/stock/peers?symbol=${T}`, 2);
    const errors: string[] = [];
    if (peersRes.error) errors.push(`peers: ${peersRes.error}`);

    const rawPeers = Array.isArray(peersRes.data) ? (peersRes.data as string[]) : [];
    const peers = rawPeers
      .map((p) => p.toUpperCase())
      .filter((p) => p && p !== T)
      .slice(0, N);

    if (peers.length === 0) {
      // Even if no peers, still pull the target's metrics for a self-baseline row.
      const targetMetrics = await fetchPeerMetrics(T);
      const items: Array<
        | { kind: "generic"; text: string }
        | { kind: "ticker"; ticker: string; tag: string; text: string }
      > = [
        {
          kind: "ticker",
          ticker: T,
          tag: "no peers",
          text: "Finnhub returned no peer list.",
        },
      ];
      return {
        summary: `$${T} peers — none returned by Finnhub.`,
        data: {
          ticker: T,
          peers: [],
          comparison: [targetMetrics],
          rankings: { byGrowth: [T], byYtd: [T], byComposite: [T] },
          targetTickerRank: { growth: 1, ytd: 1, composite: 1 },
          errors,
          items,
        },
        sources: [{ provider: "Finnhub", title: `${T} Peers`, url: "https://finnhub.io/docs/api/company-peers" }],
      };
    }

    // Parallel fetch — target + peers.
    const allTickers = [T, ...peers];
    const comparison = await Promise.all(allTickers.map((t) => fetchPeerMetrics(t)));

    // Rankings (best to worst on each axis).
    const sortByGrowth = [...comparison]
      .sort((a, b) => (b.revenueGrowthYoYPct ?? -999) - (a.revenueGrowthYoYPct ?? -999))
      .map((c) => c.ticker);
    const sortByYtd = [...comparison]
      .sort((a, b) => (b.ytdReturnPct ?? -999) - (a.ytdReturnPct ?? -999))
      .map((c) => c.ticker);
    const sortByComposite = [...comparison]
      .sort((a, b) => b.leaderScore - a.leaderScore)
      .map((c) => c.ticker);

    const targetTickerRank = {
      growth: sortByGrowth.indexOf(T) + 1,
      ytd: sortByYtd.indexOf(T) + 1,
      composite: sortByComposite.indexOf(T) + 1,
    };

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [];
    items.push({
      kind: "ticker",
      ticker: T,
      tag: `rank ${targetTickerRank.composite}/${comparison.length}`,
      text: `Peers: ${peers.join(", ")}`,
    });
    for (const c of comparison) {
      const peText = c.peRatio != null ? `P/E ${c.peRatio.toFixed(1)}` : "P/E —";
      const growthText =
        c.revenueGrowthYoYPct != null
          ? `growth ${c.revenueGrowthYoYPct >= 0 ? "+" : ""}${c.revenueGrowthYoYPct.toFixed(1)}%`
          : "growth —";
      const ytdText =
        c.ytdReturnPct != null
          ? `YTD ${c.ytdReturnPct >= 0 ? "+" : ""}${c.ytdReturnPct.toFixed(1)}%`
          : "YTD —";
      const rsiText = c.rsi14 != null ? `RSI ${c.rsi14}` : "RSI —";
      const mcText =
        c.marketCap != null
          ? c.marketCap >= 1e12
            ? `MC $${(c.marketCap / 1e12).toFixed(2)}T`
            : `MC $${(c.marketCap / 1e9).toFixed(1)}B`
          : "MC —";
      const marker = c.ticker === T ? " ← target" : "";
      items.push({
        kind: "generic",
        text: `${c.ticker} — ${mcText} · ${peText} · ${growthText} · ${ytdText} · ${rsiText} · score ${c.leaderScore}${marker}`,
      });
    }

    return {
      summary: `$${T} peers — ${peers.length} compared, ranks ${targetTickerRank.composite}/${comparison.length} by composite.`,
      data: {
        ticker: T,
        peers,
        comparison,
        rankings: {
          byGrowth: sortByGrowth,
          byYtd: sortByYtd,
          byComposite: sortByComposite,
        },
        targetTickerRank,
        errors,
        items,
      },
      sources: [
        { provider: "Finnhub", title: `${T} Peers`, url: "https://finnhub.io/docs/api/company-peers" },
      ],
    };
  },
});
