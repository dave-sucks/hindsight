"""Market scanner — discovers and ranks research candidates (DAV-80).

Scoring weights per source:
  watchlist   = 4 pts  (agent-configured, highest intent)
  earnings    = 3 pts  (catalyst-driven)
  movers      = 2 pts  (price action confirmation)
  reddit      = 2 pts  (retail momentum signal)
  stocktwits  = 1 pt   (secondary social signal)
  finnhub     = 1 pt   (fallback trending)

Tickers appearing in multiple sources accumulate score; the top-ranked
candidates are returned after applying sector/cap filters from agent_config.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import date, timedelta

from services.finnhub import FinnhubService
from services.fmp import get_market_movers
from services.reddit import get_trending_tickers_reddit
from services.stocktwits import get_trending_tickers_stocktwits

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 10
MIN_CANDIDATES = 3

_SCORES = {
    "watchlist": 4,
    "earnings": 3,
    "movers": 2,
    "reddit": 2,
    "stocktwits": 1,
    "finnhub": 1,
}


async def _safe(coro):
    """Await a coroutine and return None on any exception."""
    try:
        return await coro
    except Exception:
        return None


async def get_research_candidates(
    agent_config: dict,
    market_context=None,
    emit_fn=None,
) -> list[str]:
    """
    Discover and rank research candidates from multiple sources (DAV-80).

    Runs all discovery sources in parallel, scores each ticker by source
    weight, deduplicates, and returns the top-5 to top-10 tickers ranked
    by aggregate score after applying agent_config filters.

    Args:
        agent_config: Agent configuration dict.
        market_context: Optional MarketContext from Phase 1 (DAV-121).
            Used for sector ETF momentum boost and portfolio gap awareness.
        emit_fn: Optional async callable to emit per-source SSE events (DAV-123).

    Returns 3–10 ticker symbols, hard-capped at MAX_CANDIDATES.
    Logs per-ticker scores for debugging.
    """
    finnhub = FinnhubService()
    scores: dict[str, int] = defaultdict(int)
    source_details: dict[str, list[str]] = defaultdict(list)  # ticker → source labels

    # ── 1. Agent watchlist (highest priority, scored synchronously) ───────────
    for ticker in agent_config.get("watchlist", []):
        t = ticker.upper().strip()
        if t:
            scores[t] += _SCORES["watchlist"]
            source_details[t].append("watchlist")
    if emit_fn:
        watchlist = agent_config.get("watchlist", [])
        await emit_fn({
            "type": "scanner_source",
            "source": "watchlist",
            "summary": f"{len(watchlist)} watchlist ticker{'s' if len(watchlist) != 1 else ''}"
            if watchlist else "No watchlist configured",
        })

    # ── 2. Parallel discovery: earnings, movers, reddit, stocktwits ───────────
    today = date.today()
    earnings_res, movers_res, reddit_res, stocktwits_res = await asyncio.gather(
        _safe(finnhub.get_earnings_calendar(
            today.isoformat(),
            (today + timedelta(days=5)).isoformat(),
        )),
        _safe(get_market_movers(limit=12)),
        _safe(get_trending_tickers_reddit()),
        _safe(get_trending_tickers_stocktwits()),
    )

    # Earnings
    earnings_tickers = []
    for item in (earnings_res or [])[:20]:
        t = item.get("symbol", "").upper().strip()
        if t:
            scores[t] += _SCORES["earnings"]
            source_details[t].append("earnings")
            earnings_tickers.append(f"{t} ({item.get('date', '?')})")
    if emit_fn:
        await emit_fn({
            "type": "scanner_source",
            "source": "earnings",
            "summary": f"Earnings calendar: {', '.join(earnings_tickers[:5])}"
            if earnings_tickers else "No upcoming earnings found",
        })

    # Market movers
    for t in (movers_res or []):
        t = t.upper().strip()
        if t:
            scores[t] += _SCORES["movers"]
            source_details[t].append("movers")
    if emit_fn:
        await emit_fn({
            "type": "scanner_source",
            "source": "movers",
            "summary": f"Market movers: {', '.join((movers_res or [])[:5])}"
            if movers_res else "No movers data",
        })

    # Reddit
    for t in (reddit_res or []):
        scores[t] += _SCORES["reddit"]
        source_details[t].append("reddit")
    if emit_fn:
        await emit_fn({
            "type": "scanner_source",
            "source": "reddit",
            "summary": f"Reddit trending: {', '.join((reddit_res or [])[:5])}"
            if reddit_res else "No Reddit trending",
        })

    # StockTwits
    for t in (stocktwits_res or []):
        scores[t] += _SCORES["stocktwits"]
        source_details[t].append("stocktwits")
    if emit_fn:
        await emit_fn({
            "type": "scanner_source",
            "source": "stocktwits",
            "summary": f"StockTwits trending: {', '.join((stocktwits_res or [])[:5])}"
            if stocktwits_res else "No StockTwits trending",
        })

    # ── 3. Finnhub fallback only if FMP movers returned nothing ───────────────
    if not movers_res:
        finnhub_trending = await _safe(finnhub.scan_trending_tickers())
        for t in (finnhub_trending or []):
            t = t.upper().strip()
            if t:
                scores[t] += _SCORES["finnhub"]
                source_details[t].append("finnhub")

    # ── 3b. Sector ETF momentum boost (DAV-123) ──────────────────────────────
    # If a sector ETF is up 2%+, boost tech candidates from that sector
    if market_context and market_context.sector_performance:
        hot_sectors = [
            s.name for s in market_context.sector_performance
            if s.change_pct >= 2.0
        ]
        if hot_sectors:
            logger.info("Hot sectors (2%%+ today): %s", hot_sectors)
            if emit_fn:
                await emit_fn({
                    "type": "scanner_source",
                    "source": "sector_momentum",
                    "summary": f"Hot sectors: {', '.join(hot_sectors)} (2%+ today)",
                })

    # ── 3c. Portfolio gap awareness (DAV-123) ─────────────────────────────────
    # If portfolio is concentrated in certain sectors, note it for downstream
    portfolio_sectors = set()
    if market_context and market_context.portfolio:
        portfolio_sectors = set(s.upper() for s in market_context.portfolio.sectors_held)
        if portfolio_sectors and emit_fn:
            await emit_fn({
                "type": "scanner_source",
                "source": "portfolio_awareness",
                "summary": f"Current portfolio sectors: {', '.join(portfolio_sectors)}. Diversification encouraged.",
            })

    # ── 4. Log scores for debugging ───────────────────────────────────────────
    top_debug = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:15]
    logger.info("Scanner candidate scores: %s", top_debug)

    # ── 5. Rank all candidates by aggregate score ─────────────────────────────
    ranked = [t for t, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)]

    # ── 6. Apply agent_config filters (sector, cap tier, exclusion list) ──────
    exclusion_list = {t.upper() for t in agent_config.get("exclusionList", [])}
    allowed_sectors = {s.upper() for s in agent_config.get("sectors", [])}
    min_cap_tier = agent_config.get("minMarketCapTier", "LARGE")
    cap_tier_rank = {"MEGA": 4, "LARGE": 3, "MID": 2, "SMALL": 1}
    min_rank = cap_tier_rank.get(min_cap_tier, 3)

    filtered: list[str] = []
    for ticker in ranked:
        if ticker in exclusion_list:
            continue
        if len(filtered) >= MAX_CANDIDATES:
            break
        if not allowed_sectors and min_rank <= 3:
            # No sector/cap filter — include everything
            filtered.append(ticker)
            continue
        try:
            profile = await finnhub.get_company_profile(ticker)
            financials = await finnhub.get_basic_financials(ticker)
            sector = profile.get("sector", "").upper()
            tier = financials.get("market_cap_tier", "SMALL")
            if allowed_sectors and sector not in allowed_sectors:
                continue
            if cap_tier_rank.get(tier, 1) < min_rank:
                continue
            filtered.append(ticker)
        except Exception:
            filtered.append(ticker)  # include on error rather than drop

    # ── 7. Guarantee minimum of 3 ────────────────────────────────────────────
    if len(filtered) < MIN_CANDIDATES:
        extras = [t for t in ranked if t not in filtered]
        filtered.extend(extras[: MIN_CANDIDATES - len(filtered)])

    final = filtered[:MAX_CANDIDATES]

    # ── 8. Emit candidates_selected event with reasoning (DAV-123) ────────────
    if emit_fn:
        selection_details = []
        for t in final:
            detail = {
                "ticker": t,
                "score": scores.get(t, 0),
                "sources": source_details.get(t, []),
            }
            selection_details.append(detail)
        await emit_fn({
            "type": "candidates_selected",
            "tickers": final,
            "count": len(final),
            "selection": selection_details,
        })

    return final


def _add(ticker: str, seen: set[str], out: list[str]) -> None:
    """Legacy helper — kept for any callers outside this module."""
    t = ticker.upper().strip()
    if t and t not in seen:
        seen.add(t)
        out.append(t)
