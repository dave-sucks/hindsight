"""Fund Manager: synthesizes bull and bear analyses into a final trade decision."""
import json
import logging
import os

from openai import AsyncOpenAI

from models import DataContext, SourceItem, ThesisOutput

logger = logging.getLogger(__name__)
_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

_FM_SYSTEM = """You are the Portfolio Manager and final decision-maker at a hedge fund.
Two analysts have just presented opposing cases. You must weigh both and make a
FINAL, IRREVOCABLE trading decision with full conviction.

Return JSON with these exact fields:
{
  "direction": "LONG" | "SHORT" | "PASS",
  "hold_duration": "DAY" | "SWING" | "POSITION",
  "confidence_score": <integer 0-100>,
  "reasoning_summary": "<3-4 paragraph final synthesis: (1) bull merits acknowledged, (2) bear risks acknowledged, (3) why one side wins, (4) timing and sizing rationale>",
  "thesis_bullets": ["<bullet 1 with numbers>", "<bullet 2>", "<bullet 3>", "<bullet 4>", "<bullet 5>"],
  "risk_flags": ["<top risk 1>", "<top risk 2>", "<top risk 3>"],
  "entry_price": <float — recommended entry>,
  "target_price": <float — price target>,
  "stop_loss": <float — max loss level>,
  "signal_types": ["MOMENTUM"|"EARNINGS_BEAT"|"SECTOR_ROTATION"|"MEAN_REVERSION"|"BREAKOUT"|"NEWS_CATALYST"|"MACRO"|"OTHER"]
}

Decision rules:
- LONG: bull case materially stronger than bear case. Confidence 50+.
- SHORT: bear case materially stronger, clear downside catalyst. Confidence 50+.
- PASS: cases are balanced, data is insufficient, or contradictory signals with no clear edge.
- thesis_bullets: exactly 4-5 specific bullets referencing the debate outcomes.
- risk_flags: exactly 2-3 risks drawn from the bear analyst's case.
- entry_price/target_price/stop_loss: required floats, never null.
- Price targets must be numbers only (no $ symbols)."""


async def run_fund_manager(
    data: DataContext,
    bull_case: dict,
    bear_case: dict,
    total_tokens: list,
) -> ThesisOutput:
    """Synthesize bull + bear analyses into a final ThesisOutput."""
    prompt = f"""=== SITUATION BRIEF ===
Ticker: {data.ticker} ({data.company_name})
Sector: {data.sector}
Current Price: ${data.price}
52W range: ${data.low_52w} – ${data.high_52w}
Upcoming earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}

=== BULL ANALYST CASE ===
{bull_case.get('analysis', 'No analysis provided.')}

Key Signals:
{chr(10).join('• ' + s for s in bull_case.get('key_signals', []))}

Bull price target: ${bull_case.get('price_target', 'N/A')}
Bull conviction: {bull_case.get('confidence', 'N/A')}%

=== BEAR ANALYST CASE ===
{bear_case.get('analysis', 'No analysis provided.')}

Key Risks:
{chr(10).join('• ' + r for r in bear_case.get('key_risks', []))}

Bear downside target: ${bear_case.get('worst_case_target', 'N/A')}
Bear conviction: {bear_case.get('confidence', 'N/A')}%

=== YOUR DECISION ===
You have heard both sides. Make your final call on {data.ticker}."""

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _FM_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=1024,
    )

    usage = response.usage
    if usage:
        total_tokens[0] += usage.total_tokens
        logger.info(
            "fund_manager tokens: input=%d output=%d total=%d",
            usage.prompt_tokens,
            usage.completion_tokens,
            usage.total_tokens,
        )

    raw = json.loads(response.choices[0].message.content)

    sources = data.sources or []

    return ThesisOutput(
        ticker=data.ticker,
        direction=raw.get("direction", "PASS"),
        hold_duration=raw.get("hold_duration", "SWING"),
        confidence_score=raw.get("confidence_score", 0),
        reasoning_summary=raw.get("reasoning_summary", ""),
        thesis_bullets=raw.get("thesis_bullets", []),
        risk_flags=raw.get("risk_flags", []),
        signal_types=raw.get("signal_types", []),
        sector=data.sector or None,
        entry_price=raw.get("entry_price") or data.price,
        target_price=raw.get("target_price"),
        stop_loss=raw.get("stop_loss"),
        sources_used=sources,
        model_used="gpt-4o (multi-agent)",
    )
