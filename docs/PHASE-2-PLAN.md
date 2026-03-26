# Hindsight V3 Intelligence Layer — Phase 2 Implementation Plan

## Context

Phase 1 (this PR) added the analyst builder UI redesign: split-pane layout with a floating config panel, Silk WebGL shader avatar, tab reorganization, and the foundational `AnalystConfigPanel` component. But the **critical backend work** — the intelligence layer that makes V3 analysts actually work — is untouched.

This document is a thorough plan for a new session to tackle the 7 open issues, prioritized by urgency.

---

## Issue Tracker

| # | Issue | Priority | Estimated Effort |
|---|-------|----------|-----------------|
| 3 | Old analysts missing V3 infra — backfill script | **CRITICAL** | 3-4 hours |
| 6 | Backfill/resync seed data packs → real analysts | **CRITICAL** | Part of #3 |
| 1 | Morning Brief tool UI is a stub | **HIGH** | 1-2 hours |
| 2 | `read_signals` returns 0 for old analysts | **HIGH** | 2-3 hours |
| 4 | No `web_search` tool exists | **HIGH** | 2-3 hours |
| 5 | Briefing agent output invisible to user | **MEDIUM** | 1-2 hours |
| 7 | Builder config card hides V3 intelligence proposals | **MEDIUM** | 1 hour |

---

## Issue #3 + #6 (CRITICAL): Backfill V3 Infrastructure for Existing Analysts

### Problem
Existing analysts (created before V3) have no:
- `SourcePack` (which sources to crawl)
- `IntelligenceQuery` rows (standing queries for discovery)
- `IntelligencePolicy` (attention allocation, signal budgets)

Without these, the intelligence layer skips them entirely. The morning briefing agent finds nothing to brief on.

### What Exists
- Prisma models: `SourcePack`, `SourcePackSource`, `IntelligenceQuery`, `IntelligencePolicy` — all defined and migrated
- The analyst builder chat generates `sourcePackProposal`, `intelligenceQueries`, and `intelligencePolicy` in the config — but only for NEW analysts created via the builder
- Seed data in `scripts/seed-analysts.sql` or similar may reference source packs that don't match real analyst configs

### Implementation Plan

#### Step 1: Backfill Script (`scripts/backfill-v3-infra.ts`)

For each analyst that has NO `SourcePack`:

1. **Generate a SourcePack** based on the analyst's `sectors`, `signalTypes`, and `analystPrompt`:
   - Map sectors → relevant financial data sources (e.g., Technology → TechCrunch, The Verge, Ars Technica; Biotech → BioPharma Dive, FDA.gov, ClinicalTrials.gov)
   - Always include baseline sources: Finnhub news, SEC EDGAR, FMP press releases
   - Create `SourcePack` row with name like `"Auto: {analystName}"`
   - Create `SourcePackSource` rows for each source (domain, name, qualityScore, reason)

2. **Generate IntelligenceQuery rows** based on analyst config:
   - For each watchlist ticker: create a `WATCHLIST` category query (e.g., "TSLA earnings, catalysts, price action")
   - For each sector: create a `SECTOR` category query (e.g., "EV industry news, battery technology breakthroughs")
   - For each signal type: create a `SIGNAL` category query (e.g., "Unusual options flow in tech stocks")
   - General discovery query based on `analystPrompt`

3. **Generate IntelligencePolicy**:
   - Default allocation: `holdingsAttention: 0.4`, `watchlistAttention: 0.35`, `discoveryAttention: 0.25`
   - `maxSignalsPerRun`: 15
   - `maxArtifactReads`: 5
   - `allowLiveSearch`: true
   - `liveSearchBudget`: 3

#### Step 2: Validation
- Run script in dry-run mode first (log what would be created)
- Then run for real
- Verify each analyst now has SourcePack + queries + policy via a quick SELECT

#### Step 3: Resync Check
- Compare seed data source packs against what backfill created
- Ensure no duplicates or conflicts

### Key Files to Create/Modify
- `scripts/backfill-v3-infra.ts` — NEW, the main backfill script
- `lib/actions/analyst.actions.ts` — may need a `getAnalystsWithoutV3Infra()` query
- `prisma/schema.prisma` — verify relations are correct

---

## Issue #2 (HIGH): `read_signals` Returns 0 for Old Analysts

### Problem
The `read_signals` tool in `lib/agent/tools.ts` queries signals routed to the current analyst. Old analysts have no `IntelligenceQuery` rows, so the signal routing system never routes signals to them → always returns 0.

### Root Cause
Signal routing (`lib/inngest/functions/` or wherever signals get routed) matches incoming signals against `IntelligenceQuery` rows. No queries = no routing = no signals.

### Fix
1. **Primary fix**: Issue #3 backfill will create queries → signals will start routing
2. **Secondary fix**: Add a fallback in `read_signals` — if an analyst has 0 routed signals, fall back to a broader query:
   - Match by analyst's `sectors` array
   - Match by analyst's `watchlist` tickers
   - Return up to N most recent signals that match
3. **Verify**: After backfill, run a test research run and confirm `read_signals` returns data

