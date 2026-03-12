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
from typing import Callable, Optional

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
Factor in the market context (regime, sector rotation) when provided — do not evaluate
stocks in a vacuum.

Return a JSON object with these exact fields:
{
  "direction": "LONG" | "SHORT" | "PASS",
  "hold_duration": "DAY" | "SWING" | "POSITION",
  "signal_types": ["EARNINGS_BEAT","MOMENTUM","SECTOR_ROTATION","MEAN_REVERSION","BREAKOUT","NEWS_CATALYST","MACRO","TECHNICAL","INSIDER","OTHER"],
  "initial_confidence": <integer 0-100>,
  "reasoning_notes": "<4-6 sentence analysis covering price action, technicals, fundamentals, catalysts, and how market context affects this setup>",
  "pass_reason": "<specific reason if PASS, else null>"
}

Guidelines:
- LONG/SHORT: commit when there is any identifiable signal or trend. Confidence 40-100.
- PASS: only when data is genuinely unavailable, the ticker is invalid, or signals are
  directly contradictory with no clear edge.
- hold_duration: DAY for intraday catalysts, SWING for 2-10 day setups, POSITION for
  multi-week fundamental themes.
- signal_types: list ALL applicable signals.

Confidence calibration:
- 80+ means you would bet your own money — multiple independent signals strongly aligned.
- 60-70 means the setup is there but something could go wrong.
- Below 50 means you see the case but wouldn't act on it.
- Most picks should land between 55-75.

Signal-based conviction scoring:
- Count independent confirming signals (technical, fundamental, catalyst, sentiment).
- 4+ aligned signals = high conviction (75+).
- 2-3 aligned signals = medium conviction (55-74).
- 1 signal alone = low conviction (<55).

Technical interpretation:
- RSI < 35 = oversold bounce potential, RSI > 70 = overbought caution.
- MACD histogram direction confirms momentum.
- Use analyst consensus and insider activity as supporting signals.
- reasoning_notes: be specific — quote RSI values, price vs SMA, analyst counts, news.
- If market context shows volatile regime or VIX > 25, reduce confidence by 5-10 pts."""

_THESIS_SYSTEM = """You are a senior equity analyst at a hedge fund generating a formal trade thesis.
You write with conviction. Every recommendation includes specific, actionable execution details.

Return a JSON object with these exact fields:
{
  "reasoning_summary": "<3-4 paragraph analysis: (1) situation overview + market context, (2) catalysts with specific dates/timeframes, (3) risk/reward setup with sector comparison, (4) execution rationale>",
  "thesis_bullets": ["<bullet 1>", "<bullet 2>", "<bullet 3>", "<bullet 4>", "<bullet 5>"],
  "risk_flags": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "invalidation": "<1-2 sentences: specific conditions that would make this thesis wrong — not generic risks, but concrete price/event triggers>",
  "sector_alternative": "<ticker and 1-sentence comparison to at least one alternative in the same sector>",
  "catalyst": "<specific catalyst with date or timeframe, e.g. 'Q1 earnings report on Mar 14' or 'FDA decision expected within 2 weeks'>",
  "entry_price": <float — use current price if no better entry>,
  "target_price": <float — required, calculate based on setup>,
  "stop_loss": <float — required, use technical level>,
  "confidence_score": <integer 0-100>,
  "order_type": "LIMIT" | "MARKET",
  "suggested_shares": <integer — recommend share count for a $10,000 position>,
  "sources": [{"type": "<TECHNICAL|NEWS|EARNINGS|INSIDER|REDDIT|OPTIONS|ANALYST|MACRO>", "provider": "<source>", "title": "<what it says>", "relevance": <float 0-1>, "sentiment": "bullish" | "bearish" | "neutral"}]
}

Requirements:
- thesis_bullets: exactly 4-5 specific, actionable bullets with numbers where possible.
- risk_flags: exactly 2-3 specific risks.
- invalidation: must be a concrete trigger (e.g. "Close below $150 SMA20 support" or
  "If Q1 revenue misses by >5%"). NOT generic platitudes.
- sector_alternative: compare to at least one peer in the same sector. Why this stock
  over the alternative?
