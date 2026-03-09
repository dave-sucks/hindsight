"""Finnhub data fetcher with async wrapper and rate limiting."""
import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import finnhub

# Finnhub free tier: 60 req/min — enforce 1s between calls
_RATE_LIMIT_SECS = 1.0
_lock = asyncio.Lock()


def _sync_client() -> finnhub.Client:
    api_key = os.getenv("FINNHUB_API_KEY", "")
    return finnhub.Client(api_key=api_key)


async def _call(fn, *args, **kwargs) -> Any:
    """Run a synchronous Finnhub call with rate limiting."""
    async with _lock:
        result = await asyncio.to_thread(fn, *args, **kwargs)
        await asyncio.sleep(_RATE_LIMIT_SECS)
        return result


class FinnhubService:
    def __init__(self, client=None):
        self.client = client or _sync_client()

    async def get_quote(self, symbol: str) -> dict:
        """Current price, change, % change."""
        raw = await _call(self.client.quote, symbol)
        return {
            "symbol": symbol,
            "price": raw.get("c"),
            "change": raw.get("d"),
            "change_pct": raw.get("dp"),
            "high": raw.get("h"),
            "low": raw.get("l"),
            "open": raw.get("o"),
            "prev_close": raw.get("pc"),
        }

    async def get_news(self, symbol: str, days_back: int = 3) -> list[dict]:
        """Recent company news."""
        from_date = (date.today() - timedelta(days=days_back)).isoformat()
        to_date = date.today().isoformat()
        raw = await _call(self.client.company_news, symbol, _from=from_date, to=to_date)
        return [
            {
                "headline": item.get("headline", ""),
                "summary": item.get("summary", ""),
                "source": item.get("source", ""),
                "url": item.get("url", ""),
                "datetime": item.get("datetime"),
            }
            for item in (raw or [])
        ]

    async def get_company_profile(self, symbol: str) -> dict:
        """Name, sector, market cap."""
        raw = await _call(self.client.company_profile2, symbol=symbol)
        return {
            "name": raw.get("name", ""),
            "sector": raw.get("finnhubIndustry", ""),
            "market_cap": raw.get("marketCapitalization"),
            "exchange": raw.get("exchange", ""),
            "country": raw.get("country", ""),
        }

    async def get_earnings_calendar(self, from_date: str, to_date: str) -> list[dict]:
        """Upcoming earnings reports."""
        raw = await _call(
            self.client.earnings_calendar,
            _from=from_date,
            to=to_date,
            symbol="",
            international=False,
        )
        items = raw.get("earningsCalendar", []) if isinstance(raw, dict) else []
        return [
            {
                "symbol": item.get("symbol", ""),
                "date": item.get("date", ""),
                "eps_estimate": item.get("epsEstimate"),
                "revenue_estimate": item.get("revenueEstimate"),
            }
            for item in items
        ]

    async def scan_trending_tickers(self) -> list[str]:
        """Most active / moving stocks via FMP market movers.

        Falls back to a curated high-liquidity list if FMP is unavailable.
        """
        try:
            from services.fmp import get_market_movers
            movers = await get_market_movers(limit=12)
            if movers:
                return movers
        except Exception:
            pass
        # Fallback: high-liquidity names
        return ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD"]

    async def get_candles(self, symbol: str, days: int = 60) -> dict:
        """Daily OHLCV candles for the last N days.

        Returns dict with keys: closes, highs, lows, opens, volumes, timestamps.
        Returns empty lists on error.
        """
        to_ts = int(datetime.now(timezone.utc).timestamp())
        from_ts = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
        try:
            raw = await _call(self.client.stock_candles, symbol, "D", from_ts, to_ts)
            if not isinstance(raw, dict) or raw.get("s") != "ok":
                return {"closes": [], "highs": [], "lows": [], "opens": [], "volumes": [], "timestamps": []}
            return {
                "closes": [float(x) for x in raw.get("c", [])],
                "highs": [float(x) for x in raw.get("h", [])],
                "lows": [float(x) for x in raw.get("l", [])],
                "opens": [float(x) for x in raw.get("o", [])],
                "volumes": [float(x) for x in raw.get("v", [])],
                "timestamps": raw.get("t", []),
            }
        except Exception:
            return {"closes": [], "highs": [], "lows": [], "opens": [], "volumes": [], "timestamps": []}

    async def get_recommendation_trends(self, symbol: str) -> dict:
        """Analyst buy/hold/sell recommendation consensus.

        Returns the most recent period's counts and a computed consensus label.
        """
        try:
            raw = await _call(self.client.recommendation_trends, symbol)
            if not isinstance(raw, list) or not raw:
                return {}
            latest = raw[0]  # most recent period
            strong_buy = latest.get("strongBuy", 0)
            buy = latest.get("buy", 0)
            hold = latest.get("hold", 0)
            sell = latest.get("sell", 0)
            strong_sell = latest.get("strongSell", 0)
            total = strong_buy + buy + hold + sell + strong_sell
            if total == 0:
                return {}
            bullish = strong_buy + buy
            bearish = sell + strong_sell
            if bullish / total >= 0.55:
                consensus = "BUY"
            elif bearish / total >= 0.35:
                consensus = "SELL"
            else:
                consensus = "HOLD"
            return {
                "strong_buy": strong_buy,
                "buy": buy,
                "hold": hold,
                "sell": sell,
                "strong_sell": strong_sell,
                "total_analysts": total,
                "consensus": consensus,
                "period": latest.get("period", ""),
            }
        except Exception:
            return {}

    async def get_insider_transactions(self, symbol: str) -> list[dict]:
        """Recent insider buy/sell transactions (last 90 days).

        Returns list of {name, type, shares, value, date}.
        """
        try:
            from_date = (date.today() - timedelta(days=90)).isoformat()
            to_date = date.today().isoformat()
            raw = await _call(
                self.client.stock_insider_transactions,
                symbol=symbol,
                _from=from_date,
                to=to_date,
            )
            items = raw.get("data", []) if isinstance(raw, dict) else []
            result = []
            for item in items[:10]:  # cap at 10 most recent
                txn_type = item.get("transactionCode", "")
                # P = Purchase, S = Sale
                if txn_type not in ("P", "S"):
                    continue
                result.append({
                    "name": item.get("name", ""),
                    "type": "BUY" if txn_type == "P" else "SELL",
                    "shares": item.get("share", 0),
                    "value": item.get("value"),
                    "date": item.get("transactionDate", ""),
                })
            return result
        except Exception:
            return []

    async def get_basic_financials(self, symbol: str) -> dict:
        """P/E, P/B, market cap tier."""
        raw = await _call(self.client.company_basic_financials, symbol, "all")
        metric = raw.get("metric", {}) if isinstance(raw, dict) else {}
        market_cap = metric.get("marketCapitalization", 0)
        if market_cap >= 200_000:
            tier = "MEGA"
        elif market_cap >= 10_000:
            tier = "LARGE"
        elif market_cap >= 2_000:
            tier = "MID"
        else:
            tier = "SMALL"
        return {
            "pe_ratio": metric.get("peNormalizedAnnual"),
            "pb_ratio": metric.get("pbAnnual"),
            "market_cap": market_cap,
            "market_cap_tier": tier,
            "52w_high": metric.get("52WeekHigh"),
            "52w_low": metric.get("52WeekLow"),
        }
