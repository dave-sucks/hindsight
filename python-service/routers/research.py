import asyncio
import json
import logging
import os
import re
import time
import uuid
from typing import AsyncGenerator, List

logger = logging.getLogger(__name__)

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from models import RunRequest, RunResponse, ThesisOutput
from services.finrobot import run_data_cot, run_concept_cot, run_thesis_cot
from services.finnhub import FinnhubService
from services.scanner import get_research_candidates

_openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

router = APIRouter()


# ---------------------------------------------------------------------------
# /research/run — batch, non-streaming
# ---------------------------------------------------------------------------

@router.post("/run", response_model=RunResponse)
async def research_run(body: RunRequest):
    started = time.monotonic()
    agent_config = body.agent_config

    tickers = body.tickers
    if not tickers:
        tickers = await get_research_candidates(agent_config)

    sem = asyncio.Semaphore(5)

    use_multi_agent = agent_config.get("pipelineMode") == "MULTI_AGENT"

    async def run_one(ticker: str):
        async with sem:
            try:
                if use_multi_agent:
                    from services.finrobot import run_multi_agent_pipeline
                    pipeline = run_multi_agent_pipeline(ticker, agent_config)
                else:
                    from services.finrobot import run_full_pipeline
                    pipeline = run_full_pipeline(ticker, agent_config)

                return await asyncio.wait_for(pipeline, timeout=90.0)
            except asyncio.TimeoutError:
                return (
                    ThesisOutput(
                        ticker=ticker,
                        direction="PASS",
                        hold_duration="SWING",
                        confidence_score=0,
                        reasoning_summary="Pipeline timed out after 90s",
                        thesis_bullets=[],
                        risk_flags=["Timeout — pipeline took too long"],
                        signal_types=[],
                        model_used="gpt-4o",
                    ),
                    0,
                )

    results = await asyncio.gather(*[run_one(t) for t in tickers])
    theses = [r[0] for r in results]
    total_tokens = sum(r[1] for r in results)
    passed = sum(1 for t in theses if t.direction == "PASS")

    return RunResponse(
        run_id=str(uuid.uuid4()),
        theses=theses,
        tickers_researched=len(theses),
        tickers_passed=passed,
        total_tokens=total_tokens,
        duration_seconds=round(time.monotonic() - started, 2),
        source=body.source,
    )


# ---------------------------------------------------------------------------
# /research/chat — SSE streaming
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    agent_config: dict = {}
    history: List[dict] = []  # [{"role": "user"|"assistant", "content": str}]


def _extract_ticker(message: str) -> str | None:
    """Best-effort ticker extraction from a natural language message."""
    # Match explicit uppercase tickers: "Research NVDA", "AAPL vs MSFT"
    found = re.findall(r"\b([A-Z]{1,5})\b", message)
    # Exclude common English words that look like tickers
    stopwords = {"I", "A", "AI", "OR", "AND", "FOR", "THE", "IN", "OF", "ON",
                 "VS", "AT", "BY", "IS", "IT", "BE", "DO", "GO", "TO"}
    candidates = [t for t in found if t not in stopwords]
    return candidates[0] if candidates else None


_FOLLOWUP_SYSTEM = (
    "You are a quantitative research assistant helping a trader follow up on trade theses. "
    "Answer concisely and specifically, referencing the data in the conversation. "
    "Max 150 words. No filler phrases. If you need to calculate anything (R:R, %, etc.) do it."
)


