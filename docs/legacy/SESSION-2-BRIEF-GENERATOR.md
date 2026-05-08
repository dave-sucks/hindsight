# Session 2 — Morning Brief Generator Rewrite

**Session of 4.** Previous: Session 1 fixed routing/scoring (novelty carve-out + denormalization + Watchlist Searches ticker tagging). Next: Session 3 ships Signal→Thesis→Monitor traceability. This session is about the morning brief generator being un-grounded and ignoring analyst policy.

## Before you start (required reading)

1. `CLAUDE.md` (full file) — stack, data model, agent architecture
2. `docs/AGENT_OVERHAUL_PLAN.md` — sections on the intelligence pipeline
3. `/Users/davebixler/.claude/projects/-Users-davebixler-hindsight/memory/project_pipeline_audit_2026_04_22.md` — the audit that surfaced these bugs
4. Verify findings still hold by running the "Verify baseline" SQL below before touching code. Data decays fast. If signalCount mismatches are gone, stop and ask.

## Goal

Stop the morning brief from fabricating — every cited `signalId` must be a real signal routed to this analyst today, every holding must get an alert when the intelligence policy says so, and every brief must surface at least one real discovery ticker.

## Evidence the bugs exist (2026-04-22 audit data)

Tech Momentum Trader, `analystId = cmmofy6t3000004l7858o1xma`, brief row `cmo8k5bey000404jv2fzxlq47` dated 2026-04-21:

- `signalCount: 50` — but only **10** routes exist in the last 24h for this analyst. The 50 is pulled from a multi-day pool.
- `watchlistUpdates` cites `signalIds: ["cmnzx9mey002704l14mbhtgdp"]` — that signal is NOT in today's routed pool.
- `newOpportunities` cites `cmnyhoonu003n04jrw4cfm866` and `cmnrcgkp9004404l5hpr26e8d` — also from prior days.
- `portfolioAlerts: []` — despite `intelligencePolicy.holdingsAttention: 0.3` and the user holding NVDA.
- `newOpportunities` tickers: `[AMD, NVDA]` — both on the watchlist. Zero actual discovery.
- `attentionPriority: ["AMD","NVDA"]` — same stale names.

## Files to touch

- `lib/inngest/functions/morning-brief-generator.ts` — main target
- `lib/agent/tools/read-morning-brief.ts` — only if the tool needs to expose new fields
- Tests in `**/*.test.ts` if they exist for this generator

## Scope — three fixes, one PR

### Fix 1: Ground `signalIds` to today's routed pool only

**What's wrong:** the generator is seeing signals from a multi-day window, so GPT cites whatever looks thematic regardless of whether it's in today's routing.

**Fix:**
1. Load routed signals via `AnalystSignalRoute` where `routedAt > NOW() - INTERVAL '24 hours'` AND `analystId = $analyst`. Sort by `relevanceScore DESC` (the post-novelty adjusted score).
2. Pass ONLY these signals + their IDs into the GPT context. Inject the exact list of allowed `signalIds` in the system prompt as a strict allowlist.
3. After GPT returns the brief JSON, validate every `signalId` in `portfolioAlerts`, `watchlistUpdates`, `newOpportunities` exists in the allowlist. If any don't, fail the job with a loud error (don't silently drop — the model is hallucinating and we need the surface).
4. Set `signalCount` to `routes.length` — today's count, nothing else.

### Fix 2: Honor `intelligencePolicy.holdingsAttention`

**What's wrong:** generator ignores the policy. Holdings get zero alerts even when weight > 0.

