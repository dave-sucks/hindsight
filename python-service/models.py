"""Shared Pydantic models for the research pipeline."""
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, field_validator


class SourceItem(BaseModel):
    type: str           # "NEWS" | "FINANCIAL" | "PROFILE" | "EARNINGS"
    provider: str       # "FINNHUB" | "FMP" | "OPENAI"
    title: str
    url: Optional[str] = None
    published_at: Optional[str] = None


class DataContext(BaseModel):
    ticker: str
    price: Optional[float] = None
    change_pct: Optional[float] = None
    company_name: str = ""
    sector: str = ""
    market_cap: Optional[float] = None
    market_cap_tier: str = "LARGE"
    pe_ratio: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    news: List[dict] = []
    has_upcoming_earnings: bool = False
    earnings_date: Optional[str] = None
    sources: List[SourceItem] = []


class ConceptAnalysis(BaseModel):
    direction: Literal["LONG", "SHORT", "PASS"]
    hold_duration: Literal["DAY", "SWING", "POSITION"] = "SWING"
    signal_types: List[str]
    initial_confidence: int  # 0-100
    reasoning_notes: str
    pass_reason: Optional[str] = None

    @field_validator("hold_duration", mode="before")
    @classmethod
    def coerce_hold_duration(cls, v: Any) -> str:
        """GPT-4o sometimes returns None or 'N/A' — coerce to safe default."""
        if v is None or str(v).strip().upper() not in ("DAY", "SWING", "POSITION"):
            return "SWING"
        return str(v).strip().upper()


class ThesisOutput(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    ticker: str
    direction: Literal["LONG", "SHORT", "PASS"]
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    hold_duration: Literal["DAY", "SWING", "POSITION"] = "SWING"
    confidence_score: int  # 0-100
    reasoning_summary: str
    thesis_bullets: List[str]
    risk_flags: List[str]
    signal_types: List[str]
    sector: Optional[str] = None
    sources_used: List[SourceItem] = []
    model_used: str = "gpt-4o"

    @field_validator("hold_duration", mode="before")
    @classmethod
    def coerce_hold_duration(cls, v: Any) -> str:
        """GPT-4o sometimes returns None or 'N/A' — coerce to safe default."""
        if v is None or str(v).strip().upper() not in ("DAY", "SWING", "POSITION"):
            return "SWING"
        return str(v).strip().upper()


class RunRequest(BaseModel):
    tickers: Optional[List[str]] = None          # if None, scanner picks them
    source: Literal["AGENT", "MANUAL"] = "AGENT"
    agent_config: dict = {}


class RunResponse(BaseModel):
    run_id: str
    theses: List[ThesisOutput]
    tickers_researched: int
    tickers_passed: int
    total_tokens: int
    duration_seconds: float
    source: Literal["AGENT", "MANUAL"] = "AGENT"
