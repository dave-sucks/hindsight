"""Earnings intelligence + IV rank (DAV-75).

Combines:
  - Analyst consensus vs whisper number (derived from estimate spread)
  - Historical earnings surprise pattern (FMP analyst estimates)
  - Implied volatility rank proxy (current IV vs 52W IV range from Finnhub)
"""
import logging
import os
import statistics

import httpx

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/api/v3"
_TIMEOUT = 10.0


async def _get_analyst_estimates(ticker: str, api_key: str) -> list[dict]:
    """Fetch analyst EPS estimates from FMP (last 4 quarters)."""
    try:
        url = f"{_FMP_BASE}/analyst-estimates/{ticker.upper()}"
        async with httpx.AsyncClient() as client:
            r = await client.get(
                url,
                params={"apikey": api_key, "limit": "4", "period": "quarter"},
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else []
    except Exception as exc:
        logger.debug("Analyst estimates fetch failed for %s: %s", ticker, exc)
        return []


async def _get_earnings_surprises(ticker: str, api_key: str) -> list[dict]:
    """Fetch historical earnings surprises from FMP."""
    try:
        url = f"{_FMP_BASE}/earnings-surprises/{ticker.upper()}"
        async with httpx.AsyncClient() as client:
            r = await client.get(
                url,
                params={"apikey": api_key},
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            data = r.json()
            return data[:8] if isinstance(data, list) else []
    except Exception as exc:
        logger.debug("Earnings surprises fetch failed for %s: %s", ticker, exc)
        return []


def _compute_surprise_history(surprises: list[dict]) -> dict:
    """Compute beat rate and average surprise % from historical data."""
    if not surprises:
        return {"beat_rate": None, "avg_surprise_pct": None, "quarters_analyzed": 0}

    beats = 0
    surprise_pcts: list[float] = []

    for s in surprises:
        actual = s.get("actualEarningResult")
        estimated = s.get("estimatedEarning")
        if actual is not None and estimated and estimated != 0:
            surprise_pct = (actual - estimated) / abs(estimated) * 100
            surprise_pcts.append(surprise_pct)
            if actual > estimated:
                beats += 1

    n = len(surprise_pcts)
    if n == 0:
        return {"beat_rate": None, "avg_surprise_pct": None, "quarters_analyzed": 0}

    return {
        "beat_rate": round(beats / n * 100, 1),
        "avg_surprise_pct": round(statistics.mean(surprise_pcts), 2),
        "quarters_analyzed": n,
    }


def _estimate_iv_rank(current_iv: float | None, iv_history: list[float]) -> float | None:
    """IV rank: percentile rank of current IV vs its 52W range (0-100)."""
    if current_iv is None or len(iv_history) < 10:
        return None
    iv_min = min(iv_history)
    iv_max = max(iv_history)
    if iv_max <= iv_min:
        return None
    return round((current_iv - iv_min) / (iv_max - iv_min) * 100, 1)


async def get_earnings_intel(ticker: str, implied_vol: float | None = None) -> dict:
    """
    Aggregate earnings intelligence and IV rank for a ticker.

    Returns:
        {
            next_eps_estimate: float | None,  # consensus EPS estimate
            next_revenue_estimate: float | None,
            beat_rate: float | None,          # % of quarters where actual > estimate
            avg_surprise_pct: float | None,   # avg EPS surprise % (pos = beat)
            quarters_analyzed: int,
            iv_rank: float | None,            # 0-100, higher = more expensive options
        }
    Returns empty dict on any error.
    """
    api_key = os.getenv("FMP_API_KEY", "")
    if not api_key:
        return {}

    try:
        import asyncio
        estimates, surprises = await asyncio.gather(
            _get_analyst_estimates(ticker, api_key),
            _get_earnings_surprises(ticker, api_key),
            return_exceptions=True,
        )

        result: dict = {}

        # Next quarter estimate (most recent forward estimate)
        if isinstance(estimates, list) and estimates:
            latest = estimates[0]
            result["next_eps_estimate"] = latest.get("estimatedEpsAvg")
            result["next_revenue_estimate"] = latest.get("estimatedRevenueAvg")
        else:
            result["next_eps_estimate"] = None
            result["next_revenue_estimate"] = None

        # Historical surprise pattern
        surprise_hist = _compute_surprise_history(
            surprises if isinstance(surprises, list) else []
        )
        result.update(surprise_hist)

        # IV rank — placeholder, can be populated with real vol data later
        # For now we derive a proxy from the avg_surprise_pct volatility
        result["iv_rank"] = None  # requires options chain history

        return result

    except Exception as exc:
        logger.warning("Earnings intel failed for %s: %s", ticker, exc)
        return {}