async def _stream_chat(
    message: str, agent_config: dict, history: list
) -> AsyncGenerator[dict, None]:
    ticker = _extract_ticker(message)

    # ── Conversational follow-up: history exists and no new ticker identified ──
    if history and not ticker:
        messages = [{"role": "system", "content": _FOLLOWUP_SYSTEM}]
        messages.extend(history)
        messages.append({"role": "user", "content": message})

        async with _openai_client.chat.completions.stream(
            model="gpt-4o",
            messages=messages,
            temperature=0.3,
            max_tokens=300,
        ) as stream:
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield {"data": json.dumps({"type": "token", "text": delta})}

        yield {"data": json.dumps({"type": "complete", "thesis": None})}
        return

    if not ticker:
        yield {"data": json.dumps({"type": "error", "text": "Could not identify a ticker in your message. Try: 'Research NVDA for a swing trade'"})}
        return

    finnhub = FinnhubService()

    def event(type_: str, **kwargs) -> dict:
        return {"data": json.dumps({"type": type_, **kwargs})}

    # ── Multi-agent mode: structured thinking steps, no token streaming ──
    if agent_config.get("pipelineMode") == "MULTI_AGENT":
        from services.finrobot import run_data_cot as _rdc
        from services.agents.bull import run_bull_analysis
        from services.agents.bear import run_bear_analysis
        from services.agents.fund_manager import run_fund_manager

        yield event("thinking", text=f"[Multi-Agent] Gathering market data for {ticker}...")
        try:
            data = await _rdc(ticker, finnhub)
        except Exception as exc:
            yield event("error", text=f"Data collection failed: {exc}")
            return

        yield event("thinking", text=f"[Multi-Agent] Bull analyst building LONG case for {ticker}...")
        yield event("thinking", text=f"[Multi-Agent] Bear analyst identifying risks for {ticker}...")
        bull_result, bear_result = await asyncio.gather(
            run_bull_analysis(data),
            run_bear_analysis(data),
            return_exceptions=True,
        )
        if isinstance(bull_result, Exception):
            bull_result = {"analysis": "Error", "key_signals": [], "price_target": data.price, "suggested_entry": data.price, "confidence": 50}
        if isinstance(bear_result, Exception):
            bear_result = {"analysis": "Error", "key_risks": [], "worst_case_target": data.price, "stop_trigger": data.price, "confidence": 50}

        yield event("thinking", text=f"[Multi-Agent] Fund Manager weighing bull vs bear for {ticker}...")
        total_tokens = [0]
        try:
            thesis = await run_fund_manager(data, bull_result, bear_result, total_tokens)
        except Exception as exc:
            yield event("error", text=f"Fund manager synthesis failed: {exc}")
            return

        yield event("complete", thesis=thesis.model_dump())
        return

    # ── Standard single-agent mode ──
    yield event("thinking", text=f"Gathering market data for {ticker}...")
    try:
        data = await run_data_cot(ticker, finnhub)
    except Exception as exc:
        yield event("error", text=f"Failed to gather data: {exc}")
        return

    yield event("thinking", text=f"Analyzing signals for {ticker}...")
    try:
        concept = await run_concept_cot(data, agent_config)
    except Exception as exc:
        yield event("error", text=f"Analysis failed: {exc}")
        return

    # Only bail out on an explicit PASS signal — low confidence alone does NOT
    # short-circuit. The full thesis should always be generated; callers decide
    # whether to act based on confidence_score.
    if concept.direction == "PASS":
        thesis = ThesisOutput(
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
        )
        yield event("complete", thesis=thesis.model_dump())
        return

    yield event("thinking", text=f"Writing thesis for {ticker} ({concept.direction})...")

    # Stream thesis tokens via OpenAI streaming
    from services.finrobot import _THESIS_SYSTEM

    prompt = f"""Generate a full trade thesis for:
Ticker: {data.ticker} — {data.company_name}
Direction: {concept.direction}
Hold Duration: {concept.hold_duration}
Signals: {', '.join(concept.signal_types)}
Current Price: ${data.price}
Initial Confidence: {concept.initial_confidence}
Analyst Notes: {concept.reasoning_notes}"""

    full_text = ""
    async with _openai_client.chat.completions.stream(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _THESIS_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
        max_tokens=1024,
    ) as stream:
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full_text += delta
                yield event("token", text=delta)

    # Parse the complete response into ThesisOutput
    try:
        raw = json.loads(full_text)
        thesis = ThesisOutput(
            ticker=ticker,
            direction=concept.direction,
            hold_duration=concept.hold_duration,
            confidence_score=raw.get("confidence_score", concept.initial_confidence),
            reasoning_summary=raw.get("reasoning_summary", full_text),
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
    except Exception:
        thesis = ThesisOutput(
            ticker=ticker,
            direction=concept.direction,
            hold_duration=concept.hold_duration,
            confidence_score=concept.initial_confidence,
            reasoning_summary=full_text,
            thesis_bullets=[],
            risk_flags=[],
            signal_types=concept.signal_types,
            sector=data.sector or None,
            sources_used=data.sources,
            model_used="gpt-4o",
        )

    yield event("complete", thesis=thesis.model_dump())


@router.post("/chat")
async def research_chat(body: ChatRequest):
    return EventSourceResponse(
        _stream_chat(body.message, body.agent_config, body.history)
    )


# ---------------------------------------------------------------------------
# /research/evaluate — post-trade agent self-evaluation (DAV-35)
# ---------------------------------------------------------------------------

class EvaluationRequest(BaseModel):
    ticker: str
    direction: str               # "LONG" | "SHORT"
    entry_price: float
    close_price: float
    outcome: str                 # "WIN" | "LOSS" | "BREAKEVEN"
    close_reason: str            # "TARGET" | "STOP" | "TIME" | "MANUAL"
    thesis_summary: str | None = None
    signal_types: list[str] = []
    hold_days: int = 0


class EvaluationResponse(BaseModel):
    evaluation_text: str


_EVAL_SYSTEM = (
    "You are an AI trading agent reflecting honestly on a closed paper trade. "
    "Be concise, specific, and direct. No filler phrases. Max 80 words."
)


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_trade(body: EvaluationRequest):
    client = _openai_client

    signals_str = ", ".join(body.signal_types) if body.signal_types else "unspecified"
    thesis_str = body.thesis_summary or "No thesis summary available."

    user_prompt = f"""You made a {body.direction} paper trade on {body.ticker}.

Entry: ${body.entry_price:.2f} | Close: ${body.close_price:.2f}
Outcome: {body.outcome} ({body.close_reason}) | Hold: {body.hold_days} days
Signals used: {signals_str}
Thesis: {thesis_str}

In 2-3 sentences, honestly evaluate: Was the thesis correct? What worked or failed? What is the key learning?"""

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _EVAL_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_tokens=150,
    )

    evaluation_text = response.choices[0].message.content or ""
    return EvaluationResponse(evaluation_text=evaluation_text.strip())


