"""Bull-side analyst: constructs the strongest possible LONG case."""
import json
import os

from openai import AsyncOpenAI

from models import DataContext

_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

_BULL_SYSTEM = """You are an aggressive buy-side equity analyst at a top-tier hedge fund.
Your mandate: build the STRONGEST possible case for going LONG on this stock.
Be specific — cite price levels, % changes, P/E ratios, catalysts, and news.

Return JSON:
{
  "analysis": "<2-3 paragraph bull case: (1) momentum/technical setup, (2) fundamental catalyst, (3) timing rationale>",
  "key_signals": ["<specific signal with numbers>", "<signal 2>", "<signal 3>"],
  "price_target": <float — your 10-30 day upside target>,
  "suggested_entry": <float — ideal entry level>,
  "confidence": <integer 0-100 — your conviction in a profitable LONG>
}

Rules:
- Find the best possible bull case, even if conditions are mixed
- price_target must be above the current price (it is a long thesis)
- Quote specific numbers wherever possible"""


async def run_bull_analysis(data: DataContext) -> dict:
    """Parallel-safe bull analyst — takes DataContext, returns raw dict."""
    news_headlines = "\n".join(f"- {n.get('headline', '')}" for n in data.news[:3])
    price_str = f"${data.price}" if data.price else "N/A"
    change_str = f"{data.change_pct:+.2f}%" if data.change_pct is not None else "N/A"
    cap_str = f"${data.market_cap:.0f}M" if data.market_cap else "N/A"
    prompt = f"""Ticker: {data.ticker} ({data.company_name})
Sector: {data.sector}
Price: {price_str} ({change_str} today)
Market Cap: {cap_str} | P/E: {data.pe_ratio}
52W range: ${data.low_52w} – ${data.high_52w}
Upcoming earnings: {'YES (' + data.earnings_date + ')' if data.has_upcoming_earnings else 'No'}
Recent news:
{news_headlines or 'None'}

Build the strongest LONG case for {data.ticker}."""

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _BULL_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=512,
    )
    return json.loads(response.choices[0].message.content)
