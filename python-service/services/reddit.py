"""Reddit sentiment scanner and trending ticker discovery (DAV-73 / DAV-78).

Uses the public Reddit JSON API — no auth required.
Scans r/wallstreetbets, r/stocks, r/options, r/investing for recent ticker mentions.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

_SUBREDDITS = ["wallstreetbets", "stocks", "options", "investing"]
_HEADERS = {
    # Reddit requires a non-default User-Agent or it throttles
    "User-Agent": "hindsight-research-bot/1.0 (paper trading)"
}
_TIMEOUT = 8.0

# ─── Ticker extraction (DAV-78) ───────────────────────────────────────────────

# Words that match the ticker regex but are never real tickers
_BLACKLIST: frozenset[str] = frozenset({
    # Reddit / WSB slang
    "DD", "OP", "YOLO", "FOMO", "HODL", "MOON", "PUMP", "DUMP",
    "WSB", "LOSS", "GAIN", "MEME", "BEAR", "BULL", "CALL", "PUT",
    "CEO", "CFO", "COO", "CTO",
    # Finance terms that aren't tickers
    "IPO", "ETF", "SEC", "FDA", "FED", "GDP", "CPI", "PPI", "PCE",
    "EPS", "PE", "ATH", "ATL", "DCA", "AH", "PM", "EOD", "EOW",
    "PNL", "ROI", "OTM", "ITM", "ATM", "IV", "DTE", "BUY", "SELL",
    # Common English 2–5 char words
    "THE", "AND", "FOR", "NOT", "YOU", "ARE", "BUT", "ALL", "HAS",
    "WAS", "HAD", "CAN", "MAY", "NEW", "OLD", "NOW", "LOL", "WTF",
    "IMO", "IRA", "LLC", "INC", "DIY", "HOW", "WHY", "USA", "USD",
    "CAD", "GBP", "EUR", "JPY", "PDT", "TBH", "NGL", "SMH", "RIP",
    "TLDR", "EDIT", "NEWS", "RATE", "NEXT", "GOOD", "VERY",
    "JUST", "BEEN", "INTO", "THEY", "FROM", "WITH", "LIKE", "WILL",
    "HAVE", "THIS", "THAT", "WHAT", "YOUR", "KNOW", "THAN", "THEN",
    "MUCH", "SOME", "ALSO", "MORE", "MOST", "SUCH", "OVER", "COME",
    # 2-char noise
    "AI", "IT", "IS", "IN", "OF", "ON", "AT", "TO", "UP", "DO",
    "GO", "OR", "IF", "SO", "AS", "BY", "BE", "NO", "AN", "MY",
    "US", "UK", "EU", "UN",
})

_CASHTAG_RE = re.compile(r'\$([A-Z]{1,5})\b')
_PLAIN_RE = re.compile(r'(?<![A-Z])([A-Z]{2,5})(?![A-Z])')


def _extract_tickers(text: str) -> list[str]:
    """Extract probable ticker symbols from raw text."""
    upper = text.upper()
    found: list[str] = []
    # Cashtags ($AAPL) have highest confidence — intentional mention
    found.extend(_CASHTAG_RE.findall(upper))
    # Plain uppercase tokens
    found.extend(_PLAIN_RE.findall(upper))
    return [t for t in found if t not in _BLACKLIST]


async def _fetch_hot_posts(
    client: httpx.AsyncClient,
    subreddit: str,
    limit: int,
) -> list[dict]:
    """Fetch hot posts from a subreddit's public JSON feed."""
    url = f"https://www.reddit.com/r/{subreddit}/hot.json"
    try:
        r = await client.get(
            url,
            params={"limit": str(min(limit, 100))},
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        if r.status_code == 429:
            logger.debug("Reddit rate limit hit for r/%s — skipping", subreddit)
            return []
        r.raise_for_status()
        children = r.json().get("data", {}).get("children", [])
        return [c.get("data", {}) for c in children]
    except Exception as exc:
        logger.debug("Reddit r/%s hot posts failed: %s", subreddit, exc)
        return []


async def get_trending_tickers_reddit(
    subreddits: list[str] | None = None,
    limit: int = 50,
) -> list[str]:
    """
    Scan subreddit hot feeds for trending ticker mentions (DAV-78).

    Fetches the top `limit` hot posts from each subreddit, extracts ticker
    symbols from titles and selftext via cashtag + uppercase-word regex,
    counts cross-post mentions, and returns up to 10 tickers ranked by
    mention frequency.

    Handles 429 rate limits and network errors gracefully — returns [] on
    any failure. No API key required (uses public Reddit JSON API).
    """
    subs = subreddits if subreddits is not None else _SUBREDDITS
    mention_counts: dict[str, int] = {}

    try:
        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(
                *[_fetch_hot_posts(client, sub, limit) for sub in subs],
                return_exceptions=True,
            )

        for result in results:
            if not isinstance(result, list):
                continue
            for post in result:
                text = f"{post.get('title', '')} {post.get('selftext', '')}"
                for ticker in _extract_tickers(text):
                    mention_counts[ticker] = mention_counts.get(ticker, 0) + 1

    except Exception as exc:
        logger.warning("Reddit trending discovery failed: %s", exc)
        return []

    ranked = sorted(mention_counts.items(), key=lambda x: x[1], reverse=True)
    tickers = [t for t, _ in ranked[:10]]
    logger.debug("Reddit trending tickers: %s", tickers)
    return tickers


# ─── Sentiment (DAV-73) ───────────────────────────────────────────────────────

def _score_sentiment(text: str) -> float:
    """Naive keyword-based sentiment: returns -1.0 to 1.0."""
    text = text.lower()
    bullish = sum(text.count(w) for w in [
        "buy", "calls", "bull", "moon", "long", "breakout", "squeeze",
        "beat", "upgrade", "strong", "green", "rocket", "hold",
    ])
    bearish = sum(text.count(w) for w in [
        "sell", "puts", "bear", "short", "dump", "crash", "miss",
        "downgrade", "weak", "red", "dead", "falling",
    ])
    total = bullish + bearish
    if total == 0:
        return 0.0
    return round((bullish - bearish) / total, 2)


async def _search_subreddit(
    client: httpx.AsyncClient,
    ticker: str,
    subreddit: str,
) -> list[dict]:
    """Search one subreddit for recent ticker mentions."""
    url = f"https://www.reddit.com/r/{subreddit}/search.json"
    params = {
        "q": ticker,
        "sort": "new",
        "restrict_sr": "on",
        "limit": "15",
        "t": "week",
    }
    try:
        r = await client.get(url, params=params, headers=_HEADERS, timeout=_TIMEOUT)
        r.raise_for_status()
        posts = r.json().get("data", {}).get("children", [])
        results = []
        for post in posts:
            d = post.get("data", {})
            title = d.get("title", "")
            # Only include if ticker appears in title (avoid false positives)
            if re.search(rf"\b{re.escape(ticker)}\b", title, re.IGNORECASE):
                results.append({
                    "title": title,
                    "score": d.get("score", 0),
                    "num_comments": d.get("num_comments", 0),
                    "subreddit": subreddit,
                    "created_utc": d.get("created_utc", 0),
                })
        return results
    except Exception as exc:
        logger.debug("Reddit %s search failed: %s", subreddit, exc)
        return []


async def get_reddit_sentiment(ticker: str) -> dict:
    """
    Aggregate Reddit mentions for a ticker across key subreddits.

    Returns:
        {
            mention_count: int,
            total_score: int,       # sum of upvotes across mentions
            sentiment_score: float, # -1.0 (bearish) to 1.0 (bullish)
            trending: bool,         # True if mention_count >= 5
            top_posts: [str],       # up to 3 headline strings
        }
    Falls back to empty dict on any error.
    """
    try:
        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(
                *[_search_subreddit(client, ticker, sub) for sub in _SUBREDDITS],
                return_exceptions=True,
            )

        all_posts: list[dict] = []
        for r in results:
            if isinstance(r, list):
                all_posts.extend(r)

        if not all_posts:
            return {"mention_count": 0, "total_score": 0, "sentiment_score": 0.0,
                    "trending": False, "top_posts": []}

        # Deduplicate by title
        seen: set[str] = set()
        unique: list[dict] = []
        for p in all_posts:
            if p["title"] not in seen:
                seen.add(p["title"])
                unique.append(p)

        # Sort by score (upvotes)
        unique.sort(key=lambda x: x["score"], reverse=True)

        total_score = sum(p["score"] for p in unique)
        combined_text = " ".join(p["title"] for p in unique)
        sentiment = _score_sentiment(combined_text)
        top_posts = [p["title"] for p in unique[:3]]

        return {
            "mention_count": len(unique),
            "total_score": total_score,
            "sentiment_score": sentiment,
            "trending": len(unique) >= 5,
            "top_posts": top_posts,
        }
    except Exception as exc:
        logger.warning("Reddit sentiment failed for %s: %s", ticker, exc)
        return {}
