/**
 * Reddit client — public JSON API with rate-limit-aware request queue.
 *
 * Features:
 *   - WSB discovery: scan hot/rising/new for trending tickers
 *   - Ticker search: search subreddits for specific ticker mentions
 *   - Sentiment scoring: naive keyword-based bull/bear classification
 *   - Request queue: 2s spacing between requests to avoid 429s
 *   - Retry with backoff on 429/403
 *
 * No API key required — uses reddit.com/.json endpoints.
 */

const USER_AGENT = "hindsight-research/2.0 (paper-trading-bot)";
const REQUEST_SPACING_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

const SUBREDDITS = ["wallstreetbets", "stocks", "options", "investing"] as const;
type Subreddit = (typeof SUBREDDITS)[number];

// ── Rate-limited request queue ──────────────────────────────────────────────

let lastRequestAt = 0;

async function redditFetch(url: string, retries = MAX_RETRIES): Promise<unknown | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Enforce minimum spacing between requests
    const now = Date.now();
    const wait = REQUEST_SPACING_MS - (now - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 429 || res.status === 403) {
        console.warn(`[reddit] ${res.status} from ${url.split("?")[0]} (attempt ${attempt + 1})`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1)));
          continue;
        }
        return null;
      }

      if (!res.ok) {
        console.warn(`[reddit] ${res.status} from ${url.split("?")[0]}`);
        return null;
      }

      return await res.json();
    } catch (err) {
      console.warn(
        `[reddit] fetch error (attempt ${attempt + 1}):`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  subreddit: string;
  created_utc: number;
  permalink: string;
  url: string;
}

export interface RedditSentimentResult {
  available: boolean;
  mention_count: number;
  sentiment: "bullish" | "bearish" | "neutral";
  sentiment_score: number;
  trending: boolean;
  top_posts: {
    title: string;
    score: number;
    num_comments: number;
    subreddit: string;
    url: string;
  }[];
}

export interface TrendingTickerResult {
  ticker: string;
  mentions: number;
  sources: string[];
  sample_titles: string[];
}

// ── Post extraction helpers ─────────────────────────────────────────────────

function extractPosts(data: unknown): RedditPost[] {
  const children =
    (data as { data?: { children?: { data: Record<string, unknown> }[] } })?.data?.children ?? [];
  return children.map((c) => {
    const d = c.data;
    return {
      title: String(d.title ?? ""),
      selftext: String(d.selftext ?? ""),
      score: Number(d.score ?? 0),
      num_comments: Number(d.num_comments ?? 0),
      subreddit: String(d.subreddit ?? ""),
      created_utc: Number(d.created_utc ?? 0),
      permalink: String(d.permalink ?? ""),
      url: `https://reddit.com${d.permalink ?? ""}`,
    };
  });
}

// ── Ticker extraction ───────────────────────────────────────────────────────

const BLACKLIST = new Set([
  // Reddit / WSB slang
  "DD", "OP", "YOLO", "FOMO", "HODL", "MOON", "PUMP", "DUMP",
  "WSB", "LOSS", "GAIN", "MEME", "BEAR", "BULL", "CALL", "PUT",
  "CEO", "CFO", "COO", "CTO", "OG",
  // Finance terms
  "IPO", "ETF", "SEC", "FDA", "FED", "GDP", "CPI", "PPI", "PCE",
  "EPS", "PE", "ATH", "ATL", "DCA", "AH", "PM", "EOD", "EOW",
  "PNL", "ROI", "OTM", "ITM", "ATM", "IV", "DTE", "BUY", "SELL",
  "SPY", "QQQ", "VIX", "IWM", "DIA", // index ETFs (not individual stocks)
  // Common English
  "THE", "AND", "FOR", "NOT", "YOU", "ARE", "BUT", "ALL", "HAS",
  "WAS", "HAD", "CAN", "MAY", "NEW", "OLD", "NOW", "LOL", "WTF",
  "IMO", "IRA", "LLC", "INC", "DIY", "HOW", "WHY", "USA", "USD",
  "CAD", "GBP", "EUR", "JPY", "PDT", "TBH", "NGL", "SMH", "RIP",
  "TLDR", "EDIT", "NEWS", "RATE", "NEXT", "GOOD", "VERY",
  "JUST", "BEEN", "INTO", "THEY", "FROM", "WITH", "LIKE", "WILL",
  "HAVE", "THIS", "THAT", "WHAT", "YOUR", "KNOW", "THAN", "THEN",
  "MUCH", "SOME", "ALSO", "MORE", "MOST", "SUCH", "OVER", "COME",
  "AI", "IT", "IS", "IN", "OF", "ON", "AT", "TO", "UP", "DO",
  "GO", "OR", "IF", "SO", "AS", "BY", "BE", "NO", "AN", "MY",
  "US", "UK", "EU", "UN",
]);

const CASHTAG_RE = /\$([A-Z]{1,5})\b/g;
const PLAIN_TICKER_RE = /(?<![A-Za-z])([A-Z]{2,5})(?![a-zA-Z])/g;

function extractTickers(text: string): string[] {
  const found = new Set<string>();

  // Cashtags ($AAPL) — highest confidence
  for (const match of text.matchAll(CASHTAG_RE)) {
    const t = match[1];
    if (!BLACKLIST.has(t)) found.add(t);
  }

  // Plain uppercase words — lower confidence, only from title
  for (const match of text.matchAll(PLAIN_TICKER_RE)) {
    const t = match[1];
    if (!BLACKLIST.has(t)) found.add(t);
  }

  return [...found];
}

// ── Sentiment scoring ───────────────────────────────────────────────────────

const BULLISH_WORDS = [
  "buy", "calls", "bull", "moon", "long", "breakout", "squeeze",
  "beat", "upgrade", "strong", "green", "rocket", "hold", "bullish",
  "rally", "rip", "tendies", "diamond", "hands", "gamma",
];

const BEARISH_WORDS = [
  "sell", "puts", "bear", "short", "dump", "crash", "miss",
  "downgrade", "weak", "red", "dead", "falling", "bearish",
  "drill", "tank", "bagholder", "rug", "overvalued",
];

function scoreSentiment(texts: string[]): { score: number; label: "bullish" | "bearish" | "neutral" } {
  const combined = texts.join(" ").toLowerCase();
  let bullish = 0;
  let bearish = 0;
  for (const w of BULLISH_WORDS) if (combined.includes(w)) bullish += 1;
  for (const w of BEARISH_WORDS) if (combined.includes(w)) bearish += 1;
  const total = bullish + bearish;
  const score = total === 0 ? 0 : Math.round(((bullish - bearish) / total) * 100) / 100;
  const label = score > 0.2 ? "bullish" : score < -0.2 ? "bearish" : "neutral";
  return { score, label };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Discover trending tickers from WSB and other trading subreddits.
 * Scans hot + rising posts, extracts ticker mentions, ranks by frequency.
 */
export async function discoverTrendingTickers(
  subreddits: Subreddit[] = [...SUBREDDITS],
  limit = 50,
): Promise<TrendingTickerResult[]> {
  const mentionMap = new Map<string, { count: number; subs: Set<string>; titles: string[] }>();

  // Fetch hot + rising from WSB (primary), hot from others
  const fetches: Promise<RedditPost[]>[] = [];
  for (const sub of subreddits) {
    fetches.push(
      redditFetch(
        `https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`,
      ).then((d) => (d ? extractPosts(d) : [])),
    );
    // Only fetch rising from WSB to save rate limit budget
    if (sub === "wallstreetbets") {
      fetches.push(
        redditFetch(
          `https://www.reddit.com/r/${sub}/rising.json?limit=25`,
        ).then((d) => (d ? extractPosts(d) : [])),
      );
    }
  }

  const results = await Promise.all(fetches);

  for (const posts of results) {
    for (const post of posts) {
      const text = `${post.title} ${post.selftext.slice(0, 500)}`;
      const tickers = extractTickers(text);
      for (const ticker of tickers) {
        const existing = mentionMap.get(ticker);
        if (existing) {
          existing.count += 1;
          existing.subs.add(post.subreddit);
          if (existing.titles.length < 3) existing.titles.push(post.title);
        } else {
          mentionMap.set(ticker, {
            count: 1,
            subs: new Set([post.subreddit]),
            titles: [post.title],
          });
        }
      }
    }
  }

  return [...mentionMap.entries()]
    .filter(([, v]) => v.count >= 2) // Only tickers mentioned 2+ times
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([ticker, v]) => ({
      ticker,
      mentions: v.count,
      sources: [...v.subs],
      sample_titles: v.titles,
    }));
}

/**
 * Search subreddits for a specific ticker. Returns matching posts.
 */
export async function searchTicker(
  ticker: string,
  subreddits: Subreddit[] = [...SUBREDDITS],
): Promise<RedditPost[]> {
  const allPosts: RedditPost[] = [];
  const tickerUpper = ticker.toUpperCase();

  // Search each subreddit sequentially to respect rate limits
  for (const sub of subreddits) {
    const data = await redditFetch(
      `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(tickerUpper)}&sort=new&t=week&limit=10&restrict_sr=on`,
    );
    if (data) {
      const posts = extractPosts(data);
      // Only keep posts that actually mention the ticker
      const tickerRe = new RegExp(`\\b\\$?${tickerUpper}\\b`, "i");
      for (const post of posts) {
        if (tickerRe.test(post.title) || tickerRe.test(post.selftext.slice(0, 1000))) {
          allPosts.push(post);
        }
      }
    }
  }

  // Deduplicate by permalink
  const seen = new Set<string>();
  const unique = allPosts.filter((p) => {
    if (seen.has(p.permalink)) return false;
    seen.add(p.permalink);
    return true;
  });

  return unique.sort((a, b) => b.score - a.score);
}

/**
 * Get Reddit sentiment for a specific ticker.
 * Searches all trading subreddits, scores sentiment, returns structured result.
 */
export async function getRedditSentiment(ticker: string): Promise<RedditSentimentResult> {
  const posts = await searchTicker(ticker);

  if (posts.length === 0) {
    return {
      available: false,
      mention_count: 0,
      sentiment: "neutral",
      sentiment_score: 0,
      trending: false,
      top_posts: [],
    };
  }

  const { score, label } = scoreSentiment(posts.map((p) => p.title));

  return {
    available: true,
    mention_count: posts.length,
    sentiment: label,
    sentiment_score: score,
    trending: posts.length >= 5,
    top_posts: posts.slice(0, 5).map((p) => ({
      title: p.title,
      score: p.score,
      num_comments: p.num_comments,
      subreddit: p.subreddit,
      url: p.url,
    })),
  };
}

/**
 * Search Reddit for a topic/query (not just tickers).
 * Used by analyst builder/editor chats for broader searches.
 */
export async function searchReddit(
  query: string,
  subreddits: Subreddit[] = [...SUBREDDITS],
  limitPerSub = 3,
): Promise<{ title: string; score: number; subreddit: string; url: string }[]> {
  const allResults: { title: string; score: number; subreddit: string; url: string }[] = [];

  for (const sub of subreddits) {
    const data = await redditFetch(
      `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=week&limit=${limitPerSub}&restrict_sr=on`,
    );
    if (data) {
      const posts = extractPosts(data);
      for (const post of posts) {
        allResults.push({
          title: post.title,
          score: post.score,
          subreddit: post.subreddit,
          url: post.url,
        });
      }
    }
  }

  return allResults.sort((a, b) => b.score - a.score).slice(0, 10);
}
