"""Company peers and sector comparison service.

Fetches peer companies from Finnhub and quick comparison data from FMP.
"""
import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

_FMP_KEY = os.getenv("FMP_API_KEY", "")
_TIMEOUT = 10.0


async def get_peers_finnhub(ticker: str) -> list[str]:
    """Fetch peer companies from Finnhub."""
    from services.finnhub import FinnhubService, _call

    try:
        svc = FinnhubService()
        raw = await _call(svc.client.company_peers, ticker)
        if isinstance(raw, list):
            # Filter out the ticker itself and limit to 8
            return [p for p in raw if p.upper() != ticker.upper()][:8]
        return []
    except Exception as exc:
        logger.debug("Finnhub peers failed for %s: %s", ticker, exc)
        return []


async def get_peer_comparison(ticker: str) -> dict:
    """Get peer companies with basic comparison metrics.

    Returns {
        peers: [{ticker, name, price, change_pct, pe_ratio, market_cap}],
        sector: str,
    }
    """
    peers = await get_peers_finnhub(ticker)
    if not peers or not _FMP_KEY:
        return {"peers": [], "sector": ""}

    # Fetch quick quotes for all peers in parallel
    async with httpx.AsyncClient() as client:
        symbols = ",".join(peers[:6])
        try:
            resp = await client.get(
                f"https://financialmodelingprep.com/api/v3/quote/{symbols}",
                params={"apikey": _FMP_KEY},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.debug("FMP peer quotes failed: %s", exc)
            return {"peers": [{"ticker": p} for p in peers[:6]], "sector": ""}

    peer_data = []
    sector = ""
    for item in (data if isinstance(data, list) else []):
        peer_data.append({
            "ticker": item.get("symbol", ""),
            "name": item.get("name", ""),
            "price": item.get("price"),
            "change_pct": item.get("changesPercentage"),
            "pe_ratio": item.get("pe"),
            "market_cap": item.get("marketCap"),
        })
        if not sector:
            sector = item.get("sector", "")

    return {"peers": peer_data, "sector": sector}
