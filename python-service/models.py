"""Shared Pydantic models for the research pipeline."""
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, computed_field, field_validator


class SourceItem(BaseModel):
    type: str           # "NEWS" | "FINANCIAL" | "PROFILE" | "EARNINGS"
    provider: str       # "FINNHUB" | "FMP" | "OPENAI"
    title: str
    url: Optional[str] = None
    published_at: Optional[str] = None


class TechnicalIndicators(BaseModel):
    rsi_14: Optional[float] = None          # 0-100; >70 overbought, <30 oversold
    macd: Optional[float] = None            # MACD line
    macd_signal: Optional[float] = None     # Signal line
    macd_histogram: Optional[float] = None  # MACD - Signal; positive = bullish
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    price_vs_sma20_pct: Optional[float] = None  # % above/below SMA20
    bollinger_position: Optional[float] = None  # 0=lower band, 50=midline, 100=upper
    w52_position: Optional[float] = None        # 0=52w low, 100=52w high
    volume_ratio: Optional[float] = None        # today vol / 20d avg; >1.5 = elevated


class AnalystSentiment(BaseModel):
    strong_buy: int = 0
    buy: int = 0
    hold: int = 0
    sell: int = 0
    strong_sell: int = 0
    total_analysts: int = 0
    consensus: str = ""    # "BUY" | "HOLD" | "SELL"
    period: str = ""


class InsiderTransaction(BaseModel):
    name: str = ""
    type: str = ""   # "BUY" | "SELL"
    shares: int = 0
    value: Optional[float] = None
    date: str = ""


class RedditSignal(BaseModel):
    """Reddit mention data for a ticker across key subreddits."""
    mention_count: int = 0
    total_score: int = 0          # total upvotes across all mentions
    sentiment_score: float = 0.0  # -1.0 (bearish) to 1.0 (bullish)
    trending: bool = False
    top_posts: List[str] = []


class OptionsFlow(BaseModel):
    """Unusual options activity summary."""
    put_call_ratio: float = 1.0
    unusual_contracts: List[dict] = []
    call_volume: int = 0
    put_volume: int = 0
    total_volume: int = 0
    has_unusual: bool = False


class EarningsIntel(BaseModel):
    """Earnings consensus + surprise history."""
    next_eps_estimate: Optional[float] = None
    next_revenue_estimate: Optional[float] = None
    beat_rate: Optional[float] = None       # % of quarters where EPS beat
    avg_surprise_pct: Optional[float] = None
    quarters_analyzed: int = 0
    iv_rank: Optional[float] = None         # 0-100


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
    # DAV-60: Technical indicators
    technicals: Optional[TechnicalIndicators] = None
    # DAV-61: Analyst sentiment + insider activity
    analyst_sentiment: Optional[AnalystSentiment] = None
    insider_transactions: List[InsiderTransaction] = []
    # Alternative data (DAV-73/74/75) — optional, populated in run_data_cot
    reddit: Optional[RedditSignal] = None
    options_flow: Optional[OptionsFlow] = None
    earnings_intel: Optional[EarningsIntel] = None


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
    # DAV-124: Enhanced thesis fields
    invalidation: Optional[str] = None          # what would make this thesis wrong
    sector_alternative: Optional[str] = None    # comparison to sector peer
    catalyst: Optional[str] = None              # specific catalyst with date
    order_type: Optional[str] = None            # "LIMIT" | "MARKET"
    suggested_shares: Optional[int] = None      # share count for $10K position
    thesis_sources: List[dict] = []             # [{type, provider, title, relevance, sentiment}]

    @field_validator("hold_duration", mode="before")
    @classmethod
    def coerce_hold_duration(cls, v: Any) -> str:
        """GPT-4o sometimes returns None or 'N/A' — coerce to safe default."""
        if v is None or str(v).strip().upper() not in ("DAY", "SWING", "POSITION"):
            return "SWING"
        return str(v).strip().upper()

    @computed_field  # type: ignore[misc]
    @property
    def recommendation_label(self) -> str:
        """Human-readable label derived from direction + confidence."""
        if self.direction == "PASS":
            return "PASS"
        if self.direction == "LONG":
            if self.confidence_score >= 70:
                return "STRONG BUY"
            elif self.confidence_score >= 50:
                return "BUY"
            else:
                return "WEAK BUY"
        else:  # SHORT
            if self.confidence_score >= 70:
                return "STRONG SELL"
            elif self.confidence_score >= 50:
                return "SELL"
            else:
                return "WEAK SELL"

    @computed_field  # type: ignore[misc]
    @property
    def risk_reward_ratio(self) -> Optional[float]:
        """R:R = reward / risk.  None when price levels are unavailable."""
        if not (self.entry_price and self.target_price and self.stop_loss):
            return None
        if self.direction == "LONG":
            reward = self.target_price - self.entry_price
            risk = self.entry_price - self.stop_loss
        else:  # SHORT
            reward = self.entry_price - self.target_price
            risk = self.stop_loss - self.entry_price
        if risk <= 0:
            return None
        return round(reward / risk, 2)


class SectorPerformance(BaseModel):
    """Single sector ETF performance snapshot."""
    symbol: str          # e.g. "XLK"
    name: str            # e.g. "Technology"
    change_pct: float    # daily % change
    price: Optional[float] = None


class PortfolioState(BaseModel):
    """Current portfolio snapshot passed from Next.js caller."""
    open_positions: List[dict] = []     # [{ticker, direction, entry_price, current_price, pnl_pct, days_held, sector}]
    total_exposure: float = 0.0         # total $ deployed
    available_capital: float = 0.0      # cash available
    position_count: int = 0
    sectors_held: List[str] = []        # sectors currently in portfolio


class MarketContext(BaseModel):
    """Market-wide context generated at start of each research run."""
    spx_price: Optional[float] = None
    spx_change_pct: Optional[float] = None
    vix_level: Optional[float] = None
    vix_change_pct: Optional[float] = None
    regime: str = "unknown"             # "trending_up" | "trending_down" | "range_bound" | "volatile"
    sector_performance: List[SectorPerformance] = []
    top_sectors: List[str] = []         # top 3 gaining sectors
    bottom_sectors: List[str] = []      # top 3 losing sectors
    portfolio: Optional[PortfolioState] = None
    approach_summary: str = ""          # 1-2 sentence run strategy from GPT-4o
    key_levels: str = ""                # support/resistance if relevant
    sector_rotation_notes: str = ""     # what's moving and why


class PortfolioSynthesis(BaseModel):
    """Post-thesis portfolio-level synthesis from GPT-4o."""
    summary: str = ""                   # morning research summary
    ranked_picks: List[dict] = []       # [{ticker, rank, action, sizing_dollars, reasoning}]
    existing_position_actions: List[dict] = []  # [{ticker, action, reasoning}]
    new_exposure: float = 0.0
    top_pick: Optional[str] = None      # #1 highest-conviction ticker


class RunRequest(BaseModel):
    tickers: Optional[List[str]] = None          # if None, scanner picks them
    source: Literal["AGENT", "MANUAL"] = "AGENT"
    agent_config: dict = {}
    portfolio_state: Optional[PortfolioState] = None  # DAV-121: current portfolio


class RunResponse(BaseModel):
    run_id: str
    theses: List[ThesisOutput]
    tickers_researched: int
    tickers_passed: int
    total_tokens: int
    duration_seconds: float
    source: Literal["AGENT", "MANUAL"] = "AGENT"
    market_context: Optional[MarketContext] = None       # DAV-121
    portfolio_synthesis: Optional[PortfolioSynthesis] = None  # DAV-122
