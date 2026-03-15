"""Reddit sentiment scanner and trending ticker discovery.

Uses the public Reddit JSON API — no auth required.
Scans r/wallstreetbets, r/stocks, r/options, r/investing for ticker mentions.

Rate-limit-aware: 2s spacing between requests, retry with backoff on 429/403.
"""
import asyncio
import logging
import re
import time

import httpx

logger = logging.getLogger(__name__)

_SUBREDDITS = ["wallstreetbets", "stocks", "options", "investing"]
_HEADERS = {
    "User-Agent": "hindsight-research/2.0 (paper-trading-bot)",
    "Accept": "application/json",
}
_TIMEOUT = 10.0
_REQUEST_SPACING = 2.0  # seconds between requests
_MAX_RETRIES = 2

# Track last request time for rate limiting
_last_request_at: float = 0.0


# ─── Rate-limited fetch ──────────────────────────────────────────────────────

async def _reddit_fetch(client: httpx.AsyncClient, url: str, params: dict | None = None) -> dict | None:
    """Fetch from Reddit with rate limiting and retry logic."""
    global _last_request_at

    for attempt in range(_MAX_RETRIES + 1):
        # Enforce minimum spacing
        now = time.monotonic()
        wait = _REQUEST_SPACING - (now - _last_request_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_at = time.monotonic()

        try:
            r = await client.get(url, params=params, headers=_HEADERS, timeout=_TIMEOUT)

            if r.status_code in (429, 403):
                logger.warning("Reddit %d from %s (attempt %d)", r.status_code, url.split("?")[0], attempt + 1)
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(3.0 * (attempt + 1))
                    continue
                return None

            if r.status_code != 200:
                logger.warning("Reddit %d from %s", r.status_code, url.split("?")[0])
                return None

            return r.json()
        except Exception as exc:
            logger.warning("Reddit fetch error (attempt %d): %s", attempt + 1, exc)
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            return None

    return None


# ─── Ticker extraction ───────────────────────────────────────────────────────

_BLACKLIST: frozenset[str] = frozenset({
    # Reddit / WSB slang
    "DD", "OP", "YOLO", "FOMO", "HODL", "MOON", "PUMP", "DUMP",
    "WSB", "LOSS", "GAIN", "MEME", "BEAR", "BULL", "CALL", "PUT",
    "CEO", "CFO", "COO", "CTO", "OG",
    # Finance terms
    "IPO", "ETF", "SEC", "FDA", "FED", "GDP", "CPI", "PPI", "PCE",
    "EPS", "PE", "ATH", "ATL", "DCA", "AH", "PM", "EOD", "EOW",
    "PNL", "ROI", "OTM", "ITM", "ATM", "IV", "DTE", "BUY", "SELL",
    "SPY", "QQQ", "VIX", "IWM", "DIA",  # index ETFs
    # Common English
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
})

_CASHTAG_RE = re.compile(r'\$([A-Z]{1,5})\b')
_PLAIN_RE = re.compile(r'(?<![A-Za-z])([A-Z]{2,5})(?![a-zA-Z])')


def _extract_tickers(text: str) -> list[str]:
    """Extract probable ticker symbols from raw text."""
    upper = text.upper()
    found: set[str] = set()
    found.update(_CASHTAG_RE.findall(upper))
    found.update(_PLAIN_RE.findall(upper))
    return [t for t in found if t not in _BLACKLIST]


# ─── Sentiment scoring ───────────────────────────────────────────────────────

_BULLISH = [
    "buy", "calls", "bull", "moon", "long", "breakout", "squeeze",
    "beat", "upgrade", "strong", "green", "rocket", "hold", "bullish",
    "rally", "rip", "tendies", "diamond", "hands", "gamma",
]

_BEARISH = [
    "sell", "puts", "bear", "short", "dump", "crash", "miss",
    "downgrade", "weak", "red", "dead", "falling", "bearish",
    "drill", "tank", "bagholder", "rug", "overvalued",
]


def _score_sentiment(texts: list[str]) -> tuple[float, str]:
    """Score sentiment from a list of text strings. Returns (score, label)."""
    combined = " ".join(texts).lower()
    bullish = sum(1 for w in _BULLISH if w in combined)
    bearish = sum(1 for w in _BEARISH if w in combined)
    total = bullish + bearish
    if total == 0:
        return 0.0, "neutral"
    score = round((bullish - bearish) / total, 2)
    label = "bullish" if score > 0.2 else "bearish" if score < -0.2 else "neutral"
    return score, label


# ─── Post helpers ─────────────────────────────────────────────────────────────

def _extract_posts(data: dict | None) -> list[dict]:
    """Extract post data from Reddit JSON response."""
    if not data:
        return []
    children = data.get("data", {}).get("children", [])
    return [
        {
            "title": c.get("data", {}).get("title", ""),
            "selftext": c.get("data", {}).get("selftext", ""),
            "score": c.get("data", {}).get("score", 0),
            "num_comments": c.get("data", {}).get("num_comments", 0),
            "subreddit": c.get("data", {}).get("subreddit", ""),
            "created_utc": c.get("data", {}).get("created_utc", 0),
            "permalink": c.get("data", {}).get("permalink", ""),
            "url": f"https://reddit.com{c.get('data', {}).get('permalink', '')}",
        }
        for c in children
    ]


# ─── Public API ──────────────────────────────────────────────────────────────

async def get_trending_tickers_reddit(
    subreddits: list[str] | None = None,
    limit: int = 50,
) -> list[str]:
    """
    Scan subreddit hot + rising feeds for trending ticker mentions.

    Fetches hot posts from each subreddit (+ rising from WSB), extracts
    tickers, counts mentions, returns up to 15 ranked by frequency.
    Requires 2+ mentions to qualify.
    """
    subs = subreddits or _SUBREDDITS
    mention_counts: dict[str, int] = {}

    try:
        async with httpx.AsyncClient() as client:
            all_posts: list[dict] = []

            for sub in subs:
                data = await _reddit_fetch(
                    client,
                    f"https://www.reddit.com/r/{sub}/hot.json",
                    params={"limit": str(min(limit, 100))},
                )
                all_posts.extend(_extract_posts(data))

                # Also fetch rising from WSB for early trend detection
                if sub == "wallstreetbets":
                    data = await _reddit_fetch(
                        client,
                        f"https://www.reddit.com/r/{sub}/rising.json",
                        params={"limit": "25"},
                    )
                    all_posts.extend(_extract_posts(data))

        for post in all_posts:
            text = f"{post['title']} {post['selftext'][:500]}"
            for ticker in _extract_tickers(text):
                mention_counts[ticker] = mention_counts.get(ticker, 0) + 1

    except Exception as exc:
        logger.warning("Reddit trending discovery failed: %s", exc)
        return []

    ranked = sorted(mention_counts.items(), key=lambda x: x[1], reverse=True)
    tickers = [t for t, count in ranked if count >= 2][:15]
    logger.debug("Reddit trending tickers: %s", tickers)
    return tickers


async def get_reddit_sentiment(ticker: str) -> dict:
    """
    Search all trading subreddits for a specific ticker and score sentiment.

    Returns:
        {
            mention_count: int,
            total_score: int,
            sentiment_score: float,  # -1.0 to 1.0
            sentiment: str,          # "bullish" | "bearish" | "neutral"
            trending: bool,
            top_posts: [{title, score, num_comments, subreddit, url}],
        }
    """
    ticker_upper = ticker.upper()
    ticker_re = re.compile(rf"\b\$?{re.escape(ticker_upper)}\b", re.IGNORECASE)

    try:
        all_posts: list[dict] = []

        async with httpx.AsyncClient() as client:
            for sub in _SUBREDDITS:
                data = await _reddit_fetch(
                    client,
                    f"https://www.reddit.com/r/{sub}/search.json",
                    params={
                        "q": ticker_upper,
                        "sort": "new",
                        "restrict_sr": "on",
                        "limit": "10",
                        "t": "week",
                    },
                )
                posts = _extract_posts(data)
                # Only keep posts that actually mention the ticker
                for post in posts:
                    if ticker_re.search(post["title"]) or ticker_re.search(post["selftext"][:1000]):
                        all_posts.append(post)

        if not all_posts:
            return {
                "mention_count": 0,
                "total_score": 0,
                "sentiment_score": 0.0,
                "sentiment": "neutral",
                "trending": False,
                "top_posts": [],
            }

        # Deduplicate by permalink
        seen: set[str] = set()
        unique: list[dict] = []
        for p in all_posts:
            if p["permalink"] not in seen:
                seen.add(p["permalink"])
                unique.append(p)

        unique.sort(key=lambda x: x["score"], reverse=True)

        total_score = sum(p["score"] for p in unique)
        sentiment_score, sentiment_label = _score_sentiment([p["title"] for p in unique])

        return {
            "mention_count": len(unique),
            "total_score": total_score,
            "sentiment_score": sentiment_score,
            "sentiment": sentiment_label,
            "trending": len(unique) >= 5,
            "top_posts": [
                {
                    "title": p["title"],
                    "score": p["score"],
                    "num_comments": p["num_comments"],
                    "subreddit": p["subreddit"],
                    "url": p["url"],
                }
                for p in unique[:5]
            ],
        }
    except Exception as exc:
        logger.warning("Reddit sentiment failed for %s: %s", ticker, exc)
        return {}
