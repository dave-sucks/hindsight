"""Unusual options flow detector (DAV-74).

Uses FMP's option chain endpoint to identify unusual call/put activity.
Flags large-premium OTM contracts and computes put/call ratio.
Falls back gracefully if FMP doesn't return options data.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/api/v3"
_TIMEOUT = 10.0


def _classify_contract(contract: dict, stock_price: float) -> dict | None:
    """Return enriched contract dict or None if not unusual."""
    strike = float(contract.get("strike", 0) or 0)
    volume = int(contract.get("volume", 0) or 0)
    open_interest = int(contract.get("openInterest", 0) or 0)
    implied_vol = float(contract.get("impliedVolatility", 0) or 0)
    last_price = float(contract.get("lastPrice", 0) or 0)
    contract_type = contract.get("type", "").upper()  # "CALL" | "PUT"
    expiration = contract.get("expirationDate", "")

    if volume == 0 or stock_price == 0:
        return None

    # Unusual signal: volume is >5x open interest, or very large premium
    vol_oi_ratio = volume / open_interest if open_interest > 0 else volume
    premium = last_price * volume * 100  # total premium in dollars

    if vol_oi_ratio >= 5 or premium >= 500_000:
        moneyness = "OTM" if (
            (contract_type == "CALL" and strike > stock_price) or
            (contract_type == "PUT" and strike < stock_price)
        ) else "ITM"
        return {
            "type": contract_type,
            "strike": strike,
            "expiration": expiration,
            "volume": volume,
            "open_interest": open_interest,
            "vol_oi_ratio": round(vol_oi_ratio, 1),
            "premium_usd": round(premium),
            "implied_vol": round(implied_vol * 100, 1),
            "moneyness": moneyness,
        }
    return None


async def get_unusual_options(ticker: str) -> dict:
    """
    Fetch options chain from FMP and identify unusual activity.

    Returns:
        {
            put_call_ratio: float,
            unusual_contracts: [dict],    # sorted by premium desc, max 5
            call_volume: int,
            put_volume: int,
            has_unusual: bool,
        }
    Returns empty dict on any error or when FMP returns no data.
    """
    api_key = os.getenv("FMP_API_KEY", "")
    if not api_key:
        return {}

    try:
        url = f"{_FMP_BASE}/options/chain/{ticker.upper()}"
        async with httpx.AsyncClient() as client:
            r = await client.get(
                url,
                params={"apikey": api_key},
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        logger.debug("Options flow fetch failed for %s: %s", ticker, exc)
        return {}

    # FMP returns list of contracts or {"Error Message": ...}
    if not isinstance(data, list) or not data:
        return {}

    # Get current stock price from the first contract for moneyness calc
    stock_price = float(data[0].get("underlyingPrice", 0) or 0)
    if not stock_price:
        return {}

    call_volume = 0
    put_volume = 0
    unusual: list[dict] = []

    for contract in data:
        ctype = contract.get("type", "").upper()
        vol = int(contract.get("volume", 0) or 0)
        if ctype == "CALL":
            call_volume += vol
        elif ctype == "PUT":
            put_volume += vol

        flagged = _classify_contract(contract, stock_price)
        if flagged:
            unusual.append(flagged)

    total_volume = call_volume + put_volume
    put_call_ratio = (
        round(put_volume / call_volume, 2) if call_volume > 0 else 0.0
    )

    # Sort unusual contracts by premium descending, cap at 5
    unusual.sort(key=lambda x: x["premium_usd"], reverse=True)
    unusual = unusual[:5]

    return {
        "put_call_ratio": put_call_ratio,
        "unusual_contracts": unusual,
        "call_volume": call_volume,
        "put_volume": put_volume,
        "total_volume": total_volume,
        "has_unusual": len(unusual) > 0,
    }
