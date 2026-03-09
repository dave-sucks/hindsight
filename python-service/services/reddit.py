"""Reddit sentiment scanner (DAV-73).

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