- catalyst: must include a specific date or timeframe. "Upcoming earnings" alone is insufficient —
  say "Q1 earnings on Mar 14 with consensus EPS $2.15".
- entry_price/target_price/stop_loss: must be exact floats, never null, never ranges.
  Use current price + logical offsets based on technicals.
- order_type: LIMIT for entries near support/resistance, MARKET for momentum/catalyst plays.
- suggested_shares: calculate for a $10,000 position size. Round to whole number.
- sources: list each data source that informed the thesis with type, relevance (0-1),
  and directional sentiment.

Confidence calibration:
- 80+ means you would bet your own money. Multiple independent signals strongly aligned.
- 60-70 means the setup is there but something could go wrong.
- Below 50 means you see the bull/bear case but wouldn't act on it.
- Most picks should be 55-75. Count aligned signals: 4+ = 75+, 2-3 = 55-74, 1 = <55.
- Price targets must be numbers only (no $ or currency symbols)."""


async def run_data_cot(
    ticker: str,
    finnhub: FinnhubService,
    emit_fn: Optional[Callable] = None,
) -> DataContext:
    """Step 1: Parallel Finnhub + alt-data collection — price, fundamentals, news,
    candles (for technicals), analyst recommendations, insider transactions,
    Reddit sentiment, unusual options flow, and earnings intelligence.

    When emit_fn is provided (streaming mode), emits a `source_fetched` event
    as each data source completes, giving the UI live tool-call feedback.
    """
    from services.reddit import get_reddit_sentiment
    from services.options_flow import get_unusual_options
    from services.earnings_intel import get_earnings_intel

    today = date.today().isoformat()
    earnings_from = today
    earnings_to = (date.today() + timedelta(days=7)).isoformat()

    # ── Per-source fetch wrapper — emits SSE event on completion ──────────
    async def _fetch(label: str, provider: str, coro, default, summary_fn=None):
        try:
            result = await coro
        except Exception:
            result = default
        if emit_fn:
            summary = ""
            if summary_fn and result and result != default:
                try:
                    summary = summary_fn(result)
                except Exception:
                    summary = ""
            await emit_fn({
                "type": "source_fetched",
                "ticker": ticker,
                "provider": provider,
                "label": label,
                "summary": summary or "",
            })
        return result

    (
        quote, profile, financials, news, earnings,
        candles, rec_trends, insider_txns,
        reddit_raw, options_raw, earnings_raw,
    ) = await asyncio.gather(
        _fetch(
            "Fetching price quote", "Finnhub",
            finnhub.get_quote(ticker), {},
            lambda r: f"${r.get('price', '?')} ({r.get('change_pct', 0):+.1f}%)" if r.get("price") else "",
        ),
        _fetch(
            "Fetching company profile", "Finnhub",
            finnhub.get_company_profile(ticker), {},
            lambda r: r.get("name", "") or "",
        ),
        _fetch(
            "Fetching financials", "Finnhub",
            finnhub.get_basic_financials(ticker), {},
            lambda r: f"P/E {r.get('pe_ratio', 'N/A')}, Cap: {r.get('market_cap_tier', 'N/A')}",
        ),
        _fetch(
            "Fetching news", "Finnhub",
            finnhub.get_news(ticker, days_back=7), [],
            lambda r: f"{len(r)} article{'s' if len(r) != 1 else ''}" if r else "No news",
        ),
        _fetch(
            "Checking earnings calendar", "Finnhub",
            finnhub.get_earnings_calendar(earnings_from, earnings_to), [],
        ),
        _fetch(
            "Fetching price candles (60d)", "Finnhub",
            finnhub.get_candles(ticker, days=60), {},
        ),
        _fetch(
            "Fetching analyst recommendations", "Finnhub",
            finnhub.get_recommendation_trends(ticker), {},
            lambda r: f"{r.get('total_analysts', 0)} analysts" if r.get("total_analysts") else "",
        ),
        _fetch(
            "Checking insider transactions", "Finnhub",
            finnhub.get_insider_transactions(ticker), [],
            lambda r: f"{len(r)} transaction{'s' if len(r) != 1 else ''}" if r else "",
        ),
        _fetch(
            "Checking Reddit sentiment", "Reddit",
            get_reddit_sentiment(ticker), {},
            lambda r: f"{r.get('mention_count', 0)} mentions, sentiment {r.get('sentiment_score', 0):.2f}" if r.get("mention_count") else "",
        ),
        _fetch(
            "Checking options flow", "Options",
            get_unusual_options(ticker), {},
            lambda r: f"P/C ratio {r.get('put_call_ratio', 'N/A')}" if r.get("put_call_ratio") else "",
        ),
        _fetch(
            "Checking earnings intel", "Earnings",
            get_earnings_intel(ticker), {},
            lambda r: f"Beat rate {r.get('beat_rate_pct', 'N/A')}%" if r.get("beat_rate_pct") else "",
        ),
    )

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

    # ── Emit technical_summary event (DAV-123) ────────────────────────────────
    if emit_fn and technicals:
        parts = []
        if technicals.rsi_14 is not None:
            parts.append(f"RSI {technicals.rsi_14:.0f}")
        if technicals.macd_histogram is not None:
            direction = "bullish" if technicals.macd_histogram > 0 else "bearish"
            parts.append(f"MACD {direction}")
        if technicals.volume_ratio is not None:
            parts.append(f"volume {technicals.volume_ratio:.1f}x avg")
        if technicals.w52_position is not None:
            parts.append(f"{technicals.w52_position:.0f}% of 52w range")
        await emit_fn({
            "type": "technical_summary",
            "ticker": ticker,
            "summary": ", ".join(parts),
            "rsi": technicals.rsi_14,
            "macd_histogram": technicals.macd_histogram,
            "volume_ratio": technicals.volume_ratio,
            "w52_position": technicals.w52_position,
            "bollinger_position": technicals.bollinger_position,
        })

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
    data: DataContext, agent_config: dict, market_context=None,
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

    # ── Market context block (DAV-121) ──────────────────────────────────────
    market_block = ""
    if market_context:
        market_block = f"""
