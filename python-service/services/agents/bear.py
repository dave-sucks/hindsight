"""Bear-side analyst: challenges the bull case and identifies downside risks."""
import json
import os

from openai import AsyncOpenAI

from models import DataContext

_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

_BEAR_SYSTEM = """You are a hard-nosed short-seller and risk analyst at a hedge fund.
Your mandate: challenge the bull case. Find every reason NOT to buy this stock.
Identify valuation risks, fundamental headwinds, technical breakdown scenarios, and macro threats.
Be specific — cite numbers, ratios, recent news, and comparable failures.

Return JSON:
{
  "analysis": "<2-3 paragraph bear case: (1) valuation/fundamental risk, (2) technical/momentum headwinds, (3) macro or sector-specific threats>",
  "key_risks": ["<specific risk with numbers>", "<risk 2>", "<risk 3>"],
  "worst_case_target": <float — your 10-30 day downside target>,
  "stop_trigger": <float — the price level that confirms the bear thesis>,
  "confidence": <integer 0-100 — your conviction that this is a bad LONG or a good SHORT>
}

Rules:
- worst_case_target must be below the current price
- Be a devil's advocate even if the stock has strong momentum
- Quantify risks wherever possible"""


async def run_bear_analysis(data: DataContext) -> dict:
    """Parallel-safe bear analyst — takes DataContext, returns raw dict."""
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

Challenge the LONG case for {data.ticker}. What are the biggest risks and why could this trade fail?"""

    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _BEAR_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=512,
    )
    return json.loads(response.choices[0].message.content)
