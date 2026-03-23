# Hindsight V3 planning doc

Date: March 22, 2026 11:41 PM
Pinned: No
Status: Not started

Perplexity Sonar is actually interesting for this. Here's the honest comparison:

## Perplexity Sonar vs Claude Web Search — For Your Use Case

**What Sonar does that Claude web search doesn't:**

- Returns a `citations` array and `search_results` array as structured data alongside the answer — you get the raw URLs and metadata separately from the prose
- Supports `response_format` with JSON Schema — you can define a Pydantic/Zod schema like `{ ticker, catalyst, sentiment, source_url, recency }` and get structured signals back directly
- Has `search_recency_filter` (hour/day/week/month) and `search_domain_filter` built into the API params
- 1,200 tokens/sec on Cerebras infra — significantly faster than Claude for high-volume sweeps
- Sonar base model is **$1/M input, $1/M output** — dramatically cheaper than Claude Sonnet for bulk intelligence gathering

**What Claude web search does better:**

- Claude is smarter. If you need multi-step reasoning ("search for X, then based on what you find, search for Y, then synthesize"), Claude is better at the agentic loop
- Claude web search + web fetch in one call — it can search, find a promising result, then read the full page, all in one turn
- You're already using Claude for everything else — no new SDK

**The real question is: what are the intelligence agents actually doing?**

If the morning intelligence sweep is:

> "Search 15 queries across news/market themes, extract structured signals, write them to DB"
> 

That's **Sonar's sweet spot.** It's fast, cheap, returns structured data natively, and you don't need Claude-level reasoning for bulk ingestion. You'd call Sonar 15 times in parallel, get JSON-schema signals back, write to your signal table. Cost: maybe $0.10-0.30 for the whole sweep.

If the intelligence agent needs to:

> "Read this earnings transcript, compare it to the thesis from last week, decide if the thesis still holds"
> 

That's **Claude's sweet spot.** Deep reasoning over long context with your existing data.

## My Revised Honest Recommendation

**Use both. Different layers.**

| Layer | Tool | Why |
| --- | --- | --- |
| **Bulk search/discovery** (morning sweep, monitoring, signal ingestion) | **Perplexity Sonar** | Cheap, fast, structured output, recency filtering, domain filtering. Purpose-built for this. |
| **Deep research** (analyst runtime, thesis validation, page reading) | **Claude web search + web fetch** | Smarter reasoning, multi-step, reads full pages, already integrated. |
| **Financial data** | Finnhub + FMP | Keep as-is. Sonar isn't going to give you real-time quotes or options flow. |

The Sonar API is OpenAI-compatible (same request format as ChatGPT), so integration is trivial — it's basically `new OpenAI({ baseURL: "https://api.perplexity.ai" })`.

**Cost estimate for a real daily intelligence operation:**

- Morning sweep: 5 analysts × 10 themed queries each = 50 Sonar calls → ~$0.15/day
- Runtime research: 5 analyst runs × ~5 Claude web searches each = 25 searches → ~$0.50/day
- Total: **~$0.65/day, ~$20/month**

That's a real intelligence backbone for $20/month. Not free-tier-only, but not crazy either.

Want to move forward with this stack assumption and start breaking down the epics?

Sources:

- [Perplexity Structured Outputs Guide](https://docs.perplexity.ai/guides/structured-outputs)
- [Perplexity API Platform](https://sonar.perplexity.ai/)
- [Perplexity Sonar API Overview](https://www.analyticsvidhya.com/blog/2025/01/perplexity-sonar-api/)
- [Best Deep Research APIs 2026](https://www.firecrawl.dev/blog/best-deep-research-apis)