Market Context:
  Regime: {market_context.regime}
  SPX: {market_context.spx_change_pct or 0:+.2f}% today
  VIX: {market_context.vix_level or 'N/A'} ({market_context.vix_change_pct or 0:+.2f}%)
  Sector rotation: {market_context.sector_rotation_notes or 'N/A'}
  Today's approach: {market_context.approach_summary or 'N/A'}
"""

    prompt = f"""Stock: {data.ticker} ({data.company_name})
Sector: {data.sector}
Price: ${data.price} ({data.change_pct:+.2f}% today)
Market Cap: ${data.market_cap:.0f}M ({data.market_cap_tier})
P/E: {data.pe_ratio}
52-week range: ${data.low_52w} – ${data.high_52w}
Upcoming earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}
{market_block}
Technical Indicators:
{technicals_block}

Analyst Consensus: {analyst_block}
Insider Activity: {insider_block}

Recent news:
{news_headlines or 'None'}{reddit_block}{options_block}{earnings_block}

Direction bias allowed: {agent_config.get('directionBias', 'BOTH')}"""

    # ── Inject analyst strategy prompt if available ──
    analyst_prompt = agent_config.get("analystPrompt") or agent_config.get("analyst_prompt")
    system_content = _CONCEPT_SYSTEM
    if analyst_prompt:
        analyst_name = agent_config.get("analystName", agent_config.get("analyst_name", "Analyst"))
        system_content = f"""{_CONCEPT_SYSTEM}

--- ANALYST STRATEGY INSTRUCTIONS ({analyst_name}) ---
The following is the analyst's strategy document. Use it to guide your signal selection,
direction bias, confidence calibration, and what patterns/setups to prioritize:

{analyst_prompt}
--- END STRATEGY INSTRUCTIONS ---"""

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_content},
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
    market_context=None,  # DAV-121/124
    agent_config: dict | None = None,
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
        if tech.volume_ratio is not None:
            parts.append(f"Volume {tech.volume_ratio:.1f}x avg")
        tech_summary = " | ".join(parts)

    sent = data.analyst_sentiment
    analyst_line = (
        f"{sent.consensus} consensus ({sent.strong_buy + sent.buy} buy / "
        f"{sent.hold} hold / {sent.sell + sent.strong_sell} sell)"
        if sent and sent.total_analysts > 0
        else "No analyst data"
    )

    # Market context block for thesis (DAV-124)
    market_thesis_block = ""
    if market_context:
        market_thesis_block = f"""