# ---------------------------------------------------------------------------
# /research/run-stream — SSE, sequential per-ticker streaming
# ---------------------------------------------------------------------------

_STREAM_DONE = object()  # sentinel for asyncio.Queue draining


class RunStreamRequest(BaseModel):
    tickers: List[str] = []
    source: str = "AGENT"
    agent_config: dict = {}


async def _stream_run(
    tickers: List[str],
    source: str,
    agent_config: dict,
) -> AsyncGenerator[dict, None]:
    """
    Sequential per-ticker streaming: emit events as each stock is analyzed.
    Tickers run one at a time to produce a clean, readable narrative.
    """
    from services.finrobot import run_full_pipeline_streaming

    def event(type_: str, **kwargs) -> dict:
        return {"data": json.dumps({"type": type_, **kwargs})}

    # Scanner discovery when no tickers provided
    if not tickers:
        yield event("scanning", message="Scanning market for research opportunities...")
        try:
            tickers = await get_research_candidates(agent_config)
        except Exception as exc:
            yield event("error", message=f"Scanner error: {exc}")
            return

    if not tickers:
        yield event("run_complete", theses=[], analyzed=0, recommended=0, source=source)
        return

    yield event("candidates", tickers=tickers, count=len(tickers))

    finnhub = FinnhubService()
    all_theses: List[ThesisOutput] = []

    for ticker in tickers:
        queue: asyncio.Queue = asyncio.Queue()

        async def _emit(data: dict, _q: asyncio.Queue = queue) -> None:
            _q.put_nowait(data)

        async def _run_ticker(
            _ticker: str = ticker,
            _q: asyncio.Queue = queue,
            _efn=_emit,
        ) -> tuple:
            try:
                return await run_full_pipeline_streaming(_ticker, agent_config, _efn, finnhub)
            finally:
                _q.put_nowait(_STREAM_DONE)

        task = asyncio.create_task(_run_ticker())

        # Drain queue until sentinel — yields events as they arrive
        while True:
            item = await queue.get()
            if item is _STREAM_DONE:
                break
            yield {"data": json.dumps(item)}

        try:
            thesis, _ = task.result()
            all_theses.append(thesis)
        except Exception as exc:
            logger.warning("Ticker task failed for %s: %s", ticker, exc)

    recommended = sum(1 for t in all_theses if t.direction != "PASS")
    yield event(
        "run_complete",
        theses=[t.model_dump() for t in all_theses],
        analyzed=len(all_theses),
        recommended=recommended,
        source=source,
    )


@router.post("/run-stream")
async def research_run_stream(body: RunStreamRequest):
    return EventSourceResponse(
        _stream_run(body.tickers, body.source, body.agent_config)
    )
