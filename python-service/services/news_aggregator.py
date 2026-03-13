"""Multi-source news aggregator for comprehensive market research.

Combines multiple free news sources:
- FMP stock news (requires FMP_API_KEY)
- FMP general news
- Finnhub company news
- SEC filings press releases
"""
import asyncio
import logging
import os
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)

_FMP_KEY = os.getenv("FMP_API_KEY", "")
_TIMEOUT = 10.0


async def get_fmp_stock_news(ticker: str, limit: int = 10) -> list[dict]:
    """Fetch stock-specific news from FMP."""
    if not _FMP_KEY:
        return []
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://financialmodelingprep.com/api/v3/stock_news",
                params={"tickers": ticker, "limit": str(limit), "apikey": _FMP_KEY},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                {
                    "headline": item.get("title", ""),
                    "summary": item.get("text", "")[:300],
                    "source": item.get("site", ""),
                    "url": item.get("url", ""),
                    "published_at": item.get("publishedDate", ""),
                    "sentiment": item.get("sentiment", "neutral"),
                    "provider": "FMP",
                }
                for item in (data if isinstance(data, list) else [])
            ]
    except Exception as exc:
        logger.debug("FMP stock news failed for %s: %s", ticker, exc)
        return []


async def get_fmp_general_news(limit: int = 15) -> list[dict]:
    """Fetch general market news from FMP."""
    if not _FMP_KEY:
        return []
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://financialmodelingprep.com/api/v3/fmp/articles",
                params={"page": "0", "size": str(limit), "apikey": _FMP_KEY},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            articles = data.get("content", []) if isinstance(data, dict) else data
            return [
                {
                    "headline": item.get("title", ""),
                    "summary": item.get("content", "")[:300],
                    "source": "FMP",
                    "url": item.get("link", ""),
                    "published_at": item.get("date", ""),
                    "provider": "FMP",
                }
                for item in (articles if isinstance(articles, list) else [])[:limit]
            ]
    except Exception as exc:
        logger.debug("FMP general news failed: %s", exc)
        return []


async def get_fmp_press_releases(ticker: str, limit: int = 5) -> list[dict]:
    """Fetch company press releases from FMP."""
    if not _FMP_KEY:
        return []
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://financialmodelingprep.com/api/v3/press-releases/{ticker}",
                params={"limit": str(limit), "apikey": _FMP_KEY},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                {
                    "headline": item.get("title", ""),
                    "summary": item.get("text", "")[:300],
                    "source": "Company PR",
                    "url": "",
                    "published_at": item.get("date", ""),
                    "provider": "FMP",
                }
                for item in (data if isinstance(data, list) else [])
            ]
    except Exception as exc:
        logger.debug("FMP press releases failed for %s: %s", ticker, exc)
        return []


async def get_fmp_analyst_targets(ticker: str) -> dict:
    """Fetch analyst price targets from FMP.

    Returns {consensus_target, high, low, num_analysts, targets: [...]}.
    """
    if not _FMP_KEY:
        return {}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://financialmodelingprep.com/api/v4/price-target-consensus",
                params={"symbol": ticker, "apikey": _FMP_KEY},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            if not data or not isinstance(data, list) or len(data) == 0:
                return {}
            consensus = data[0]
            return {
                "consensus_target": consensus.get("targetConsensus"),
                "high": consensus.get("targetHigh"),
                "low": consensus.get("targetLow"),
                "median": consensus.get("targetMedian"),
                "num_analysts": consensus.get("numberOfAnalysts"),
            }
    except Exception as exc:
        logger.debug("FMP analyst targets failed for %s: %s", ticker, exc)
        return {}


async def get_comprehensive_news(ticker: str) -> dict:
    """Aggregate news from all sources for a ticker.

    Returns {
        stock_news: [...],
        press_releases: [...],
        analyst_targets: {...},
        total_articles: int,
    }
    """
    stock_news, press_releases, analyst_targets = await asyncio.gather(
        get_fmp_stock_news(ticker, limit=10),
        get_fmp_press_releases(ticker, limit=5),
        get_fmp_analyst_targets(ticker),
    )

    return {
        "stock_news": stock_news,
        "press_releases": press_releases,
        "analyst_targets": analyst_targets,
        "total_articles": len(stock_news) + len(press_releases),
    }