Market Context:
  Regime: {market_context.regime}
  SPX: {market_context.spx_change_pct or 0:+.2f}% | VIX: {market_context.vix_level or 'N/A'}
  Sector rotation: {market_context.sector_rotation_notes or 'N/A'}"""

    # Alt-data summary for thesis (DAV-124)
    alt_data_lines = []
    if data.reddit and data.reddit.mention_count > 0:
        sentiment_label = "bullish" if data.reddit.sentiment_score > 0.1 else "bearish" if data.reddit.sentiment_score < -0.1 else "neutral"
        alt_data_lines.append(f"Reddit: {data.reddit.mention_count} mentions, {sentiment_label} ({data.reddit.sentiment_score:+.2f})")
    if data.options_flow and data.options_flow.has_unusual:
        alt_data_lines.append(f"Options: unusual activity, P/C ratio {data.options_flow.put_call_ratio}")
    if data.earnings_intel and data.earnings_intel.quarters_analyzed > 0:
        alt_data_lines.append(f"Earnings: {data.earnings_intel.beat_rate}% beat rate over {data.earnings_intel.quarters_analyzed}Q")
    alt_data_block = "\n".join(alt_data_lines) if alt_data_lines else "No alt-data"

    prompt = f"""Generate a full trade thesis for:
Ticker: {data.ticker} — {data.company_name}
Direction: {concept.direction}
Hold Duration: {concept.hold_duration}
Signals ({len(concept.signal_types)} identified): {', '.join(concept.signal_types)}
Current Price: ${data.price}
52-week High: ${data.high_52w} | Low: ${data.low_52w}
Initial Confidence: {concept.initial_confidence}/100
Analyst Notes: {concept.reasoning_notes}
Upcoming Earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}
Technicals: {tech_summary or 'Not available'}
Analyst Consensus: {analyst_line}
P/E: {data.pe_ratio} | Sector: {data.sector}
{market_thesis_block}
Alt-Data:
{alt_data_block}

Remember: You must include invalidation conditions, a sector alternative comparison,
a dated catalyst, exact execution details (share count for $10K, order type),
and a sources array with relevance scores."""

    # ── Inject analyst strategy prompt if available ──
    thesis_system = _THESIS_SYSTEM
    if agent_config:
        analyst_prompt = agent_config.get("analystPrompt") or agent_config.get("analyst_prompt")
        if analyst_prompt:
            analyst_name = agent_config.get("analystName", agent_config.get("analyst_name", "Analyst"))
            thesis_system = f"""{_THESIS_SYSTEM}

--- ANALYST STRATEGY INSTRUCTIONS ({analyst_name}) ---
Use the analyst's strategy to inform thesis quality, risk framing, entry/exit levels,
and which catalysts to emphasize:

{analyst_prompt}
--- END STRATEGY INSTRUCTIONS ---"""

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": thesis_system},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=1500,
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
        invalidation=raw.get("invalidation"),
        sector_alternative=raw.get("sector_alternative"),
        catalyst=raw.get("catalyst"),
        order_type=raw.get("order_type"),
        suggested_shares=raw.get("suggested_shares"),
        thesis_sources=raw.get("sources", []),
    )


# ── DAV-125: Combined Concept+Thesis Streaming ──────────────────────────────

_COMBINED_SYSTEM = """You are a senior equity analyst at a hedge fund. You will analyze a stock
and produce BOTH a directional assessment AND a full trade thesis in a single response.

IMPORTANT: Structure your response in two clear sections:

SECTION 1 — REASONING (plain text, thinking out loud):
Write 3-5 paragraphs analyzing the stock. Cover:
- Market context and how it affects this setup
- Technical picture (quote specific RSI, MACD, SMA values)
- Catalysts and their timing
- Risk factors and what could go wrong
- Your directional conclusion and conviction level

