---
id: thesis-writer
title: Thesis Writer
summary: Focused sub-agent that produces one Goldman-depth equity-research note on one ticker — spawned on demand, runs as its own child ResearchRun, writes back to the thesis that requested it.
---

The Thesis Writer is a sub-agent that handles deep research. When a [Daily Run](agent:agent), [Discovery Run](agent:discovery), or [Tactical Run](agent:tactical) needs a full research note on a ticker — either to mint new coverage or refresh stale research before trading — it dispatches this agent via `dispatch_thesis_research` and optionally blocks on it with `wait_for_thesis_refresh`.

The child run is its own first-class `ResearchRun` row with `mode=THESIS_WRITER` and a `parentRunId` pointing back at the caller. The agent itself is intentionally thin — one big meta-tool call does the heavy lifting, and the agent's job is to layer the investment decision on top.

Two modes: **mint** (net-new coverage, produces a `WATCHING` thesis) and **refresh** (updates an existing thesis, preserving its status).

## Step 1: Pull and synthesize

One call to `write_thesis_research`. Inside that single meta-tool, seven structured data sources fire in parallel — financials, analyst coverage, insider activity, earnings history, peer comparisons, SEC filings, and stock data. The results get formatted into a compact ground-truth markdown block (~3–5KB) that the synthesis model reads but cannot contradict.

Claude Sonnet 4.6 then synthesizes a multi-section research note using Anthropic's native web search to fill narrative gaps: recent analyst commentary, transcript quotes, dated catalysts. The output is a set of parsed sections and citations that flow directly into the thesis record.

```reads
write_thesis_research — meta-tool: 7 parallel data pulls → markdown data block → Claude Sonnet 4.6 synthesis with native web search → parsed sections + citations
get_stock_data?provider=finnhub — available as a standalone check if a critical gap needs filling
```

**Promotion context:** when this is a refresh on a `PROMOTED` thesis (i.e., paper→live promotion just happened), the caller passes a `promotionContext` block — paper tenure, realized P&L, review count, promotion date. The agent forwards this verbatim into `write_thesis_research`, which uses it to frame the synthesis Decision Fields around RE-ENTER / DOWNGRADE / INVALIDATE rather than the standard thesis structure.

## Step 2: Decide

Direction (`LONG`, `SHORT`, or `PASS`), horizon (`CATALYST`, `TARGET`, `TRADE`, or `COMPOUNDER`), entry price, target, stop, a core belief, at least two key assumptions, and at least two invalidation conditions. Confidence must meet the analyst's minimum threshold.

Before persisting, the agent verifies the 2:1 R/R floor: `(target − entry) / (entry − stop)` for longs, mirror for shorts. If R/R is below 2.0, the draft gets rejected and the agent must resize — tighten the stop, lower the target, or widen the entry — before calling the persistence tool.

## Step 3: Persist

For a new thesis — mint it with `record_thesis`. For a refresh — update it with `update_thesis`. Either way, the synthesized `researchData`, parsed `researchSections`, and a fresh `researchUpdatedAt` timestamp persist to the `Thesis` row. That timestamp is what the [Daily Run](agent:agent)'s and [Tactical Run](agent:tactical)'s staleness gates check before allowing a trade on that thesis.

Default status on mint is `WATCHING`. The thesis writer never mints directly as `ACTIVE` — `ACTIVE` is owned by `place_trade` in the calling agent.

```writes
record_thesis — mint mode: persists direction, horizon, target, stop, belief, assumptions, invalidations, and the full research data block
update_thesis — refresh mode: patches the structural fields and writes a research-refreshed audit row
```

## Step 4: Complete

```writes
complete_run — marks the child run COMPLETE; the parent waiter (wait_for_thesis_refresh) unblocks and the calling agent resumes
```
