"""Portfolio synthesis phase — DAV-122.

After ALL tickers are researched and before ANY trades are placed,
run a portfolio-level GPT-4o analysis that:
  1. Compares all theses cross-pick (not in isolation)
  2. Decides which to act on, portfolio-aware
  3. Sizes positions with explicit reasoning
  4. Evaluates existing positions for close/hold/trim
  5. Ranks picks with clear #1 recommendation
  6. Emits `run_summary` SSE event

The PortfolioSynthesis output is returned in RunResponse and streamed
as a `run_summary` event to the UI.
"""
import json
import logging
import os
from typing import Callable, List, Optional

from openai import AsyncOpenAI

from models import MarketContext, PortfolioState, PortfolioSynthesis, ThesisOutput

logger = logging.getLogger(__name__)
_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

_SYNTHESIS_SYSTEM = """You are a senior portfolio manager at a systematic hedge fund.
You have just received individual trade theses from your research team. Your job is to
make PORTFOLIO-LEVEL decisions: which picks to act on, how to size them, and what to do
with existing positions.

You are NOT evaluating stocks in isolation — you are building a coherent portfolio.

Key principles:
- Diversification: avoid sector concentration (max 2 positions in same sector unless very high conviction)
- Capital allocation: size positions proportional to conviction and R:R ratio
- Risk management: total portfolio exposure should not exceed available capital
- Conviction ranking: identify the single best trade (Habich principle: always know your #1)
- Existing positions: recommend CLOSE if near target, momentum faded, or thesis broken;
  TRIM if overweight; HOLD if thesis intact; never recommend adding to losers

Return a JSON object with these exact fields:
{
  "summary": "<3-5 sentence morning research summary: market regime, sector rotation, portfolio strategy for today>",
  "ranked_picks": [
    {
      "ticker": "AAPL",
      "rank": 1,
      "action": "BUY" | "SHORT" | "SKIP",
      "sizing_dollars": 5000,
      "reasoning": "<1-2 sentences: why this rank, why this size, portfolio fit>"
    }
  ],
  "existing_position_actions": [
    {
      "ticker": "MSFT",
      "action": "HOLD" | "CLOSE" | "TRIM",
      "reasoning": "<1 sentence: why>"
    }
  ],
  "new_exposure": 12000,
  "top_pick": "AAPL"
}

Guidelines:
- ranked_picks: include ALL theses (including PASS), ordered by conviction. PASS theses get action="SKIP".
- Only assign action="BUY"|"SHORT" to theses you genuinely want to trade. SKIP the rest.
- sizing_dollars: specific dollar amount based on available capital and conviction.
  High conviction (75+): up to maxPositionSize. Medium (55-74): half size. Low (<55): SKIP.
- new_exposure: total NEW dollars being deployed (sum of all BUY/SHORT sizing).
- existing_position_actions: evaluate every open position. Empty array if no open positions.
- top_pick: ticker of your single highest-conviction actionable pick. null if all SKIP.
- summary: reference actual numbers (SPX level, VIX, sector moves). Be specific.
- If available capital is limited, be selective — quality over quantity.
- Respect agent config constraints: maxOpenPositions, maxPositionSize, directionBias."""


