/**
 * Theme detection — keyword-based market narrative extraction.
 * NO LLM calls. Uses news headlines, Reddit trending, and sector ETFs.
 */

import { discoverTrendingTickers } from "@/lib/reddit";
import {
  THEME_DEFINITIONS,
  type DetectMarketThemesResult,
  type MarketTheme,
  type ThemeDirection,
  type ToolSource,
} from "@/lib/discovery/types";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

const SECTOR_ETFS = [
  "XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC",
];

const BEARISH_WORDS = ["crash", "decline", "selloff", "warning", "downgrade", "risk", "fear", "plunge"];
const BULLISH_WORDS = ["surge", "rally", "beat", "upgrade", "growth", "record", "breakout", "soar"];

// ── Finnhub fetch helper ──────────────────────────────────────────────────

async function finnhubFetch<T>(path: string): Promise<T | null> {
  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      console.warn(`[themes] Finnhub ${path.split("?")[0]} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[themes] Finnhub ${path.split("?")[0]} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Core detection ────────────────────────────────────────────────────────

export async function detectThemes(lookbackDays = 3): Promise<DetectMarketThemesResult> {
  const sources: ToolSource[] = [];

  // Fetch 3 data sources in parallel
  const [newsArticles, redditTickers, sectorQuotes] = await Promise.all([
    // 1. Finnhub general news
    finnhubFetch<{ headline: string; summary: string; source: string; url: string; datetime: number }[]>(
      "/news?category=general&minId=0"
    ).then((data) => {
      if (!Array.isArray(data)) return [];
      // Filter by lookback window and take last 50
      const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400;
      return data.filter((a) => a.datetime >= cutoff).slice(0, 50);
    }),

    // 2. Reddit trending tickers
    discoverTrendingTickers().catch(() => [] as { ticker: string; mentions: number }[]),

    // 3. Sector ETF quotes
    Promise.all(
      SECTOR_ETFS.map(async (sym) => {
        const q = await finnhubFetch<{ c: number; dp: number }>(`/quote?symbol=${sym}`);
        if (q && typeof q.c === "number" && q.c > 0) {
          return { symbol: sym, price: q.c, change_pct: q.dp ?? 0 };
        }
        return null;
      })
    ).then((results) => results.filter((r): r is NonNullable<typeof r> => r != null)),
  ]);

  // Build source entries
  if (newsArticles.length > 0) {
    sources.push({
      provider: "Finnhub",
      title: "General Market News",
      url: "https://finnhub.io/docs/api/general-news",
      excerpt: `${newsArticles.length} articles analyzed (${lookbackDays}d lookback)`,
    });
  }
  if (redditTickers.length > 0) {
    sources.push({
      provider: "Reddit",
      title: "Trending Tickers (WSB, r/stocks, r/options, r/investing)",
      url: "https://reddit.com/r/wallstreetbets",
      excerpt: `${redditTickers.length} trending tickers found`,
    });
  }
  if (sectorQuotes.length > 0) {
    sources.push({
      provider: "Finnhub",
      title: "Sector ETF Performance",
      url: "https://finnhub.io/docs/api/quote",
      excerpt: `${sectorQuotes.length} sector ETFs`,
    });
  }

  // If all sources failed, return empty
  if (newsArticles.length === 0 && redditTickers.length === 0 && sectorQuotes.length === 0) {
    return {
      themes: [],
      meta: { headlines_analyzed: 0, reddit_tickers_found: 0, lookback_days: lookbackDays },
      _sources: [],
    };
  }

  // Build lookup structures
  const redditTickerSet = new Set(redditTickers.map((t) => t.ticker.toUpperCase()));
  const topSectors = new Set(
    sectorQuotes.filter((s) => s.change_pct > 0.5).map((s) => s.symbol)
  );

  // Combine headlines + summaries for matching
  const headlineTexts = newsArticles.map((a) => a.headline);
  const allTexts = newsArticles.map((a) => `${a.headline} ${a.summary}`);

  // Score each theme
  const scored: (MarketTheme & { rawScore: number })[] = [];

  for (const [id, def] of Object.entries(THEME_DEFINITIONS)) {
    let headlineMatches = 0;
    const matchedHeadlines: string[] = [];
    let bullishCount = 0;
    let bearishCount = 0;

    // 1. Keyword matches in headlines + summaries
    for (let i = 0; i < allTexts.length; i++) {
      const text = allTexts[i].toLowerCase();
      const matched = def.keywords.some((kw) => text.includes(kw.toLowerCase()));
      if (matched) {
        headlineMatches++;
        if (matchedHeadlines.length < 3) {
          matchedHeadlines.push(headlineTexts[i]);
        }
        // Check sentiment direction of matching headlines
        const headline = headlineTexts[i].toLowerCase();
        for (const w of BULLISH_WORDS) {
          if (headline.includes(w)) bullishCount++;
        }
        for (const w of BEARISH_WORDS) {
          if (headline.includes(w)) bearishCount++;
        }
      }
    }

    // 2. Reddit ticker overlap
    const redditOverlap = def.tickers.filter((t) => redditTickerSet.has(t.toUpperCase())).length;

    // 3. Sector bonus
    const sectorBonus = def.sectors.filter((s) => topSectors.has(s)).length;

    // 4. Raw score
    const rawScore = headlineMatches * 2 + redditOverlap * 3 + sectorBonus * 2;
    if (rawScore === 0) continue;

    // 6. Direction
    let direction: ThemeDirection = "NEUTRAL";
    if (bullishCount > bearishCount) direction = "BULLISH";
    else if (bearishCount > bullishCount) direction = "BEARISH";

    // Collect relevant tickers (those seen in Reddit or from definition)
    const relevantTickers = def.tickers
      .filter((t) => redditTickerSet.has(t.toUpperCase()))
      .slice(0, 5);
    // If no Reddit overlap, show top definition tickers
    const displayTickers = relevantTickers.length > 0
      ? relevantTickers
      : def.tickers.slice(0, 4);

    scored.push({
      id,
      label: def.label,
      strength: 0, // normalized below
      direction,
      tickers: displayTickers,
      headline_matches: headlineMatches,
      reddit_overlap: redditOverlap,
      representative_headlines: matchedHeadlines,
      rawScore,
    });
  }

  // 5. Normalize scores to 0-1
  const maxScore = Math.max(...scored.map((t) => t.rawScore), 1);
  for (const theme of scored) {
    theme.strength = Math.round((theme.rawScore / maxScore) * 100) / 100;
  }

  // Sort by strength descending, filter >= 0.1, take 5-8
  const themes: MarketTheme[] = scored
    .filter((t) => t.strength >= 0.1)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 8)
    .map(({ rawScore: _, ...theme }) => theme);

  return {
    themes,
    meta: {
      headlines_analyzed: newsArticles.length,
      reddit_tickers_found: redditTickers.length,
      lookback_days: lookbackDays,
    },
    _sources: sources,
  };
}
