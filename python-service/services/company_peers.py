"""Company peers and sector comparison service.

Fetches peer companies from Finnhub and quick comparison data.
NOTE: FMP /quote/ is deprecated — using Finnhub for peer quotes.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)


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

    Uses Finnhub for quotes and financials (FMP /quote/ deprecated).

    Returns {
        peers: [{ticker, name, price, change_pct, pe_ratio, market_cap}],
        sector: str,
    }
    """
    from services.finnhub import FinnhubService

    peers = await get_peers_finnhub(ticker)
    if not peers:
        return {"peers": [], "sector": ""}

    fh = FinnhubService()

    async def _fetch_peer(sym: str) -> dict:
        try:
            quote, profile, financials = await asyncio.gather(
                fh.get_quote(sym),
                fh.get_company_profile(sym),
                fh.get_basic_financials(sym),
                return_exceptions=True,
            )
            q = quote if isinstance(quote, dict) else {}
            p = profile if isinstance(profile, dict) else {}
            f = financials if isinstance(financials, dict) else {}
            return {
                "ticker": sym,
                "name": p.get("name", ""),
                "price": q.get("price"),
                "change_pct": q.get("change_pct"),
                "pe_ratio": f.get("pe_ratio"),
                "market_cap": f.get("market_cap"),
            }
        except Exception:
            return {"ticker": sym}

    results = await asyncio.gather(
        *[_fetch_peer(p) for p in peers[:6]],
        return_exceptions=True,
    )

    peer_data = [r for r in results if isinstance(r, dict)]

    # Get sector from the first peer with a profile
    sector = ""
    try:
        profile = await fh.get_company_profile(ticker)
        sector = profile.get("sector", "")
    except Exception:
        pass

    return {"peers": peer_data, "sector": sector}
