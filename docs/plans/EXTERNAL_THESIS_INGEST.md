# External Thesis Ingest — offload research to flat-rate chats

**Status:** 🟢 Phase 1 shipped (#460) + hardened & verified end-to-end. Phase 2 MCP server built (`mcp/thesis-ingest/`) + verified. Per-analyst prompts + `/ingest-thesis` skill done. Remaining: wire the secret in Vercel + install the MCP server in Claude Desktop; then retire the Sunday discovery cron.
**Owner:** cost-reduction session (claude/thirsty-kirch-a385bf)
**Last updated:** 2026-07-01

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
  "core_belief": "<=30 words, falsifiable (outcome + timeframe + mechanism)",
  "key_assumptions": ["specific premise 1", "specific premise 2"],
  "invalidation_conditions": ["concrete breaker 1", "concrete breaker 2"],
  "conviction": "MEDIUM",
  "conviction_rationale": "<=400 chars, talk like a person, not the math",
  "target_size_pct": 2.5,
  "reasoning_summary": "optional 2-3 sentence framing",
  "thesis_bullets": ["optional bull point", "..."],
  "risk_flags": ["optional risk", "..."]
}
```

**Required-when-directional (LONG/SHORT) — the endpoint rejects without all of these** (gates live in `record-thesis.ts` execute, NOT just Zod):
`direction`, `horizon`, `entry_price`, `target_price`, `stop_loss` (shape: LONG → target>entry>stop; SHORT inverted), `core_belief`, `key_assumptions` (≥2), `invalidation_conditions` (≥2), `conviction`, `conviction_rationale`, `target_size_pct`. **`variant_view` is additionally required when `conviction` is STRONG or HIGH.** Horizon conditionals: `horizon:"CATALYST"` → `catalyst_date` (ISO) required; `horizon:"TRADE"` → `max_hold_days` required. `direction:"PASS"` is exempt from all of the above.

**Narrative shape gotcha (the previous template was wrong):** use the *legacy plain* fields — `reasoning_summary` (string), `thesis_bullets` (string[]), `risk_flags` (string[]). Do **not** emit `snapshot`/`bull_case`/`bear_case` as plain strings/arrays — those V2 fields require object shapes (`{text, citations:[]}` / `{bullets:[{text}]}`) and a plain string now **fails Zod validation** (400). Optional `scoring` (if you want the /10 composite) must be the full object: `{ trendStrength:{score,note}, relativeStrength:{score,note}, entryQuality:{score,note}, catalystFreshness:{score,note} }` with caps 3/3/2/2.

The chat **never** writes `triggers` — the endpoint strips any caller `triggers` and generates them from horizon + prices. Keep it lean — this is screening, not a promotion-grade note.

### What the endpoint guarantees (Phase-1 hardening, 2026-06-28)
The ingest path calls `record_thesis.execute()` directly, which **bypasses the AI SDK's Zod input validation** the agent path gets for free. Three fixes make the endpoint actually "validate + persist" as advertised — all verified end-to-end against the live DB (Secular Compounder / AVGO, minted + cleaned up):
1. **Schema validation** — `ingestThesis` now `safeParse`s the payload against the exported `thesisSchema` *before* creating the run row. Type drift (`target_size_pct:"11"`, `direction:"long"`, a plain-string `snapshot`) → **HTTP 400** with the exact field issues. No phantom run on bad input.
2. **Rejection reporting** — `record_thesis` signals gate rejections by *returning* `{data:{status:"FAILED", thesis_id:null, note}}` (it does NOT throw), so `defineTool` wraps even a rejection as `ok:true`. The endpoint previously reported these as `success:true` / HTTP 200 with a phantom COMPLETE run. Now a null `thesis_id` ⇒ **HTTP 422**, `success:false`, run marked FAILED, and the gate's `note` is surfaced as the error (the actionable guidance).
3. **Trigger stripping** — caller-supplied `triggers` are dropped before execute (it would otherwise `mergeTriggers(defaults, caller)`), enforcing the "endpoint generates triggers" invariant.

## Strategic follow-on
Once operator-offload works, the **Sunday discovery cron** (autonomous thesis-writers) can be **killed or paused** — discovery moves to flat-rate chats, removing that unattended Anthropic spend. The in-app thesis-writer then only runs for the rare daily/tactical research refresh (slim later if needed).

## Status / next
- [x] Read the exact `record_thesis` input Zod schema → finalize the template field names.
- [x] Build the Phase-1 ingest endpoint (`/api/intelligence/thesis-ingest`, secret-auth) + shared core (`lib/intelligence/ingest-thesis.ts`) + app-authed server action (`lib/actions/thesis-ingest.actions.ts`). (#460)
- [x] Paste UI at `/intelligence/ingest`. (#460)
- [x] **Verify the paste loop end-to-end** (2026-06-28) — minted a real Secular-Compounder AVGO thesis via the live endpoint, confirmed status=WATCHING, all structural fields, composite 8/10, and the 5 auto-generated COMPOUNDER triggers; then cleaned up. Found + fixed 3 hardening gaps (see "What the endpoint guarantees" above).
- [ ] **Per-analyst research prompts** (see `## Per-analyst research prompts` below) + reusable skill / custom-GPT.
- [x] **Phase 2: MCP server** — `mcp/thesis-ingest/` exposes a `save_thesis` stdio tool for Claude Desktop; wraps the HTTP endpoint (holds `HINDSIGHT_INGEST_URL` + `THESIS_INGEST_SECRET`, no DB in-process). Tool schema mirrors §A of `docs/prompts/INGEST_THESIS.md` (no `triggers` field). Verified end-to-end: server boots on stdio, advertises `save_thesis`, valid payload mints, invalid returns `isError` with the gate's guidance. **To go live: (1) set `THESIS_INGEST_SECRET` in Vercel + redeploy, (2) `cd mcp/thesis-ingest && npm install`, (3) add the server to `claude_desktop_config.json` (see its README).**
- [ ] Once offload is proven in daily use: pause/kill the Sunday discovery cron.