async def generate_portfolio_synthesis(
    theses: List[ThesisOutput],
    market_context: Optional[MarketContext],
    agent_config: dict,
    emit_fn: Optional[Callable] = None,
) -> PortfolioSynthesis:
    """Run GPT-4o portfolio synthesis after all theses are generated.

    Args:
        theses: All ThesisOutput objects from the research run.
        market_context: MarketContext from Phase 1 (may be None).
        agent_config: Agent configuration dict with constraints.
        emit_fn: Optional async callable to emit SSE events.

    Returns:
        PortfolioSynthesis with ranked picks, sizing, and summary.
    """
    # Filter to actionable theses (non-PASS with confidence > 0)
    actionable = [t for t in theses if t.direction != "PASS"]
    all_tickers = [t.ticker for t in theses]

    # ── Build thesis summaries for GPT-4o ────────────────────────────────
    thesis_lines = []
    for t in theses:
        rr = t.risk_reward_ratio
        rr_str = f"R:R {rr:.1f}" if rr else "R:R N/A"
        line = (
            f"  {t.ticker} ({t.direction}, {t.confidence_score}% confidence, "
            f"{t.hold_duration}): {t.reasoning_summary[:150]}"
            f" | Entry ${t.entry_price or 0:.2f}, Target ${t.target_price or 0:.2f}, "
            f"Stop ${t.stop_loss or 0:.2f} | {rr_str}"
            f" | Sector: {t.sector or 'unknown'}"
            f" | Signals: {', '.join(t.signal_types)}"
        )
        if t.invalidation:
            line += f" | Invalidation: {t.invalidation}"
        thesis_lines.append(line)

    # ── Build market context block ───────────────────────────────────────
    market_block = "No market context available."
    if market_context:
        market_block = (
            f"Regime: {market_context.regime}\n"
            f"SPX: ${market_context.spx_price or 'N/A'} "
            f"({market_context.spx_change_pct or 0:+.2f}%)\n"
            f"VIX: {market_context.vix_level or 'N/A'} "
            f"({market_context.vix_change_pct or 0:+.2f}%)\n"
            f"Top sectors: {', '.join(market_context.top_sectors)}\n"
            f"Bottom sectors: {', '.join(market_context.bottom_sectors)}\n"
            f"Approach: {market_context.approach_summary}"
        )

    # ── Build portfolio state block ──────────────────────────────────────
    portfolio = market_context.portfolio if market_context else None
    portfolio_block = "No portfolio data."
    if portfolio:
        pos_lines = []
        for p in portfolio.open_positions:
            pos_lines.append(
                f"    {p.get('ticker', '?')} ({p.get('direction', '?')}): "
                f"entry ${p.get('entry_price', 0):.2f}, "
                f"P&L {p.get('pnl_pct', 0):+.1f}%, "
                f"{p.get('days_held', 0)}d held, "
                f"sector: {p.get('sector', 'unknown')}"
            )
        portfolio_block = (
            f"{portfolio.position_count} open positions, "
            f"${portfolio.total_exposure:,.0f} deployed, "
            f"${portfolio.available_capital:,.0f} available\n"
            f"  Sectors held: {', '.join(portfolio.sectors_held) or 'none'}"
        )
        if pos_lines:
            portfolio_block += "\n  Positions:\n" + "\n".join(pos_lines)

    # ── Build agent config constraints block ─────────────────────────────
    max_positions = agent_config.get("maxOpenPositions", 10)
    max_position_size = agent_config.get("maxPositionSize", 10000)
    direction_bias = agent_config.get("directionBias", "LONG_ONLY")
    current_open = portfolio.position_count if portfolio else 0
    slots_available = max(0, max_positions - current_open)

    constraints_block = (
        f"Max open positions: {max_positions} (currently {current_open}, "
        f"{slots_available} slots available)\n"
        f"Max position size: ${max_position_size:,.0f}\n"
        f"Direction bias: {direction_bias}"
    )

    prompt = f"""Portfolio Synthesis — evaluate all research theses as a portfolio.

Market Context:
{market_block}

Current Portfolio:
  {portfolio_block}

Agent Constraints:
  {constraints_block}

Today's Research Theses ({len(theses)} analyzed, {len(actionable)} actionable):
{chr(10).join(thesis_lines)}

Decide which theses to trade, how to size them, and what to do with existing positions.
Respect the {slots_available} available position slots and ${max_position_size:,.0f} max position size."""

    # ── GPT-4o synthesis call ────────────────────────────────────────────
    try:
        response = await _openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _SYNTHESIS_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=800,
        )
        raw = json.loads(response.choices[0].message.content)
    except Exception as exc:
        logger.warning("Portfolio synthesis GPT-4o call failed: %s", exc)
        # Fallback: rank by confidence, no sizing
        raw = _fallback_synthesis(theses, actionable, portfolio)

    synthesis = PortfolioSynthesis(
        summary=raw.get("summary", ""),
        ranked_picks=raw.get("ranked_picks", []),
        existing_position_actions=raw.get("existing_position_actions", []),
        new_exposure=raw.get("new_exposure", 0.0),
        top_pick=raw.get("top_pick"),
    )

    # ── Emit run_summary SSE event ───────────────────────────────────────
    if emit_fn:
        await emit_fn({
            "type": "run_summary",
            "summary": synthesis.summary,
            "ranked_picks": synthesis.ranked_picks,
            "existing_position_actions": synthesis.existing_position_actions,
            "new_exposure": synthesis.new_exposure,
            "top_pick": synthesis.top_pick,
            "total_theses": len(theses),
            "actionable_theses": len(actionable),
        })

    logger.info(
        "Portfolio synthesis: top_pick=%s, new_exposure=$%.0f, %d ranked picks",
        synthesis.top_pick, synthesis.new_exposure, len(synthesis.ranked_picks),
    )

    return synthesis


def _fallback_synthesis(
    theses: List[ThesisOutput],
    actionable: List[ThesisOutput],
    portfolio: Optional[PortfolioState],
) -> dict:
    """Simple heuristic fallback when GPT-4o call fails."""
    ranked = sorted(actionable, key=lambda t: t.confidence_score, reverse=True)
    picks = []
    for i, t in enumerate(ranked):
        picks.append({
            "ticker": t.ticker,
            "rank": i + 1,
            "action": "BUY" if t.direction == "LONG" else "SHORT",
            "sizing_dollars": 0,
            "reasoning": f"Confidence {t.confidence_score}%, auto-ranked by score",
        })
    # Add PASS theses as SKIP
    for t in theses:
        if t.direction == "PASS":
            picks.append({
                "ticker": t.ticker,
                "rank": len(picks) + 1,
                "action": "SKIP",
                "sizing_dollars": 0,
                "reasoning": t.reasoning_summary[:100],
            })

    return {
        "summary": "GPT-4o synthesis unavailable. Theses ranked by confidence score.",
        "ranked_picks": picks,
        "existing_position_actions": [],
        "new_exposure": 0.0,
        "top_pick": ranked[0].ticker if ranked else None,
    }