**Fix:**
1. Read `analyst.intelligencePolicy` (it's a JSON column on `AgentConfig`).
2. Load the analyst's current open positions: `Position` rows where `status = 'OPEN'` and `userId = analyst.userId`.
3. If `holdingsAttention > 0` AND holdings exist, the contract becomes: **every open position must appear in `portfolioAlerts`** — either with a real alert grounded in today's signals, or with an explicit `"alert": "No material change today"` entry and `urgency: "LOW"`. Enforce in the system prompt AND validate on response.

### Fix 3: Force ≥1 real discovery opportunity

**What's wrong:** `newOpportunities` recycles watchlist/position names.

**Fix:**
1. Segment today's routed signals into three buckets before passing to GPT:
   - `holdingsSignals` — ticker ∈ open positions
   - `watchlistSignals` — ticker ∈ analyst.watchlist (and not in holdings)
   - `discoverySignals` — everything else (use `routeReasonCode IN ('DISCOVERY','SECTOR_MATCH','INDUSTRY_MATCH','THEME_MATCH')` plus ticker-not-in-watchlist-or-positions as the fallback filter)
2. Prompt: `newOpportunities` must contain ≥1 item sourced from `discoverySignals`. If `discoverySignals` is empty, the brief must emit `newOpportunities: []` AND `marketContext` must contain the sentence "No discovery candidates this session." — don't let GPT invent.

## Verify baseline (run before coding)

```sql
-- Prove bug #1: brief cites signalIds not in today's routes
WITH latest_brief AS (
  SELECT id, "analystId", "generatedAt", "signalCount",
         "portfolioAlerts", "watchlistUpdates", "newOpportunities"
  FROM "MorningBrief"
  WHERE "analystId" = 'cmmofy6t3000004l7858o1xma'
  ORDER BY "generatedAt" DESC
  LIMIT 1
),
cited_ids AS (
  SELECT DISTINCT jsonb_array_elements_text(
    COALESCE(alert->'signalIds','[]'::jsonb)
  ) AS signal_id
  FROM latest_brief, jsonb_array_elements("portfolioAlerts"::jsonb) alert
  UNION
  SELECT DISTINCT jsonb_array_elements_text(COALESCE(u->'signalIds','[]'::jsonb))
  FROM latest_brief, jsonb_array_elements("watchlistUpdates"::jsonb) u
  UNION
  SELECT DISTINCT jsonb_array_elements_text(COALESCE(o->'signalIds','[]'::jsonb))
  FROM latest_brief, jsonb_array_elements("newOpportunities"::jsonb) o
),
todays_pool AS (
  SELECT "signalId" FROM "AnalystSignalRoute"
  WHERE "analystId" = 'cmmofy6t3000004l7858o1xma'
    AND "routedAt" > (SELECT "generatedAt" FROM latest_brief) - INTERVAL '24 hours'
)
SELECT
  (SELECT COUNT(*) FROM cited_ids) AS cited_count,
  (SELECT COUNT(*) FROM cited_ids c WHERE c.signal_id NOT IN (SELECT "signalId" FROM todays_pool)) AS hallucinated,
  (SELECT "signalCount" FROM latest_brief) AS reported_signal_count,
  (SELECT COUNT(*) FROM todays_pool) AS actual_route_count;
```

Expected today: `hallucinated > 0`, `reported_signal_count != actual_route_count`.

## Verify success (after coding)

1. Trigger the brief job for TMT manually: Inngest event `intelligence/morning-brief.run` with `{ analystId: "cmmofy6t3000004l7858o1xma" }`, or via the intelligence dashboard "Start Pipeline" button if the user wires it.
2. Re-run the SQL above. Expect: `hallucinated = 0`, `reported_signal_count == actual_route_count`.
3. Expect at least one `portfolioAlerts` entry per open position.
4. Expect `newOpportunities[0].tickers[0]` is NOT in `analyst.watchlist` AND NOT in open positions — OR `newOpportunities == []` with the "No discovery candidates" sentinel in `marketContext`.

## Out of scope

- Router scoring changes (Session 1 already shipped)
- `Thesis.sourceSignalIds` or `Monitor.successScore` schema (Session 3)
- `/intelligence` dashboards, toolStats, run failure triage (Session 4)
- Rewriting discovery monitor queries — if `discoverySignals` is empty, emit the sentinel and move on. The upstream fix lives in a future session.
- Builder validation — if an analyst has a contradictory universe fence, don't repair it here. Emit the sentinel.

## Commit

`feat(brief): ground to today's routes + force discovery slot + honor holdings policy`

## Notes for the next session (Session 3)

When you extend `record_thesis` to persist `sourceSignalIds`, the allowlist pool this session builds is the exact same shape. Consider extracting the "load today's routed signals for analyst" helper into `lib/intelligence/routed-signals.ts` so Session 3 can reuse it.