### Open question — the paste UI vs the secret endpoint
The paste UI (`ingestThesisAction`) is app-authenticated and is the operator's real path; the secret endpoint is for Postman/MCP. `THESIS_INGEST_SECRET` is **not** set in prod yet (only needed for the endpoint/MCP path) — set it in Vercel before Phase 2. The end-to-end verification above exercised the shared core via the secret endpoint locally; the UI/server-action layer is a thin auth wrapper over the identical `ingestThesis()` core.

## Per-analyst research prompts
The full research-prompt playbook lives in **`docs/prompts/INGEST_THESIS.md`** (the §A house
format doubles as a custom-GPT / Claude-Project system prompt; §B has a research brief per
analyst). The Claude Code slash command **`/ingest-thesis <Analyst> <TICKER…>`**
(`.claude/commands/ingest-thesis.md`) assembles the paste block. Quick reference for the four
enabled analysts (all LONG-only; size = `target_size_pct`, clipped by the account cap):

| Analyst | horizon | conditional required | conviction → target_size_pct | entry / stop logic |
|---|---|---|---|---|
| **Secular Compounder** | `COMPOUNDER` | — | STRONG 12-15 · HIGH 10-12 · MED 5-8 · LOW 3-5 | entry = scale-in level; stop = thesis-break (~−15% tolerance) |
| **Catalyst Event PM** | `CATALYST` | `catalyst_date` (ISO) | STRONG 7-8 · HIGH 5-6 · MED 4 · LOW→PASS | entry 1-4wk pre-event; exit at resolution / +30d |
| **PEAD Specialist** | `TARGET` | — | STRONG ~3 · HIGH ~2.5 · MED ~2 · LOW ~1.5 | entry 1-3d post-print; stop −8% |
| **Momentum Breakout** | `TRADE` | `max_hold_days` (5-10) | STRONG 5 · HIGH 4 · MED 3 · LOW→PASS | entry = breakout level; stop −5% / 10-EMA break |

(EV Catalyst Event Trader is disabled — no template. Add one if it's re-enabled.)
