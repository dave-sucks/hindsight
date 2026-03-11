"""Market context phase — DAV-121.

Generates a market-wide context snapshot at the start of each research run:
  1. Fetch SPX/SPY price + daily change
  2. Fetch VIX level + direction
  3. Fetch sector ETF heatmap (top 3 up/down sectors)
  4. Accept portfolio state from caller
  5. GPT-4o produces: regime, key levels, sector rotation, approach summary
  6. Emit `market_context` SSE event

The MarketContext output is passed downstream to scanner (sector awareness)
and thesis phases (so the model doesn't evaluate stocks in a vacuum).
"""
import json
import logging
import os
from typing import Callable, Optional

from openai import AsyncOpenAI

from models import MarketContext, PortfolioState, SectorPerformance

logger = logging.getLogger(__name__)
_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

_MARKET_CONTEXT_SYSTEM = """You are a senior macro strategist at a systematic hedge fund.
Given today's market data (SPX, VIX, sector ETF performance, portfolio state), produce
a concise market context brief for the research team.

Return a JSON object with these exact fields:
{
  "regime": "trending_up" | "trending_down" | "range_bound" | "volatile",
  "key_levels": "<1-2 sentences on S&P support/resistance or key technical levels if relevant, else empty string>",
  "sector_rotation_notes": "<2-3 sentences on what sectors are moving and likely why>",
  "approach_summary": "<1-2 sentences framing today's run strategy given market + portfolio>"
}

Guidelines:
- regime: "volatile" if VIX > 25 or sector dispersion is high. "trending_up" if SPX > +0.3% and
  breadth is positive. "trending_down" if SPX < -0.3% and breadth is negative. "range_bound" otherwise.
- approach_summary: factor in portfolio state (existing exposure, concentration). If heavy in one
  sector, suggest diversification. If capital is limited, suggest selectivity.
- Be specific and actionable. No filler. Reference actual numbers."""