### Key Files
- `lib/agent/tools.ts` — `read_signals` tool execute function
- `lib/inngest/functions/signal-router.ts` (or equivalent) — routing logic

---

## Issue #1 (HIGH): Morning Brief Tool UI is a Stub

### Problem
The `read_morning_brief` tool UI in `components/assistant-ui/tool-uis.tsx` or `research-tool-group.tsx` only shows counts (e.g., "3 signals, 2 articles") but doesn't render the actual briefing content.

### Implementation Plan
1. **Find the tool UI registration** for `read_morning_brief` in `useRegisterAgentToolUIs()` or `research-tool-group.tsx`
2. **Parse the tool output** — the briefing agent returns structured data:
   - Market summary (SPY/VIX/sectors)
   - Top signals with headlines and relevance scores
   - Watchlist updates
   - Key articles/artifacts
3. **Render as a proper card**:
   - Market context summary at top
   - Signal list with source chips
   - Expandable article previews
   - Use existing `ChainOfThought` component pattern

### Key Files
- `components/assistant-ui/research-tool-group.tsx` — tool UI rendering
- `components/assistant-ui/tool-uis.tsx` — tool UI registration
- `lib/agent/tools.ts` — `read_morning_brief` tool definition (check output schema)

---

## Issue #4 (HIGH): No `web_search` Tool Exists

### Problem
The `IntelligencePolicy` has `allowLiveSearch` and `liveSearchBudget` fields. The analyst builder proposes search capabilities. But there's no actual `web_search` tool in `lib/agent/tools.ts`.

### Implementation Plan
1. **Add `web_search` tool** to `lib/agent/tools.ts`:
   - Input: `{ query: string, maxResults?: number }`
   - Use a search API (options: Serper, Tavily, Brave Search, or SerpAPI)
   - Return: `{ results: Array<{ title, url, snippet, source }> }`
2. **Respect policy limits**:
   - Check `intelligencePolicy.allowLiveSearch` before executing
   - Track search count against `liveSearchBudget` per run
3. **Add tool UI** in `research-tool-group.tsx`:
   - Show search query
   - Render results as clickable links with snippets
   - Source chips for each result domain

### Environment Setup
- Need API key for whichever search provider is chosen
- Add to `.env`: `SEARCH_API_KEY`
- Add to Vercel environment variables

### Key Files
- `lib/agent/tools.ts` — add new tool
- `lib/agent/system-prompt.ts` — update instructions to mention web search capability
- `components/assistant-ui/research-tool-group.tsx` — tool UI
- `.env.example` — document new env var

---

## Issue #5 (MEDIUM): Briefing Agent Output Invisible to User

### Problem
The briefing agent (intelligence cron) runs and generates briefings, but the user has no way to see the output. It's stored in the DB but not surfaced in the UI.

### Implementation Plan
1. **Check where briefings are stored** — likely a `Briefing` or `RunEvent` table
2. **Add a briefing display** to the analyst detail page (`/analysts/[id]`):
   - New tab or section: "Latest Brief"
   - Show the most recent briefing with timestamp
   - Render the structured content (market summary, signals, articles)
3. **Alternative**: Surface in the agent run flow — when `read_morning_brief` is called, it pulls the latest briefing. If the UI for that tool is fixed (Issue #1), this may be sufficient.

### Key Files
- `app/(root)/analysts/[id]/page.tsx` — analyst detail page
- `components/analysts/AnalystDetailClient.tsx` — client component
- DB schema — find where briefings are persisted

---

## Issue #7 (MEDIUM): Builder Config Card Hides V3 Intelligence Proposals

### Problem
When the analyst builder chat generates a config with `sourcePackProposal`, `intelligenceQueries`, and `intelligencePolicy`, the config panel's Intelligence tab should show these proposals. Currently it reads from `config.sourcePackProposal?.sources` etc., which should work — but needs verification.

### Fix
1. **Verify** the builder chat's `suggest_config` tool actually returns these fields
2. **Verify** the `AgentConfigData` type includes these fields
3. **Test** by building an analyst and checking the Intelligence tab populates
4. If the data is there but not showing, it's a rendering bug in the Intelligence tab

### Key Files
- `app/api/chat/analyst-builder/route.ts` — builder chat API
- `components/domain/agent-config-card.ts` — `AgentConfigData` type
- `components/analysts/AnalystConfigPanel.tsx` — Intelligence tab rendering

---

## Recommended Execution Order

1. **#3 + #6** — Backfill script (unblocks everything else)
2. **#2** — Fix signal routing (depends on #3 for queries to exist)
3. **#1** — Morning brief tool UI (can be done in parallel with #2)
4. **#4** — Web search tool (independent)
5. **#5** — Briefing visibility (depends on #1 partially)
6. **#7** — Builder intelligence proposals (quick verification)

---

## Pre-requisites Before Starting

- [ ] Merge this PR (Phase 1 UI work)
- [ ] Verify Prisma schema has all V3 models (`SourcePack`, `SourcePackSource`, `IntelligenceQuery`, `IntelligencePolicy`)
- [ ] Check which search API to use for `web_search` (need API key provisioned)
- [ ] Confirm briefing storage location in DB (table/model name)
