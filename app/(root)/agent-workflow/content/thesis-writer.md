---
id: thesis-writer
title: Thesis Writer
summary: Focused sub-agent that produces one Goldman-depth equity-research note on one ticker — spawned on demand, runs as its own child ResearchRun, writes back to the thesis that requested it.
---

The Thesis Writer is a sub-agent that handles deep research. When a [Daily Run](agent:agent), [Discovery Run](agent:discovery), or Tactical Run needs a full research note on a ticker, it dispatches this agent and optionally waits for it to finish before trading.

The child run is its own first-class `ResearchRun` row with `mode=THESIS_WRITER` and a `parentRunId` pointing back at the caller. The agent itself is intentionally thin — one big tool call does the heavy lifting, and the agent's job is to layer the investment decision on top.

## Step 1: Pull and synthesize

One call to `write_thesis_research`. Inside, seven structured data sources fire in parallel — financials, analyst coverage, insider activity, earnings history, peer comparisons, SEC filings, and stock data. The results get formatted into a compact ground-truth markdown block (~3–5KB) that the model reads but cannot contradict.

Claude Sonnet 4.6 then synthesizes a multi-section research note using Anthropic's native web search to fill narrative gaps: recent analyst commentary, transcript quotes, dated catalysts. The output is a set of parsed sections and citations that flow directly into the thesis record.

```reads
write_thesis_research — meta-tool: 7 parallel data pulls → markdown data block → Claude Sonnet 4.6 synthesis with native web search → parsed sections + citations
get_stock_data?provider=finnhub — available as a standalone check if the agent needs a fresh quote mid-session
```

## Step 2: Decide

Direction (`LONG`, `SHORT`, or `PASS`), horizon (`CATALYST`, `TARGET`, `TRADE`, or `COMPOUNDER`), entry price, target, stop, a core belief, at least two key assumptions, and at least two invalidation conditions. Confidence must meet the analyst's minimum threshold.

## Step 3: Persist

For a new thesis — mint it. For a refresh of an existing one — update it. Either way, the synthesized `researchData`, parsed `researchSections`, and a fresh `researchUpdatedAt` timestamp persist to the `Thesis` row. That timestamp is what the [Daily Run](agent:agent)'s staleness gate checks before allowing a trade on that thesis.

```writes
record_thesis — mint mode: persists direction, horizon, target, stop, belief, assumptions, invalidations, and the full research data block
update_thesis — refresh mode: patches the structural fields and writes a research-refreshed audit row
```

## Step 4: Complete

```writes
complete_run — marks the child run COMPLETE; the parent waiter unblocks and resumes
```
