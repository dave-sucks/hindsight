"""
FinRobot thesis generation pipeline.

Three-step chain:
  Data-CoT    → parallel Finnhub + alt-data collection
  Concept-CoT → GPT-4o identifies signals, direction, initial confidence
  Thesis-CoT  → GPT-4o structured output with full thesis
"""
import asyncio
import json
import logging
import os
import uuid
from datetime import date, timedelta
from typing import Optional

from openai import AsyncOpenAI

from models import (
    AnalystSentiment,
    ConceptAnalysis,
    DataContext,
    EarningsIntel,
    InsiderTransaction,
    OptionsFlow,
    RedditSignal,
    SourceItem,
    TechnicalIndicators,
    ThesisOutput,
)
from services.finnhub import FinnhubService
from services.indicators import (
    calc_bollinger_position,
    calc_macd,
    calc_rsi,
    calc_sma,
    calc_52w_position,
    calc_volume_ratio,
)

logger = logging.getLogger(__name__)
_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

_CONCEPT_SYSTEM = """You are a decisive quantitative research analyst. Your job is to
identify the strongest available trade signal in the data and form a directional view.

Return a JSON object with these exact fields:
{
  "direction": "LONG" | "SHORT" | "PASS",
  "hold_duration": "DAY" | "SWING" | "POSITION",
  "signal_types": ["EARNINGS_BEAT","MOMENTUM","SECTOR_ROTATION","MEAN_REVERSION","BREAKOUT","NEWS_CATALYST","MACRO","TECHNICAL","INSIDER","OTHER"],
  "initial_confidence": <integer 0-100>,
  "reasoning_notes": "<4-6 sentence analysis covering price action, technicals, fundamentals, and catalysts>",
  "pass_reason": "<specific reason if PASS, else null>"
}

Guidelines:
- LONG/SHORT: commit when there is any identifiable signal or trend. Confidence 40-100.
- PASS: only when data is genuinely unavailable, the ticker is invalid, or signals are
  directly contradictory with no clear edge.
- hold_duration: DAY for intraday catalysts, SWING for 2-10 day setups, POSITION for
  multi-week fundamental themes.
- signal_types: list ALL applicable signals.
- initial_confidence: your honest 0-100 score. Do not artificially deflate.
  50+ means a clear edge exists, 70+ means high conviction.
- Use RSI to judge momentum exhaustion/continuation. RSI < 35 = oversold bounce potential,
  RSI > 70 = overbought caution. MACD histogram direction confirms momentum.
- Use analyst consensus and insider activity as supporting signals.
- reasoning_notes: be specific — quote RSI values, price vs SMA, analyst counts, news."""

_THESIS_SYSTEM = """You are a senior equity analyst at a hedge fund generating a formal trade thesis.
You write with conviction. Every recommendation includes specific price targets.

Return a JSON object with these exact fields:
{
  "reasoning_summary": "<3-4 paragraph analysis: (1) situation overview, (2) catalysts/signals, (3) risk/reward setup, (4) timing rationale>",
  "thesis_bullets": ["<bullet 1>", "<bullet 2>", "<bullet 3>", "<bullet 4>", "<bullet 5>"],
  "risk_flags": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "entry_price": <float — use current price if no better entry>,
  "target_price": <float — required, calculate based on setup>,
  "stop_loss": <float — required, use technical level or 3-5% below entry>,
  "confidence_score": <integer 0-100>
}

Requirements:
- thesis_bullets: exactly 4-5 specific, actionable bullets with numbers where possible.
- risk_flags: exactly 2-3 specific risks.
- entry_price/target_price/stop_loss: must be floats, never null. Use current price + logical
  offsets if needed.
- confidence_score: calibrate against initial_confidence passed in the prompt. Adjust up if
  thesis is clean, down if risks are elevated.
- Price targets must be numbers only (no $ or currency symbols)."""