SECTION 2 — STRUCTURED OUTPUT (JSON block):
After your reasoning, output a JSON block wrapped in ```json ... ``` markers with these fields:
{
  "direction": "LONG" | "SHORT" | "PASS",
  "hold_duration": "DAY" | "SWING" | "POSITION",
  "signal_types": ["<signal1>", "<signal2>"],
  "reasoning_summary": "<3-4 paragraph analysis>",
  "thesis_bullets": ["<bullet 1>", "<bullet 2>", "<bullet 3>", "<bullet 4>", "<bullet 5>"],
  "risk_flags": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "invalidation": "<specific conditions that would make this thesis wrong>",
  "sector_alternative": "<comparison to a sector peer>",
  "catalyst": "<specific catalyst with date/timeframe>",
  "entry_price": <float>,
  "target_price": <float>,
  "stop_loss": <float>,
  "confidence_score": <integer 0-100>,
  "order_type": "LIMIT" | "MARKET",
  "suggested_shares": <integer for $10K position>,
  "sources": [{"type": "<type>", "provider": "<provider>", "title": "<title>", "relevance": <0-1>, "sentiment": "bullish"|"bearish"|"neutral"}]
}

Confidence calibration:
- 80+ = you would bet your own money, 4+ aligned independent signals.
- 60-70 = setup is there but something could go wrong, 2-3 signals.
- Below 50 = you see the case but wouldn't act, 1 signal.
- Most picks: 55-75.

If PASS: set confidence <40, empty bullets/risks/sources, explain in reasoning_summary."""


async def run_combined_concept_thesis_streaming(
    data: DataContext,
    agent_config: dict,
    emit_fn: Callable,
    total_tokens: list,
    market_context=None,
) -> ThesisOutput:
    """DAV-125: Single GPT-4o call replacing Concept-CoT + Thesis-CoT.

    Streams the reasoning section as `thesis_reasoning` events (visible thinking),
    then parses the structured JSON and emits `thesis_complete`.

    Returns ThesisOutput.
    """
    # Build the full data prompt (same data as concept + thesis combined)
    tech = data.technicals
    technicals_block = "Not available"
    if tech:
        parts = []
        if tech.rsi_14 is not None:
            parts.append(f"RSI-14: {tech.rsi_14:.1f}")
        if tech.macd is not None:
            parts.append(f"MACD {tech.macd:+.3f} / Signal {tech.macd_signal:+.3f} / Hist {tech.macd_histogram:+.3f}")
        if tech.sma_20 is not None:
            parts.append(f"SMA20={tech.sma_20:.2f} ({tech.price_vs_sma20_pct:+.1f}% vs price)")
        if tech.bollinger_position is not None:
            parts.append(f"Bollinger: {tech.bollinger_position:.0f}/100")
        if tech.w52_position is not None:
            parts.append(f"52w position: {tech.w52_position:.0f}%")
        if tech.volume_ratio is not None:
            parts.append(f"Volume: {tech.volume_ratio:.2f}x avg")
        technicals_block = "\n".join(parts)

    news_headlines = "\n".join(f"- {n.get('headline', '')}" for n in data.news[:5])

    sent = data.analyst_sentiment
    analyst_block = (
        f"{sent.consensus} ({sent.strong_buy + sent.buy} buy / "
        f"{sent.hold} hold / {sent.sell + sent.strong_sell} sell — "
        f"{sent.total_analysts} analysts)"
        if sent and sent.total_analysts > 0 else "No data"
    )

    insider_block = "No recent insider activity"
    if data.insider_transactions:
        buys = sum(1 for t in data.insider_transactions if t.type == "BUY")
        sells = sum(1 for t in data.insider_transactions if t.type == "SELL")
        insider_block = f"{buys} insider buys, {sells} insider sells (last 90 days)"

    # Alt-data
    alt_lines = []
    if data.reddit and data.reddit.mention_count > 0:
        label = "bullish" if data.reddit.sentiment_score > 0.1 else "bearish" if data.reddit.sentiment_score < -0.1 else "neutral"
        alt_lines.append(f"Reddit: {data.reddit.mention_count} mentions, {label} ({data.reddit.sentiment_score:+.2f})")
    if data.options_flow and data.options_flow.total_volume > 0:
        alt_lines.append(f"Options: P/C={data.options_flow.put_call_ratio}, {'UNUSUAL activity' if data.options_flow.has_unusual else 'normal flow'}")
    if data.earnings_intel and data.earnings_intel.quarters_analyzed > 0:
        ei = data.earnings_intel
        alt_lines.append(f"Earnings: {ei.beat_rate}% beat rate, avg surprise {ei.avg_surprise_pct:+.1f}%")
    alt_block = "\n".join(alt_lines) if alt_lines else "None"

    market_block = ""
    if market_context:
        market_block = f"""
