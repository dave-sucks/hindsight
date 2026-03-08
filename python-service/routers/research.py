import asyncio
import time
import uuid

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from models import RunRequest, RunResponse
from services.finrobot import run_full_pipeline
from services.scanner import get_research_candidates

router = APIRouter()


@router.post("/run", response_model=RunResponse)
async def research_run(body: RunRequest):
    """
    Trigger a full research run for one or more tickers.
    If tickers are not specified, the market scanner picks them.
    Runs up to 5 tickers concurrently. Times out individual tickers
    at 60s rather than failing the whole batch.
    """
    started = time.monotonic()
    agent_config = body.agent_config

    tickers = body.tickers
    if not tickers:
        tickers = await get_research_candidates(agent_config)

    sem = asyncio.Semaphore(5)

    async def run_one(ticker: str):
        async with sem:
            try:
                return await asyncio.wait_for(
                    run_full_pipeline(ticker, agent_config),
                    timeout=60.0,
                )
            except asyncio.TimeoutError:
                from models import ThesisOutput
                return (
                    ThesisOutput(
                        ticker=ticker,
                        direction="PASS",
                        hold_duration="SWING",
                        confidence_score=0,
                        reasoning_summary="Pipeline timed out after 60s",
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


@router.post("/chat")
async def research_chat():
    """SSE streaming research chat. Implemented in DAV-27."""
    return JSONResponse(status_code=501, content={"detail": "Not Implemented"})