async def run_data_cot(ticker: str, finnhub: FinnhubService) -> DataContext:
    """Step 1: Parallel Finnhub + alt-data collection — price, fundamentals, news,
    candles (for technicals), analyst recommendations, insider transactions,
    Reddit sentiment, unusual options flow, and earnings intelligence."""
    from services.reddit import get_reddit_sentiment
    from services.options_flow import get_unusual_options
    from services.earnings_intel import get_earnings_intel

    today = date.today().isoformat()
    earnings_from = today
    earnings_to = (date.today() + timedelta(days=7)).isoformat()

    (
        quote, profile, financials, news, earnings,
        candles, rec_trends, insider_txns,
        reddit_raw, options_raw, earnings_raw,
    ) = await asyncio.gather(
        finnhub.get_quote(ticker),
        finnhub.get_company_profile(ticker),
        finnhub.get_basic_financials(ticker),
        finnhub.get_news(ticker, days_back=7),
        finnhub.get_earnings_calendar(earnings_from, earnings_to),
        finnhub.get_candles(ticker, days=60),
        finnhub.get_recommendation_trends(ticker),
        finnhub.get_insider_transactions(ticker),
        get_reddit_sentiment(ticker),
        get_unusual_options(ticker),
        get_earnings_intel(ticker),
        return_exceptions=True,
    )

    def safe(v, default):
        return default if isinstance(v, Exception) else v

    quote = safe(quote, {})
    profile = safe(profile, {})
    financials = safe(financials, {})
    news = safe(news, [])
    earnings = safe(earnings, [])
    candles = safe(candles, {})
    rec_trends = safe(rec_trends, {})
    insider_txns = safe(insider_txns, [])
    reddit_raw = safe(reddit_raw, {})
    options_raw = safe(options_raw, {})
    earnings_raw = safe(earnings_raw, {})

    # ── Earnings check ──────────────────────────────────────────────────────
    has_earnings = any(
        e.get("symbol", "").upper() == ticker.upper() for e in earnings
    )
    earnings_date = next(
        (e["date"] for e in earnings if e.get("symbol", "").upper() == ticker.upper()),
        None,
    )

    # ── Technical indicators from candle data ────────────────────────────────
    closes = candles.get("closes", [])
    volumes = candles.get("volumes", [])
    technicals: Optional[TechnicalIndicators] = None
    if len(closes) >= 20:
        macd_val, macd_sig, macd_hist = calc_macd(closes)
        sma20 = calc_sma(closes, 20)
        sma50 = calc_sma(closes, 50)
        price = quote.get("price") or (closes[-1] if closes else None)
        price_vs_sma20 = (
            round((price - sma20) / sma20 * 100, 2)
            if price and sma20
            else None
        )
        high_52w = financials.get("52w_high") or (max(candles.get("highs", [])) if candles.get("highs") else None)
        low_52w = financials.get("52w_low") or (min(candles.get("lows", [])) if candles.get("lows") else None)
        technicals = TechnicalIndicators(
            rsi_14=calc_rsi(closes),
            macd=macd_val,
            macd_signal=macd_sig,
            macd_histogram=macd_hist,
            sma_20=sma20,
            sma_50=sma50,
            price_vs_sma20_pct=price_vs_sma20,
            bollinger_position=calc_bollinger_position(closes),
            w52_position=(
                calc_52w_position(price, low_52w, high_52w)
                if price and high_52w and low_52w
                else None
            ),
            volume_ratio=calc_volume_ratio(volumes) if volumes else None,
        )

    # ── Analyst sentiment ────────────────────────────────────────────────────
    analyst_sentiment: Optional[AnalystSentiment] = None
    if rec_trends:
        analyst_sentiment = AnalystSentiment(**rec_trends)

    # ── Insider transactions ─────────────────────────────────────────────────
    insider_list = [InsiderTransaction(**t) for t in insider_txns] if insider_txns else []

    # ── Alt-data models ──────────────────────────────────────────────────────
    reddit_signal = RedditSignal(**reddit_raw) if reddit_raw else None
    options_flow = OptionsFlow(**options_raw) if options_raw else None
    earnings_intel = EarningsIntel(**earnings_raw) if earnings_raw else None

    # ── Sources list ────────────────────────────────────────────────────────
    sources = [
        SourceItem(type="FINANCIAL", provider="FINNHUB", title=f"{ticker} quote + financials", published_at=today),
        SourceItem(type="PROFILE", provider="FINNHUB", title=f"{ticker} company profile", published_at=today),
    ]
    if technicals:
        sources.append(SourceItem(type="TECHNICAL", provider="FINNHUB", title=f"{ticker} price candles (60d)", published_at=today))
    if analyst_sentiment:
        sources.append(SourceItem(type="ANALYST", provider="FINNHUB", title=f"{ticker} analyst recommendations", published_at=today))
    if reddit_signal and reddit_signal.mention_count > 0:
        sources.append(SourceItem(type="NEWS", provider="REDDIT", title=f"{ticker} Reddit mentions ({reddit_signal.mention_count})", published_at=today))
    for item in news[:5]:
        sources.append(
            SourceItem(
                type="NEWS",
                provider="FINNHUB",
                title=item.get("headline", "News"),
                url=item.get("url"),
                published_at=str(item.get("datetime", "")),
            )
        )

    return DataContext(
        ticker=ticker,
        price=quote.get("price"),
        change_pct=quote.get("change_pct"),
        company_name=profile.get("name", ticker),
        sector=profile.get("sector", ""),
        market_cap=financials.get("market_cap"),
        market_cap_tier=financials.get("market_cap_tier", "LARGE"),
        pe_ratio=financials.get("pe_ratio"),
        high_52w=financials.get("52w_high"),
        low_52w=financials.get("52w_low"),
        news=news[:7],
        has_upcoming_earnings=has_earnings,
        earnings_date=earnings_date,
        sources=sources,
        technicals=technicals,
        analyst_sentiment=analyst_sentiment,
        insider_transactions=insider_list,
        reddit=reddit_signal,
        options_flow=options_flow,
        earnings_intel=earnings_intel,
    )