Market Context:
  Regime: {market_context.regime}
  SPX: {market_context.spx_change_pct or 0:+.2f}% today
  VIX: {market_context.vix_level or 'N/A'} ({market_context.vix_change_pct or 0:+.2f}%)
  Sector rotation: {market_context.sector_rotation_notes or 'N/A'}
  Approach: {market_context.approach_summary or 'N/A'}
"""

    prompt = f"""Analyze this stock and produce your reasoning + structured thesis:

Stock: {data.ticker} ({data.company_name})
Sector: {data.sector}
Price: ${data.price} ({data.change_pct:+.2f}% today)
Market Cap: ${data.market_cap:.0f}M ({data.market_cap_tier})
P/E: {data.pe_ratio}
52-week range: ${data.low_52w} – ${data.high_52w}
Upcoming earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}
{market_block}
Technical Indicators:
{technicals_block}

Analyst Consensus: {analyst_block}
Insider Activity: {insider_block}

Recent news:
{news_headlines or 'None'}

Alt-Data:
{alt_block}

Direction bias allowed: {agent_config.get('directionBias', 'BOTH')}

Think through the analysis step by step, then provide the structured JSON output."""

    # ── Inject analyst strategy prompt if available ──
    combined_system = _COMBINED_SYSTEM
    analyst_prompt = agent_config.get("analystPrompt") or agent_config.get("analyst_prompt")
    if analyst_prompt:
        analyst_name = agent_config.get("analystName", agent_config.get("analyst_name", "Analyst"))
        combined_system = f"""{_COMBINED_SYSTEM}

--- ANALYST STRATEGY INSTRUCTIONS ({analyst_name}) ---
Use the analyst's strategy to guide your signal selection, direction bias, confidence
calibration, risk framing, and which catalysts to emphasize:

{analyst_prompt}
--- END STRATEGY INSTRUCTIONS ---"""

    # Stream the response — emit reasoning tokens, then parse JSON
    reasoning_text = ""
    full_text = ""
    in_json_block = False
    json_text = ""

    async with _openai.chat.completions.stream(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": combined_system},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
        max_tokens=2000,
    ) as stream:
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if not delta:
                continue

            full_text += delta

            # Detect transition to JSON block
            if "```json" in full_text and not in_json_block:
                in_json_block = True
                # Split: everything before ```json is reasoning
                split_idx = full_text.index("```json")
                reasoning_text = full_text[:split_idx].strip()
                json_text = full_text[split_idx + 7:]  # after ```json
                continue

            if in_json_block:
                json_text += delta
            else:
                # Stream reasoning tokens to frontend
                await emit_fn({
                    "type": "thesis_reasoning",
                    "ticker": data.ticker,
                    "text": delta,
                })

    # Clean up JSON text (remove trailing ```)
    if "```" in json_text:
        json_text = json_text[:json_text.rindex("```")].strip()

    # If no JSON block found, try parsing the full text as JSON (fallback)
    if not json_text.strip():
        # Model may have returned pure JSON without markdown fencing
        try:
            raw = json.loads(full_text)
        except Exception:
            # Last resort: return PASS thesis
            return ThesisOutput(
                ticker=data.ticker,
                direction="PASS",
                hold_duration="SWING",
                confidence_score=0,
                reasoning_summary=full_text,
                thesis_bullets=[],
                risk_flags=[],
                signal_types=[],
                sector=data.sector or None,
                sources_used=data.sources,
                model_used="gpt-4o (combined)",
            )
    else:
        try:
            raw = json.loads(json_text)
        except Exception:
            return ThesisOutput(
                ticker=data.ticker,
                direction="PASS",
                hold_duration="SWING",
                confidence_score=0,
                reasoning_summary=reasoning_text or full_text,
                thesis_bullets=[],
                risk_flags=[],
                signal_types=[],
                sector=data.sector or None,
                sources_used=data.sources,
                model_used="gpt-4o (combined)",
            )

    direction = raw.get("direction", "PASS")
    thesis = ThesisOutput(
        ticker=data.ticker,
        direction=direction,
        hold_duration=raw.get("hold_duration", "SWING"),
        confidence_score=raw.get("confidence_score", 50),
        reasoning_summary=raw.get("reasoning_summary", reasoning_text),
        thesis_bullets=raw.get("thesis_bullets", []),
        risk_flags=raw.get("risk_flags", []),
        signal_types=raw.get("signal_types", []),
        sector=data.sector or None,
        entry_price=raw.get("entry_price") or data.price,
        target_price=raw.get("target_price"),
        stop_loss=raw.get("stop_loss"),
        sources_used=data.sources,
        model_used="gpt-4o (combined)",
        invalidation=raw.get("invalidation"),
        sector_alternative=raw.get("sector_alternative"),
        catalyst=raw.get("catalyst"),
        order_type=raw.get("order_type"),
        suggested_shares=raw.get("suggested_shares"),
        thesis_sources=raw.get("sources", []),
    )

    return thesis


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
    market_context=None,  # DAV-121: MarketContext from Phase 1
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

        concept = await run_concept_cot(data, agent_config, market_context=market_context)
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

        thesis = await run_thesis_cot(data, concept, total_tokens, market_context=market_context, agent_config=agent_config)
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


async def run_full_pipeline_streaming(
    ticker: str,
    agent_config: dict,
    emit_fn: Callable,  # async callable: await emit_fn({"type": ..., ...})
    finnhub: Optional[FinnhubService] = None,
    market_context=None,  # DAV-121: MarketContext from Phase 1
) -> tuple:
    """
    Streaming research pipeline per ticker. Emits granular events:

      analyzing          — data fetch starting
      source_fetched     — individual data source completed (from Data-CoT)
      technical_summary  — technicals computed (DAV-123)
      data_ready         — all data collected
      thesis_reasoning   — streamed thinking tokens (DAV-125)
      thesis_complete    — full ThesisOutput ready
      skip               — PASS direction; no thesis written
      ticker_error       — unhandled pipeline exception

    DAV-125: Uses combined concept+thesis streaming call (single GPT-4o call)
    instead of separate Concept-CoT + Thesis-CoT. Falls back to legacy two-call
    approach if combined call fails.
    """
    if finnhub is None:
        finnhub = FinnhubService()

    total_tokens = [0]

    try:
        await emit_fn({"type": "analyzing", "ticker": ticker, "company": ""})

        data = await run_data_cot(ticker, finnhub, emit_fn=emit_fn)

        sources_preview = [
            {"type": s.type, "provider": s.provider, "title": s.title}
            for s in data.sources
        ]

        await emit_fn({
            "type": "data_ready",
            "ticker": ticker,
            "company": data.company_name,
            "price": data.price,
            "sector": data.sector or None,
            "sources": sources_preview,
            "sources_count": len(sources_preview),
        })

        # DAV-125: Combined concept+thesis streaming call
        await emit_fn({
            "type": "thesis_writing",
            "ticker": ticker,
            "direction": "analyzing",
        })

        thesis = await run_combined_concept_thesis_streaming(
            data, agent_config, emit_fn, total_tokens,
            market_context=market_context,
        )

        if thesis.direction == "PASS":
            await emit_fn({
                "type": "skip",
                "ticker": ticker,
                "reason": thesis.reasoning_summary or "No clear tradeable signal identified",
                "confidence": thesis.confidence_score,
            })
        else:
            await emit_fn({
                "type": "thesis_complete",
                "ticker": ticker,
                "thesis": thesis.model_dump(),
            })

        return thesis, total_tokens[0]

    except Exception as exc:
        logger.exception("Streaming pipeline error for %s: %s", ticker, exc)
        try:
            await emit_fn({"type": "ticker_error", "ticker": ticker, "message": str(exc)})
        except Exception:
            pass
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
