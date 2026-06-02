# Discovery — final plan + current state

> **What this is.** The single durable plan for Hindsight's discovery + catalyst-trigger architecture. Replaces the lane-based phased plan from 2026-05-31.
>
> **Last updated:** 2026-06-02.
>
> For the operating model + 16-source catalog of *possible* inputs, see [`DISCOVERY_V2.md`](./DISCOVERY_V2.md). This doc is the action plan against that catalog.

---

## Current state (verified 2026-06-02)

### Running today

| Cron / surface | Schedule | Purpose |
|---|---|---|
| `morning-research` | Daily 8 AM ET | Daily-run agent walks per-thesis evidence. Reads `get_theses` + `get_portfolio_context`. Does NOT read `read_signals` (stripped 2026-05-31). |
| `trigger-evaluator` | Hourly + on `signal.routed` | Checks predicates on every ACTIVE+WATCHING thesis. Fires `app/thesis.trigger.fired`. |
| `tactical-run` | Event-driven on `app/thesis.trigger.fired` | Single-thesis single-decision agent (~15 steps). Reads context via pull tools; writes via `update_thesis` / `close_position` / etc. |
| `price-monitor` | Hourly during market hours | Auto-close hard stops, flag near-target/near-stop |
| `trade-evaluator` | Event-driven on close | GPT-4o post-mortem grades closed trades |
| `eod-evaluation` | EOD | Closing-price snapshots |
| `weekly-digest` | Sundays | Weekly digest email |
| `accuracy-scorer` | Sundays 10 AM ET | Per-analyst weekly AccuracyReport |
| **Principal Chat** | On-demand (operator) | Multi-mode chat with BATCHED DISCOVERY overlay (shipped PR #361). Primary discovery surface today. |

### Paused (code intact, off in Inngest dashboard — keep paused)

| Cron | Status / reason |
|---|---|
| `firm-market-sweep` | **PAUSED 2026-05-31.** Sonar firm-wide content fill. Not coming back. |
| `portfolio-watchlist-monitor` | **PAUSED 2026-05-31.** Per-ticker Sonar — duplicates `get_stock_data`-per-name that daily run already does. |
| `domain-monitor` | **PAUSED 2026-05-31.** Most monitors dead per 2026-04-22 audit. Replace with direct RSS if a specific source matters. |
| `signal-router` | **PAUSED 2026-05-31.** Consumed the above; nothing useful to route. |
| `discovery-run` | **PAUSED 2026-05-31** (after final May-31 9 AM ET runs). Re-enable only when MEDIUM-2 ships with gap-analysis Stage 0. |

### Disabled

- **84 monitors** flipped `enabled=false` (65 non-builtIn discovery monitors + the 11 PODCAST_SEGMENT). Rows kept for forensics; producers don't poll them. 6 builtIn system monitors remain enabled (always-on infrastructure, not noise contributors).

### Pull tools available to agents (no cron involvement)

These are tools the agent invokes on-demand. They work regardless of which crons are running. The agent decides when to call them.

- `get_market_movers` (FMP) — top gainers / losers / actives, universe-fenced
- `get_earnings_calendar` (Finnhub) — upcoming + recent earnings
- `get_stock_data` (Finnhub primary, FMP fallback) — quote / profile / financials / technicals / news / consensus
- `get_earnings_data` (Finnhub) — per-ticker EPS history, beat rate
- `get_sec_filings` (SEC EDGAR direct) — recent filings; works as a pull tool already today
- `get_options_flow` (FMP) — P/C ratio, unusual contracts
- `get_market_context` (Finnhub + FMP) — SPY/VIX/sectors/macro regime
- `web_search` (Perplexity Sonar) — general web search
- `twitter_search` (xAI Grok over X) — handle-attributed posts, shipped PR #361
- `read_signals` — works but returns empty (no producers). Stripped from daily-run prompt; kept in principal/discovery allowlists for when producers come back online.

---

## How the architecture works — the three roles

Any source can play one or more of three orthogonal roles. **Designing a new source means deciding which roles it plays.**

### Role A — Signal generator (push, batched consumption)

Producer writes `Signal` rows to the DB. `signal-router` scores + writes `AnalystSignalRoute` rows. Agents read via `read_signals` (returns the routed buckets for the scoped analyst).

**Today:** no source is in Role A (all 4 producer crons paused). `read_signals` returns empty.

### Role B — Trigger source (push, real-time wake-up)

Producer fires `app/thesis.trigger.fired` on a specific held thesis. `trigger-evaluator` matches predicates hourly + on `signal.routed`. On match → `tactical-run` wakes for that one thesis. The tactical agent reads context (via pull tools like `get_sec_filings`) + writes the update (`update_thesis` / `close_position` / etc.).

**Today:** only PRICE_ABOVE / PRICE_BELOW / EARNINGS_DATE / REVIEW_DATE_HIT / REVIEW_DUE predicates fire. No catalyst-event triggers (FILING_8K_*, FORM_4_CLUSTER, FILING_13D, MATERIAL_NEWS, etc.) exist yet.

### Role C — Pull tool (on-demand, sync)

Tool available to agents. Agent decides when to call. Returns live data on the spot. **No DB writes, no triggers, no relation to crons.**

**Today:** all listed pull tools work, independent of cron state. Daily-run agent calls them per-thesis during reviews. Principal-chat agent calls them in operator-driven conversations.

### The dual-role pattern (build template for new structured sources)

One Inngest producer can play Roles A + B from the same wire:

```
producer (e.g. edgar-monitor polls EDGAR atom)
  → for each filing event:
       if ticker ∈ active/watching thesis on this account:
         → fire trigger (Role B) → trigger-evaluator → tactical-run → tactical agent reviews + writes update
       elif ticker ∈ analyst's universe (sector/industry/theme/feeds match):
         → write Signal row (Role A) → signal-router → read_signals
       else: drop
```

Same data, two consumers. **Producers emit events / signals; agents own writes.** EDGAR doesn't write `update_thesis` itself — it fires a trigger, and the tactical-run agent decides what update to make.

### What fires what — the wiring

```
SOURCE (e.g. EDGAR) ─→ Producer cron ─┬─→ Role C pull tools (sync, called by any agent)
                                       ├─→ Role A: Signal row → signal-router → read_signals → daily/discovery/chat agents
                                       └─→ Role B: trigger event → trigger-evaluator → tactical-run → tactical agent

Independent cron paths (not driven by producers):
  morning-research → daily-run agent → walks each thesis with needsAction, calls pull tools per-name
  discovery-run (PAUSED) → discovery agent → reads read_signals + calls pull tools + (future) gap-analysis searches
  Operator /chat → principal-chat agent → calls any tool, dispatches writers
```

---

## The final plan

### Permanent decisions (locked)

1. **The 4 noise crons stay PAUSED PERMANENTLY.** Not coming back in their old shape.
2. **The 84 monitors stay DISABLED.** The Sonar-driven signal pipeline as-existed is not the right shape.
3. **`read_signals` stays out of the daily-run prompt + allowlist.** Principal/discovery allowlists retain it for when Role-A producers come back online.
4. **Operator-driven chat discovery is the primary on-demand discovery surface.** PR #361 shipped this; the LITE / DELL / SNOW / OKTA / MRVL trade outcomes validate it works.
5. **Producers, not pull tools alone, are the next investment.** The system needs to wake up on material events, not wait for the agent to ask "is there news on this name."

### Build sequence — four items, in order

Each is a single PR with clear scope. After all four, **stop building inputs** until 30-60 days of PASS-accuracy data tells us which producers earned their keep.

---

#### MEDIUM-1: EDGAR producer (8-K + Form 4 + 13D) — the biggest unlock

**Why first.** Free + highest-α structured-event source per the catalog. Closes the held-thesis blindness gap (currently no wake-up on material filings between scheduled reviews). Proves the dual-role pattern so MEDIUM-2 inherits the shape.

**Build:**
- New Inngest function `lib/inngest/functions/sources/edgar-monitor.ts` polling EDGAR atom every 15 min.
- Event classifier:
  - **8-K Item 2.02 (earnings)** → fire `EARNINGS_REPORTED` REVIEW trigger
  - **8-K Item 4.02 (restatement)** → fire `INVALIDATION_RISK` EXIT-eval trigger (highest priority — documented -15%/30d)
  - **8-K Item 5.02 (officer departure)** → fire `INVALIDATION_RISK` REVIEW trigger
  - **Form 4 cluster** (≥3 insiders / 30d, ≥$500k aggregate) → fire `INSIDER_BUY_CLUSTER` REVIEW trigger
  - **Schedule 13D from credible activist** (allowlist: Elliott, Pershing, Trian, Starboard, ValueAct, Engaged, Third Point, Icahn, Jana, Engine No. 1) → fire `ACTIVIST_DISCLOSED` REVIEW trigger
- Dual-role routing per event:
  - If ticker has ACTIVE/WATCHING thesis on the account → fire trigger event with `signalIds: [edgarSignalId]` so the tactical agent has provenance
  - Elif ticker matches an analyst's universe → write `Signal` row + `AnalystSignalRoute`
  - Else drop
- New trigger types registered in `lib/agent/triggers/types.ts` + predicate evaluators in `lib/agent/triggers/evaluate.ts`
- Tactical-run prompt extension: when fired by an EDGAR trigger, agent must call `get_sec_filings` to read the actual filing before acting.

**Effort:** 1 PR, ~1 week.
**Cost:** $0 (EDGAR atom is free public access).
**Net new capability:** Real-time wake-up on every material filing on every held thesis. New filings on in-universe names route to discovery surface.

---

#### MEDIUM-2: Gap-analysis Stage 0 + re-enable discovery cron

**Why next.** Lightweight prompt extension. Closes the "discovery is reactive to whatever signals showed up" gap. Re-enables the Sunday cron with a smarter input layer than "read whatever pre-routed signals exist." Validates whether automated query-gen materially improves dispatch quality.

**Build:**
- Add `includeGapAnalysis: boolean` param to `buildDiscoverySystemPrompt` (`lib/agent/system-prompts/discovery.ts`).
- When `true`, prepend a Stage 0 section before existing Step 1:
  > **Stage 0 — Audit current coverage.** Before pulling discovery surfaces, call `get_theses` + `get_portfolio_context`. For each universe dimension this analyst covers (sectors, industries, themes), evaluate: is it represented in current ACTIVE + WATCHING? If a dimension has zero coverage AND the analyst's mandate calls for it, flag it as a gap. For each gap, formulate ONE specific `web_search` or `twitter_search` query to surface candidates. Feed the results as supplemental input to Step 1's candidate pool — they go through the same Step 1.5 triage + Step 2 composite + Step 3 dispatch decision as routed signals and pull-tool surfaces.
- Re-enable `discovery-run` Inngest cron (Sundays 9 AM ET) with `includeGapAnalysis: true`.

**Effort:** ~50-100 lines of prompt diff in `discovery.ts`. No schema changes, no new tools, no new crons.
**Cost:** $0 (uses existing `web_search` + `twitter_search` per-run budgets).
**Net new capability:** Sunday cron generates its own searches based on coverage gaps, not just reactive to whatever surfaced. After MEDIUM-1 ships, also sees fresh EDGAR signals via `read_signals` Role A consumption.

**Test before committing:** Run 3-4 Sunday cycles with the flag on. Compare gap-identified candidates vs reactive candidates on (a) dispatch rate, (b) PASS rate, (c) 30-day forward returns (via MEDIUM-4 once shipped).

---

#### MEDIUM-3: Benzinga real-time wire

**Why third.** Second-highest-frequency Role A+B source after EDGAR. Free WebSocket. Same dual-role shape as EDGAR — once MEDIUM-1 ships the pattern, this is a copy with a different feed.

**Build:**
- `lib/inngest/functions/sources/benzinga-wire.ts` consuming Benzinga Basic News API's free real-time WebSocket.
- **Pre-grader** required: cheap model (Haiku or Groq-hosted) scores each headline for (relevance to held coverage, catalyst type, urgency). Gates the routing decision so we don't fire `MATERIAL_NEWS` REVIEW on every passing headline.
- Dual-role routing per the EDGAR pattern.
- New trigger type: `MATERIAL_NEWS` (scored — only fires above pre-grader threshold).

**Effort:** 1 PR, ~1 week (includes pre-grader integration).
**Cost:** $0 (Benzinga Basic News API free tier).
**Net new capability:** Real-time material news coverage on held names. New-name surfacing on universe-matching headlines.

---

#### MEDIUM-4: PASS-accuracy tracking + extend AccuracyReport

**Why fourth.** Measurement infrastructure. Without it, we can't tell whether the composite-≥-4 threshold is calibrated, whether `entryQuality` scoring is right, whether new producers improved hit-rate. Symmetric counterpart to `Monitor.successScore` (which grades sources by their trades) — this grades the agent's PASSes.

**Build:**
- New table:
  ```sql
  CREATE TABLE "PassAccuracySnapshot" (
    id            TEXT PRIMARY KEY,
    thesisId      TEXT REFERENCES "Thesis"(id),
    analystId     TEXT REFERENCES "AgentConfig"(id),
    ticker        TEXT NOT NULL,
    passOutcome   TEXT NOT NULL,  -- 'DIRECT_PASS' | 'WATCHLIST_ARCHIVED' | 'INVALIDATED'
    priceAtPass   DECIMAL,
    passedAt      TIMESTAMP,
    snapshotDay   INT,            -- 7 | 14 | 30 | 90
    priceAtSnap   DECIMAL,
    forwardReturn DECIMAL,
    classification TEXT           -- 'PASS_CORRECT' | 'PASS_MISSED' | 'PASS_NEUTRAL'
  );
  ```
- Daily snapshot cron: for each PASS-recorded / ARCHIVED-from-WATCHING thesis hitting its 7d / 14d / 30d / 90d mark, snapshot price + write row.
- Classification rule (tunable):
  - `forwardReturn < 0` → `PASS_CORRECT` (saved a loss)
  - `forwardReturn > +10%` → `PASS_MISSED` (missed a winner)
  - else → `PASS_NEUTRAL`
- Extend `AccuracyReport.passDiscipline` (weekly Sunday cron — already exists) with hit-rates per horizon, worst-misses, best-saves per analyst.
- Surface in `/performance` UI next to existing trade-win-rate charts.

**Effort:** ~300 LOC across schema migration + daily cron + report extension + UI tab. 3-5 days, single PR.
**Cost:** $0.
**Net new capability:** Closed-loop feedback on the discovery agent's PASS discipline. Per-analyst calibration data. Tuning input for composite thresholds.

---

### Deferred indefinitely

Moved out of active scope because the cost/effort doesn't beat the four items above. Revisit only if/when there's a specific reason.

| Item | Reason for deferral |
|---|---|
| **13D activist allowlist as a separate build** | Folded into MEDIUM-1 (one filter on top of the EDGAR producer, not its own PR) |
| **Quiver structured congressional ($30/mo)** | Marginal vs the news-rewrap that already comes through. Opt in later if Benzinga doesn't surface enough congressional disclosures. |
| **Unusual Whales options flow (paid)** | Paid API. Defer until free Role-A+B sources (EDGAR, Benzinga) prove the dual-role pattern and PASS-accuracy data justifies the spend. |
| **Vision-model screenshot ingestion** | UI work + vision integration. Operator can already paste textual content into chat (PR #361). Add only if screenshot becomes a frequent friction point. |
| **Reflexive vector memory** | Big infra (pgvector + embeddings on every close + matching logic). Needs ≥100 closed trades before pattern-matching has signal. Revisit late 2026 / early 2027. |
| **Vocal-tone earnings analysis** | Low frequency (1 event/ticker/quarter) + high effort. Marginal value vs reading transcripts via the thesis-writer. |
| **Prediction market disconnect** | Rare signal, more interesting than actionable. Track manually if it ever happens. |
| **Grok-as-orchestrator model** | We already have `twitter_search` as a tool inside Claude. Swapping the orchestrator carries risk against our strict Zod gates with marginal gain. |
| **Saved-prompt cadence layer (as separate item)** | Collapsed into MEDIUM-2 (gap-analysis Stage 0). The Sunday cron WITH gap-analysis IS the cadenced strategist. If different cadences (weekday) become needed, it's a small parameter change. |
| **Standalone Discovery Strategist mode** | Workflow-evaluated 2026-06-01 (PR #363). 90% redundant with existing discovery cron + PR #361 BATCHED DISCOVERY overlay. Net-new piece (gap-analysis) is MEDIUM-2 above. |
| **Stratechery / SemiAnalysis / Endpoints domain monitors via direct RSS** | Lower per-event α than structured filings. If a specific source becomes important, build it as a one-off Role-A producer (~2 days each). Not part of the active plan. |

---

### What stays running unchanged

Earning their keep — don't touch:

- Daily-run cron + per-thesis review loop (no `read_signals` since 2026-05-31)
- Trigger-evaluator + tactical-run (will gain catalyst-event trigger types from MEDIUM-1)
- All pull tools (`get_market_movers`, `get_earnings_calendar`, `get_stock_data`, etc.)
- Principal Chat agent + the BATCHED DISCOVERY overlay (PR #361)
- `dispatch_thesis_research` + thesis-writer sub-agent
- `twitter_search`, `web_search`
- `trade-evaluator`, `price-monitor`, `eod-evaluation`
- Weekly `AccuracyReport` (extending in MEDIUM-4, not replacing)

---

## Shipped 2026-05-31 (PR #361, merged) — institutional memory

All of NOW + SOON lanes shipped in one PR:

**Modified (9 files):**
- `lib/agent/system-prompt.ts` — daily-run Step 1 no longer reads `read_signals`
- `lib/agent/modes.ts` — daily-run allowlist drops `read_signals`; principal + discovery allowlists add `twitter_search`; principal prompt appends `## BATCHED DISCOVERY` section
- `lib/agent/tools/dispatch-thesis-research.ts` — pre-dispatch in-flight writer dedup
- `lib/agent/tools/index.ts` — register `twitter_search`
- `app/(root)/chat/page.tsx` — accept `?analyst=<id>&kickoff=<msg>` URL params (server-validated)
- `app/(root)/chat/ChatPageClient.tsx` — pass kickoff to AgentChat's `initialPrompt`
- `components/analysts/AnalystDetailClient.tsx` — render `RunDiscoveryButton`
- `docs/README.md` — index entries
- `docs/plans/DISCOVERY_V2.md` — added Part 1 (operating model) + §3 (dual-role pattern)

**New (4 files):**
- `lib/intelligence/xai-live-search.ts` — xAI Live Search client
- `lib/agent/tools/twitter-search.ts` — Grok-attributed posts tool
- `components/RunDiscoveryButton.tsx` — entry-point button
- `docs/plans/DISCOVERY_OVERHAUL.md` — this doc

**Operational (no code):**
- Paused 4 noise Inngest crons (firm-market-sweep, portfolio-watchlist-monitor, domain-monitor, signal-router)
- Disabled 84 monitors (`UPDATE "Monitor" SET enabled=false WHERE "builtIn"=false`)

**Env requirements:**
- `XAI_API_KEY` — required for `twitter_search`. If unset, tool returns a clean structured failure.

---

## Evaluated and rejected: Discovery Strategist as a new agent mode (2026-06-01, PR #363)

A proposal landed (from a sibling Claude session) for a new `discovery-strategist` agent mode + Sunday cron, with a 5-stage workflow (AUDIT → STRATEGIZE → EXECUTE → TRIAGE → RECAP) and an on-demand "Run Strategist Now" button.

**Verdict: merge-into-existing, do NOT ship as a new mode.** Workflow-validated by three independent evaluators (architecture / redundancy / prompt-quality lenses) — all three converged.

**Why rejected:**
- **90% redundant.** The proposed 5-stage workflow is operationally equivalent to the existing Sunday discovery cron + PR #361's BATCHED DISCOVERY overlay on Principal Chat. Same triage, same 4-dim composite, same DISPATCH_CAP=5, same PASS-record, same thesis-writer delegation.
- **Mode duplication.** A `discovery-strategist` mode entry would sit next to the existing `discovery` mode running identical logic on a different cron — DRY violation + debugging confusion.
- **Allowlist regression.** Proposal listed 7 tools (omitting `read_signals`, `get_stock_data`, `get_earnings_data`, `get_sec_filings`, `record_thesis`, etc.). The existing discovery mode has 14 — the proposal's lean allowlist could not actually execute its own 5-stage workflow.
- **Cron timing collision.** Proposal: Sundays 8 AM ET. Existing: Sundays 9 AM ET. Two crons on the same day with the same logic.
- **Scoring scheme inconsistency.** Proposal: 1-10 per dimension with composite thresholds 6.0 / 3.0. Existing: 0-3 / 0-3 / 0-2 / 0-2 summing to 10 with threshold ≥4. The proposal's scale is arithmetically ambiguous.

**What IS genuinely net-new and worth taking:** the **gap-analysis** idea — read current coverage, identify universe dimensions underrepresented in the analyst's book, formulate searches to fill those gaps. **Captured as MEDIUM-2 above.**

---

## Open questions for principal

1. **Re-enable discovery cron with gap-analysis Stage 0, or stay operator-driven only?** MEDIUM-2 turns the Sunday cron back on with the smarter prompt. Alternative: leave Sunday cron paused permanently, do all discovery through operator-driven chat. **Recommendation:** re-enable with gap-analysis when MEDIUM-2 ships — automated coverage-gap awareness is genuinely valuable; operator can still drive on-demand alongside it.

2. **Gap definition — what counts as a "coverage gap"?** Does one thesis per universe-dimension suffice (sector OR industry OR theme), or is there a minimum coverage-depth threshold? Too aggressive → 20+ dispatches per Sunday. Too conservative → audit is toothless. Decision rule needed before MEDIUM-2 ships.

3. **Scoring scheme reform.** Current 4-dim composite is technicals-leaning (`trendStrength` / `relativeStrength` / `entryQuality` / `catalystFreshness`, 0-3/0-3/0-2/0-2 → max 10, threshold ≥4). Should fundamentals-leaning archetypes (Secular Compounder, Catalyst Event PM) use different dimensions? Or one composite for all?

4. **EDGAR producer cadence (MEDIUM-1).** 15-min polling default. Tighter (5 min) cuts latency but burns more atom requests. Looser (1 hr) misses pre-market filings. Start 15-min, tune if needed.

5. **PASS-accuracy MISSED threshold (MEDIUM-4).** Proposed: `forwardReturn > +10% → PASS_MISSED`. Single threshold, or per-horizon (e.g., +5% at 7d, +10% at 30d, +20% at 90d)?

6. **What happens to the Sunday discovery cron's read_signals consumption pre-MEDIUM-1?** If we re-enable the cron via MEDIUM-2 before MEDIUM-1 ships, `read_signals` returns empty — the cron operates on pull tools + gap-analysis searches alone. That's actually fine; just worth knowing. Order can be MEDIUM-2 first OR MEDIUM-1 first; no hard dependency.

---

## Sequencing recommendation

| Phase | When | What |
|---|---|---|
| Now | This week | Smoke-test PR #361 end-to-end on more discovery sessions. Watch tomorrow + this week's daily runs. |
| Next PR | This week or next | **MEDIUM-1: EDGAR producer.** Largest single unlock. |
| Next PR after that | 1-2 weeks later | **MEDIUM-2: Gap-analysis Stage 0 + re-enable discovery cron.** Small prompt diff. |
| Then | 2-4 weeks | **MEDIUM-3: Benzinga wire.** Inherits MEDIUM-1's pattern. |
| Then | 4-6 weeks | **MEDIUM-4: PASS-accuracy tracking.** Measurement layer to grade everything we just built. |
| Then | STOP and observe | Run 30-60 days. Don't build new producers until PASS-accuracy data + activity-feed wins show which inputs are earning. |

Total wall-clock for the four MEDIUM items: ~6-8 weeks of part-time work, single-PR each.

---

## See also

- [`DISCOVERY_V2.md`](./DISCOVERY_V2.md) — operating model + 16-archetype signal-source catalog (the catalog this plan is selecting from)
- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — thesis lifecycle + role split (writer/orchestrator); how tactical agents handle trigger fires
- [`PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle (each producer is Layer 2; agent judgment is Layer 3)
- [`MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — daily-run prompt design
- PR #361 — operator-driven discovery overhaul (merged 2026-06-01)
- PR #363 — strategist evaluation verdict + MEDIUM-2 capture