async def run_concept_cot(
    data: DataContext, agent_config: dict
) -> ConceptAnalysis:
    """Step 2: GPT-4o identifies signals and direction."""
    news_headlines = "\n".join(
        f"- {n.get('headline','')}" for n in data.news[:5]
    )

    # ── Technical indicators block ──────────────────────────────────────────
    tech = data.technicals
    if tech:
        rsi_str = f"{tech.rsi_14:.1f}" if tech.rsi_14 is not None else "N/A"
        macd_str = (
            f"MACD {tech.macd:+.3f} / Signal {tech.macd_signal:+.3f} / Hist {tech.macd_histogram:+.3f}"
            if tech.macd is not None else "N/A"
        )
        sma_str = (
            f"SMA20={tech.sma_20:.2f} ({tech.price_vs_sma20_pct:+.1f}% vs price)"
            if tech.sma_20 is not None else "N/A"
        )
        boll_str = f"{tech.bollinger_position:.0f}/100" if tech.bollinger_position is not None else "N/A"
        w52_str = f"{tech.w52_position:.0f}% of 52w range" if tech.w52_position is not None else "N/A"
        vol_str = f"{tech.volume_ratio:.2f}x avg" if tech.volume_ratio is not None else "N/A"
        technicals_block = f"""RSI-14: {rsi_str}
MACD: {macd_str}
SMA20: {sma_str}
Bollinger position: {boll_str}
52-week position: {w52_str}
Volume ratio (vs 20d avg): {vol_str}"""
    else:
        technicals_block = "Not available"

    # ── Analyst sentiment block ──────────────────────────────────────────────
    sent = data.analyst_sentiment
    if sent and sent.total_analysts > 0:
        analyst_block = (
            f"{sent.consensus} ({sent.strong_buy + sent.buy} buy / "
            f"{sent.hold} hold / {sent.sell + sent.strong_sell} sell — "
            f"{sent.total_analysts} analysts)"
        )
    else:
        analyst_block = "No data"

    # ── Insider activity block ───────────────────────────────────────────────
    if data.insider_transactions:
        buys = sum(1 for t in data.insider_transactions if t.type == "BUY")
        sells = sum(1 for t in data.insider_transactions if t.type == "SELL")
        insider_block = f"{buys} insider buys, {sells} insider sells (last 90 days)"
    else:
        insider_block = "No recent insider activity"

    # ── Alt-data blocks ──────────────────────────────────────────────────────
    reddit_block = ""
    if data.reddit and data.reddit.mention_count > 0:
        sentiment_label = (
            "bullish" if data.reddit.sentiment_score > 0.1
            else "bearish" if data.reddit.sentiment_score < -0.1
            else "neutral"
        )
        reddit_block = (
            f"\nReddit sentiment: {data.reddit.mention_count} mentions, "
            f"score={data.reddit.total_score}, sentiment={sentiment_label} "
            f"({data.reddit.sentiment_score:+.2f})"
            + (", TRENDING" if data.reddit.trending else "")
        )

    options_block = ""
    if data.options_flow and data.options_flow.total_volume > 0:
        options_block = (
            f"\nOptions flow: P/C ratio={data.options_flow.put_call_ratio}, "
            f"call vol={data.options_flow.call_volume:,}, "
            f"put vol={data.options_flow.put_volume:,}"
        )
        if data.options_flow.has_unusual:
            top = data.options_flow.unusual_contracts[0]
            options_block += (
                f", UNUSUAL: {top.get('type')} {top.get('moneyness')} "
                f"strike=${top.get('strike')} vol={top.get('volume'):,} "
                f"premium=${top.get('premium_usd', 0):,.0f}"
            )

    earnings_block = ""
    if data.earnings_intel and data.earnings_intel.quarters_analyzed > 0:
        ei = data.earnings_intel
        earnings_block = (
            f"\nEarnings track record: beat rate={ei.beat_rate}% "
            f"avg surprise={ei.avg_surprise_pct:+.1f}% "
            f"over {ei.quarters_analyzed} quarters"
        )
        if ei.next_eps_estimate is not None:
            earnings_block += f", next EPS est=${ei.next_eps_estimate:.2f}"
    # ─────────────────────────────────────────────────────────────────────────

    prompt = f"""Stock: {data.ticker} ({data.company_name})
Sector: {data.sector}
Price: ${data.price} ({data.change_pct:+.2f}% today)
Market Cap: ${data.market_cap:.0f}M ({data.market_cap_tier})
P/E: {data.pe_ratio}
52-week range: ${data.low_52w} – ${data.high_52w}
Upcoming earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}

Technical Indicators:
{technicals_block}

Analyst Consensus: {analyst_block}
Insider Activity: {insider_block}

Recent news:
{news_headlines or 'None'}{reddit_block}{options_block}{earnings_block}

Direction bias allowed: {agent_config.get('directionBias', 'BOTH')}"""

    strategy_instructions = agent_config.get("strategyInstructions")
    if strategy_instructions:
        prompt += f"\n\nAnalyst Strategy Instructions:\n{strategy_instructions}"

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _CONCEPT_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=600,
    )

    raw = json.loads(response.choices[0].message.content)
    return ConceptAnalysis(**raw)


