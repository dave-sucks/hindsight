"""StockTwits trending ticker discovery (DAV-79).

Calls the free StockTwits public trending endpoint — no API key required.
"""
import logging

import httpx

logger = logging.getLogger(__name__)

_TRENDING_URL = "https://api.stocktwits.com/api/2/trending/symbols.json"
_TIMEOUT = 8.0


async def get_trending_tickers_stocktwits(limit: int = 10) -> list[str]:
    """
    Fetch trending tickers from the StockTwits public trending API (DAV-79).

    Calls https://api.stocktwits.com/api/2/trending/symbols.json and returns
    up to `limit` ticker symbols from the response's `symbols` array.

    No API key required. Handles HTTP errors and timeouts gracefully —
    returns [] on any failure so the scanner is never blocked.
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(_TRENDING_URL, timeout=_TIMEOUT)
            r.raise_for_status()
            data = r.json()

        symbols = data.get("symbols", [])
        tickers = [s["symbol"] for s in symbols if "symbol" in s][:limit]
        logger.debug("StockTwits trending tickers: %s", tickers)
        return tickers

    except Exception as exc:
        logger.warning("StockTwits trending discovery failed: %s", exc)
        return []
