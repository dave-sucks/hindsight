# External Thesis Ingest — offload research to flat-rate chats

**Status:** 🟡 Building — plan + architecture done; endpoint next
**Owner:** cost-reduction session (claude/exciting-engelbart-b54555)
**Last updated:** 2026-06-22

## Problem
The in-app thesis-writer (Claude Sonnet deep-research sub-agent) costs **~$4/dispatch** (verified: ~8-min runs, web-search-heavy synthesis — `write-thesis-research.ts:540`). 15–20 dispatches during a discovery session = **$40–60/day** on the Anthropic bill. The operator has **unlimited flat-rate** claude.ai / ChatGPT chats.

## Design critique — the in-app thesis-writer is over-leveled for discovery
It does maximal, web-grounded, 9-section research at the **screening** stage:
- **Two stacked Claude agents** — the outer thesis-writer (Sonnet, `maxSteps:8`, ~9 tool calls, ~8 min) wraps an **inner synthesis call** (Sonnet + native `web_search`, up to 3 searches over 6 steps; each search's content is fed back and re-processed across the loop). Two expensive Claude loops per watchlist candidate.
- **Goldman-note depth to decide "should this be on the watchlist."** Deep web research + 9 narrative sections belongs at **promotion** (when a watchlist name triggers an entry), not at the widest part of the funnel.
- The 9 narrative sections are **all optional** — `record_thesis` only requires the structural decision fields.

**Conclusion:** front-loaded, promotion-grade research at the screening stage. The offload sidesteps this for operator-driven discovery; for the autonomous path (Sunday cron), the cleanest fix is to **stop running it unattended** (see Strategic follow-on).

## The insight
- **Expensive** = LLM research + synthesis → do it in a flat-rate chat ($0 marginal).
- **Cheap** = validate + persist + generate triggers → deterministic server code, zero LLM.
`record_thesis` already *is* the cheap part.

## Architecture — NO `record_thesis` surgery needed
`defineTool` returns a **factory**: `recordThesis(ctx)` → an AI SDK tool whose `.execute(args)` is directly callable (`define-tool.ts`). The tool doesn't care whether the agent loop or an HTTP route calls it. So the endpoint is thin:
1. `createToolContext({ runId, userId, accountId, analystId, runMode, runEnvironment, calledTickers })`.
2. Create a `ResearchRun` row (`mode:"EXTERNAL_INGEST"`) so the `runId` FK is valid.
3. `await recordThesis(ctx).execute(parsedInput)` — validates, generates triggers, runs the gates, mints the `Thesis`.
4. Map the `ToolResult` envelope → HTTP response.

**No 1,300-line extraction.** (The earlier "extract the core" plan was unnecessary once we saw `defineTool` returns a callable tool.)

Wrinkles to handle in the build:
- **runId FK** — create the run row first.
- **`calledTickers` provenance gate** — `record_thesis` enforces "ticker was researched in this run." Pre-seed `ctx.calledTickers` with `[ticker → get_stock_data]` to satisfy it (it's an ingest, not an agent run).
- **`source_kind` / `source_rationale`** — pass `WEB_SEARCH` + "external chat research."
- **`forceWatchingMint: true`** — an ingested mint is `WATCHING` (no position).

## Phases
- **Phase 1 (now):** `POST /api/intelligence/thesis-ingest` — authenticated (reuse the email-ingest secret pattern). Body = the lean JSON template below. Calls `record_thesis`. Returns thesis id / validation errors. **Zero LLM.** Plus a paste-prompt and a minimal paste box (or accept it via the existing email-ingest channel).
- **Phase 2 (later):** MCP — wrap the endpoint as an MCP tool so Claude Desktop calls it directly ("save this as a thesis for PEAD"), no paste step.

## The lean template (the chat emits this; the endpoint does the rest)
```json
{
  "analyst": "PEAD Specialist",
  "ticker": "MU",
  "direction": "LONG",
  "horizon": "TARGET",
  "entry_price": 140, "target_price": 180, "stop_loss": 125,
  "core_belief": "<=30 words, falsifiable",
  "key_assumptions": ["...", "..."],
  "invalidation_conditions": ["...", "..."],
  "conviction": "MEDIUM",
  "conviction_rationale": "<=400 chars",
  "target_size_pct": 2.5,
  "snapshot": "optional", "bull_case": ["optional"], "bear_case": ["optional"]
}
```
The chat **never** writes `triggers` (the endpoint generates them from horizon + prices). Keep it lean — this is screening, not a promotion-grade note.

## Strategic follow-on
Once operator-offload works, the **Sunday discovery cron** (autonomous thesis-writers) can be **killed or paused** — discovery moves to flat-rate chats, removing that unattended Anthropic spend. The in-app thesis-writer then only runs for the rare daily/tactical research refresh (slim later if needed).

## Status / next
- [ ] Read the exact `record_thesis` input Zod schema → finalize the template field names.
- [ ] Build the Phase-1 ingest endpoint.
- [ ] Paste-prompt + minimal paste UI (or email-ingest reuse).
- [ ] (later) MCP wrapper.