async def run_thesis_cot(
    data: DataContext,
    concept: ConceptAnalysis,
    total_tokens: list,
) -> ThesisOutput:
    """Step 3: GPT-4o structured thesis synthesis."""
    tech = data.technicals
    tech_summary = ""
    if tech:
        parts = []
        if tech.rsi_14 is not None:
            parts.append(f"RSI-14={tech.rsi_14:.1f}")
        if tech.macd_histogram is not None:
            parts.append(f"MACD hist={tech.macd_histogram:+.3f}")
        if tech.price_vs_sma20_pct is not None:
            parts.append(f"{tech.price_vs_sma20_pct:+.1f}% vs SMA20")
        if tech.w52_position is not None:
            parts.append(f"{tech.w52_position:.0f}% of 52w range")
        tech_summary = " | ".join(parts)

    sent = data.analyst_sentiment
    analyst_line = (
        f"{sent.consensus} consensus ({sent.strong_buy + sent.buy} buy / "
        f"{sent.hold} hold / {sent.sell + sent.strong_sell} sell)"
        if sent and sent.total_analysts > 0
        else "No analyst data"
    )

    prompt = f"""Generate a full trade thesis for:
Ticker: {data.ticker} — {data.company_name}
Direction: {concept.direction}
Hold Duration: {concept.hold_duration}
Signals: {', '.join(concept.signal_types)}
Current Price: ${data.price}
52-week High: ${data.high_52w} | Low: ${data.low_52w}
Initial Confidence: {concept.initial_confidence}/100
Analyst Notes: {concept.reasoning_notes}
Upcoming Earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}
Technicals: {tech_summary or 'Not available'}
Analyst Consensus: {analyst_line}
P/E: {data.pe_ratio} | Sector: {data.sector}"""

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _THESIS_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=1024,
    )

    usage = response.usage
    if usage:
        total_tokens[0] += usage.total_tokens
        logger.info(
            "thesis_cot tokens: input=%d output=%d total=%d",
            usage.prompt_tokens,
            usage.completion_tokens,
            usage.total_tokens,
        )

    raw = json.loads(response.choices[0].message.content)

    return ThesisOutput(
        ticker=data.ticker,
        direction=concept.direction,
        hold_duration=concept.hold_duration,
        confidence_score=raw.get("confidence_score", concept.initial_confidence),
        reasoning_summary=raw.get("reasoning_summary", ""),
        thesis_bullets=raw.get("thesis_bullets", []),
        risk_flags=raw.get("risk_flags", []),
        signal_types=concept.signal_types,
        sector=data.sector or None,
        entry_price=raw.get("entry_price") or data.price,
        target_price=raw.get("target_price"),
        stop_loss=raw.get("stop_loss"),
        sources_used=data.sources,
        model_used="gpt-4o",
    )


