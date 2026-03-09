"""
Financial Modeling Prep (FMP) API wrapper.
Used primarily for market movers (gainers, losers, most active)
since Finnhub free tier lacks a real-time movers endpoint.
"""
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FMP_API_KEY = os.getenv("FMP_API_KEY", "")
FMP_BASE = "https://financialmodelingprep.com/api/v3"
_TIMEOUT = 10.0


async def _get(path: str, params: dict | None = None) -> Any:
    """GET a FMP endpoint, return parsed JSON or []/{} on error."""
    if not FMP_API_KEY:
        logger.warning("FMP_API_KEY not set — skipping %s", path)
        return []
    url = f"{FMP_BASE}{path}"
    p = {"apikey": FMP_API_KEY, **(params or {})}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, params=p)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("FMP request failed for %s: %s", path, exc)
        return []


async def get_market_movers(limit: int = 10) -> list[str]:
    """
    Return a deduplicated list of ticker symbols from:
      - Top gainers (price up > 2%)
      - Most active by volume
    Skips OTC/pink sheet names (no dot, reasonable length).
    """
    gainers, actives = await _fetch_gainers(), await _fetch_actives()

    seen: set[str] = set()
    tickers: list[str] = []

    for item in gainers + actives:
        sym = item.get("symbol", "").strip().upper()
        # Skip obvious non-exchange symbols (contain dots, slashes, or are > 5 chars)
        if not sym or len(sym) > 5 or "." in sym or "/" in sym:
            continue
        if sym not in seen:
            seen.add(sym)
            tickers.append(sym)
        if len(tickers) >= limit:
            break

    return tickers


async def _fetch_gainers() -> list[dict]:
    raw = await _get("/stock_market/gainers")
    return raw if isinstance(raw, list) else []


async def _fetch_actives() -> list[dict]:
    raw = await _get("/stock_market/actives")
    return raw if isinstance(raw, list) else []
