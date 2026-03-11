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


# ── Sector ETF + index quotes (DAV-121: Market Context) ──────────────────

_SECTOR_ETFS = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLE": "Energy",
    "XLV": "Health Care",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLRE": "Real Estate",
    "XLU": "Utilities",
    "XLC": "Communication Services",
}


async def get_quote(symbol: str) -> dict:
    """Fetch a single stock/ETF quote from FMP. Returns {symbol, price, change_pct}."""
    raw = await _get(f"/quote/{symbol}")
    if isinstance(raw, list) and raw:
        item = raw[0]
        return {
            "symbol": symbol,
            "price": item.get("price"),
            "change_pct": item.get("changesPercentage"),
            "change": item.get("change"),
            "day_high": item.get("dayHigh"),
            "day_low": item.get("dayLow"),
            "prev_close": item.get("previousClose"),
        }
    return {"symbol": symbol, "price": None, "change_pct": None}


async def get_sector_etf_performance() -> list[dict]:
    """Fetch daily performance for all 11 SPDR sector ETFs.

    Returns list of {symbol, name, price, change_pct} sorted by change_pct desc.
    """
    import asyncio

    async def _fetch_one(sym: str, name: str) -> dict:
        q = await get_quote(sym)
        return {
            "symbol": sym,
            "name": name,
            "price": q.get("price"),
            "change_pct": q.get("change_pct") or 0.0,
        }

    results = await asyncio.gather(
        *[_fetch_one(sym, name) for sym, name in _SECTOR_ETFS.items()],
        return_exceptions=True,
    )

    sectors = [r for r in results if isinstance(r, dict) and r.get("price") is not None]
    sectors.sort(key=lambda x: x["change_pct"], reverse=True)
    return sectors


async def get_index_quotes() -> dict:
    """Fetch SPY and VIX quotes for market context.

    Returns {spy: {price, change_pct}, vix: {price, change_pct}}.
    """
    import asyncio
    spy, vix = await asyncio.gather(
        get_quote("SPY"),
        get_quote("^VIX"),
        return_exceptions=True,
    )
    # FMP uses VIXY or ^VIX — fallback if ^VIX fails
    if isinstance(vix, Exception) or not vix.get("price"):
        vix = await get_quote("VIXY")
    if isinstance(spy, Exception):
        spy = {"symbol": "SPY", "price": None, "change_pct": None}
    if isinstance(vix, Exception):
        vix = {"symbol": "VIX", "price": None, "change_pct": None}
    return {"spy": spy, "vix": vix}