async def run_multi_agent_pipeline(
    ticker: str,
    agent_config: dict,
    finnhub: Optional[FinnhubService] = None,
) -> tuple[ThesisOutput, int]:
    """
    TradingAgents pipeline: Data-CoT → parallel Bull+Bear analysts → Fund Manager.

    Architecture:
      1. run_data_cot        — gather market data
      2. run_bull_analysis   ─┐ parallel
         run_bear_analysis   ─┘
      3. run_fund_manager    — debate synthesis → final ThesisOutput

    Returns (ThesisOutput, total_tokens_used).
    Falls back to a PASS thesis on any unrecoverable error.
    """
    from services.agents.bull import run_bull_analysis
    from services.agents.bear import run_bear_analysis
    from services.agents.fund_manager import run_fund_manager

    if finnhub is None:
        finnhub = FinnhubService()

    total_tokens = [0]

    try:
        # Step 1: data collection
        data = await run_data_cot(ticker, finnhub)
        logger.info("%s multi-agent: data collected", ticker)

        # Step 2: parallel bull + bear analysis
        bull_result, bear_result = await asyncio.gather(
            run_bull_analysis(data),
            run_bear_analysis(data),
            return_exceptions=True,
        )

        # Graceful fallback if one side errors
        if isinstance(bull_result, Exception):
            logger.warning("%s bull analyst error: %s", ticker, bull_result)
            bull_result = {
                "analysis": "Data unavailable for bull analysis.",
                "key_signals": [],
                "price_target": data.price,
                "suggested_entry": data.price,
                "confidence": 50,
            }
        if isinstance(bear_result, Exception):
            logger.warning("%s bear analyst error: %s", ticker, bear_result)
            bear_result = {
                "analysis": "Data unavailable for bear analysis.",
                "key_risks": [],
                "worst_case_target": data.price,
                "stop_trigger": data.price,
                "confidence": 50,
            }

        logger.info(
            "%s multi-agent: bull_conf=%s bear_conf=%s",
            ticker,
            bull_result.get("confidence"),
            bear_result.get("confidence"),
        )

        # Step 3: fund manager synthesis
        thesis = await run_fund_manager(data, bull_result, bear_result, total_tokens)
        logger.info(
            "%s multi-agent final: direction=%s confidence=%d",
            ticker, thesis.direction, thesis.confidence_score,
        )
        return thesis, total_tokens[0]

    except Exception as exc:
        logger.exception("Multi-agent pipeline error for %s: %s", ticker, exc)
        return (
            ThesisOutput(
                ticker=ticker,
                direction="PASS",
                hold_duration="SWING",
                confidence_score=0,
                reasoning_summary=f"Multi-agent pipeline error: {exc}",
                thesis_bullets=[],
                risk_flags=["Pipeline error — review logs"],
                signal_types=[],
                model_used="gpt-4o (multi-agent)",
            ),
            total_tokens[0],
        )


async def run_full_pipeline(
    ticker: str,
    agent_config: dict,
    finnhub: Optional[FinnhubService] = None,
) -> tuple[ThesisOutput, int]:
    """
    Orchestrate Data-CoT → Concept-CoT → Thesis-CoT.

    Returns (ThesisOutput, total_tokens_used).
    On any error, returns a PASS thesis rather than raising.

    NOTE: minConfidence is NOT applied here — research always runs to completion.
    The confidence gate lives at the trade execution layer (morning-research.ts),
    which decides whether to place an Alpaca order based on thesis.confidence_score.
    """
    if finnhub is None:
        finnhub = FinnhubService()

    total_tokens = [0]

    try:
        data = await run_data_cot(ticker, finnhub)

        concept = await run_concept_cot(data, agent_config)
        logger.info(
            "%s concept: direction=%s confidence=%d",
            ticker, concept.direction, concept.initial_confidence,
        )

        # Only skip Thesis-CoT if the signal is explicitly PASS (no trade to build).
        # Low confidence alone does NOT short-circuit — let Thesis-CoT do its job
        # and produce a full thesis; the caller decides whether to act on it.
        if concept.direction == "PASS":
            return (
                ThesisOutput(
                    ticker=ticker,
                    direction="PASS",
                    hold_duration=concept.hold_duration,
                    confidence_score=concept.initial_confidence,
                    reasoning_summary=concept.pass_reason or concept.reasoning_notes,
                    thesis_bullets=[],
                    risk_flags=[],
                    signal_types=concept.signal_types,
                    sector=data.sector or None,
                    sources_used=data.sources,
                    model_used="gpt-4o",
                ),
                total_tokens[0],
            )

        thesis = await run_thesis_cot(data, concept, total_tokens)
        return thesis, total_tokens[0]

    except Exception as exc:
        logger.exception("Pipeline error for %s: %s", ticker, exc)
        return (
            ThesisOutput(
                ticker=ticker,
                direction="PASS",
                hold_duration="SWING",
                confidence_score=0,
                reasoning_summary=f"Pipeline error: {exc}",
                thesis_bullets=[],
                risk_flags=["Pipeline error — review logs"],
                signal_types=[],
                model_used="gpt-4o",
            ),
            total_tokens[0],
        )