async def generate_market_context(
    portfolio_state: Optional[PortfolioState] = None,
    emit_fn: Optional[Callable] = None,
) -> MarketContext:
    """Fetch market data and generate GPT-4o market context.

    Args:
        portfolio_state: Current portfolio snapshot from Next.js caller.
        emit_fn: Optional async callable to emit SSE events.

    Returns:
        MarketContext with regime, sector rotation, and approach summary.
    """
    from services.fmp import get_sector_etf_performance, get_index_quotes

    # ── 1. Fetch market data in parallel ──────────────────────────────────
    import asyncio

    index_res, sector_res = await asyncio.gather(
        _safe(get_index_quotes()),
        _safe(get_sector_etf_performance()),
    )

    indexes = index_res or {"spy": {}, "vix": {}}
    sectors = sector_res or []

    spy = indexes.get("spy", {})
    vix = indexes.get("vix", {})

    spx_price = spy.get("price")
    spx_change = spy.get("change_pct")
    vix_level = vix.get("price")
    vix_change = vix.get("change_pct")

    # Build sector performance models
    sector_perf = [
        SectorPerformance(
            symbol=s["symbol"],
            name=s["name"],
            change_pct=s["change_pct"],
            price=s.get("price"),
        )
        for s in sectors
    ]

    top_sectors = [s["name"] for s in sectors[:3]] if sectors else []
    bottom_sectors = [s["name"] for s in sectors[-3:]] if len(sectors) >= 3 else []

    # ── 2. Build GPT-4o prompt ────────────────────────────────────────────
    sector_lines = "\n".join(
        f"  {s['symbol']} ({s['name']}): {s['change_pct']:+.2f}%"
        for s in sectors
    ) if sectors else "  No sector data available"

    portfolio_block = "No portfolio data provided."
    if portfolio_state:
        positions_str = ""
        if portfolio_state.open_positions:
            positions_str = "\n".join(
                f"    {p.get('ticker', '?')} ({p.get('direction', '?')}): "
                f"entry ${p.get('entry_price', 0):.2f}, "
                f"P&L {p.get('pnl_pct', 0):+.1f}%, "
                f"{p.get('days_held', 0)}d held, "
                f"sector: {p.get('sector', 'unknown')}"
                for p in portfolio_state.open_positions
            )
        portfolio_block = (
            f"{portfolio_state.position_count} open positions, "
            f"${portfolio_state.total_exposure:,.0f} deployed, "
            f"${portfolio_state.available_capital:,.0f} available\n"
            f"  Sectors held: {', '.join(portfolio_state.sectors_held) or 'none'}"
        )
        if positions_str:
            portfolio_block += f"\n  Positions:\n{positions_str}"

    prompt = f"""Today's market snapshot:

SPX (SPY): ${spx_price or 'N/A'} ({spx_change or 0:+.2f}% today)
VIX: {vix_level or 'N/A'} ({vix_change or 0:+.2f}% today)

Sector ETF Performance (daily):
{sector_lines}

Portfolio State:
  {portfolio_block}"""

    # ── 3. GPT-4o market context analysis ─────────────────────────────────
    try:
        response = await _openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _MARKET_CONTEXT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=400,
        )
        raw = json.loads(response.choices[0].message.content)
    except Exception as exc:
        logger.warning("Market context GPT-4o call failed: %s", exc)
        raw = {
            "regime": _infer_regime(spx_change, vix_level),
            "key_levels": "",
            "sector_rotation_notes": "",
            "approach_summary": "Market data partially available. Proceeding with standard research approach.",
        }

    context = MarketContext(
        spx_price=spx_price,
        spx_change_pct=spx_change,
        vix_level=vix_level,
        vix_change_pct=vix_change,
        regime=raw.get("regime", "unknown"),
        sector_performance=sector_perf,
        top_sectors=top_sectors,
        bottom_sectors=bottom_sectors,
        portfolio=portfolio_state,
        approach_summary=raw.get("approach_summary", ""),
        key_levels=raw.get("key_levels", ""),
        sector_rotation_notes=raw.get("sector_rotation_notes", ""),
    )

    # ── 4. Emit SSE event ─────────────────────────────────────────────────
    if emit_fn:
        await emit_fn({
            "type": "market_context",
            "regime": context.regime,
            "spx_price": context.spx_price,
            "spx_change_pct": context.spx_change_pct,
            "vix_level": context.vix_level,
            "vix_change_pct": context.vix_change_pct,
            "top_sectors": [
                {"symbol": s.symbol, "name": s.name, "change_pct": s.change_pct}
                for s in sector_perf[:3]
            ],
            "bottom_sectors": [
                {"symbol": s.symbol, "name": s.name, "change_pct": s.change_pct}
                for s in sector_perf[-3:]
            ] if len(sector_perf) >= 3 else [],
            "portfolio_summary": {
                "position_count": portfolio_state.position_count if portfolio_state else 0,
                "total_exposure": portfolio_state.total_exposure if portfolio_state else 0,
                "available_capital": portfolio_state.available_capital if portfolio_state else 0,
            },
            "approach_summary": context.approach_summary,
            "key_levels": context.key_levels,
            "sector_rotation_notes": context.sector_rotation_notes,
        })

    logger.info(
        "Market context: regime=%s SPX=%s(%s%%) VIX=%s",
        context.regime, spx_price, spx_change, vix_level,
    )

    return context


def _infer_regime(
    spx_change: Optional[float], vix_level: Optional[float]
) -> str:
    """Simple heuristic fallback when GPT-4o call fails."""
    if vix_level and vix_level > 25:
        return "volatile"
    if spx_change is not None:
        if spx_change > 0.3:
            return "trending_up"
        if spx_change < -0.3:
            return "trending_down"
    return "range_bound"


async def _safe(coro):
    """Await a coroutine and return None on any exception."""
    try:
        return await coro
    except Exception as exc:
        logger.warning("Market context data fetch failed: %s", exc)
        return None
