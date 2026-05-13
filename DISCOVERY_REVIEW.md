# DISCOVERY_REVIEW.md

End-to-end review of the weekly Discovery run — prompt, flow, code,
and gaps against the product vision. Written 2026-05-11 after the
2026-05-10 inaugural auto-cron minted zero theses across all seven
enabled analysts.

> **Scope note.** PR #247 (commit `f8b7f11` on `claude/romantic-mendeleev-1c67aa`)
> is described in its commit message as fixing the three proximate
> tool-surface bugs (read_signals triggerId trap, scope:"universe"
> coverage exclusion, discoveryOnly bucket rewrite). That commit is
> **not on `main`** at the time of this review (HEAD `e230516`). The
> review below treats those fixes as if they will land; everything
> documented here is about the prompt + flow shape, not the proximate
> tool bugs.

---

## What discovery is supposed to do

Per [docs/VISION.md](docs/VISION.md) Part 3, Pillar 1:

> **The system finds stocks worth knowing about.** The intelligence
> pipeline gathers raw evidence; the signal router fans signals out to
> each analyst's universe; the Sunday Discovery Run gives every analyst
> a focused weekly window to convert standout discovery signals into
> new WATCHING theses (or, with high conviction, ACTIVE + a starter
> trade).

Discovery is the **front door for new tickers entering coverage.** Its
output is the input to Pillar 3 — Watchlist → Trade promotion — which
the daily run and the trigger evaluator + tactical run consume. A
healthy week looks like (VISION Part 5):

> Sunday: Discovery run mints 3 new WATCHING theses in semis (because
> semis were the dominant theme this week).

Three load-bearing properties:

1. **Net-new only.** Discovery doesn't manage existing theses; the
   daily run does. The agent must skip everything already covered.
2. **Weekly cadence.** Sunday 9 AM ET, markets closed, the prior
   week's signals have all landed, the new WATCHING theses are ready
   for Monday's daily run to pick up via the per-thesis review loop.
3. **WATCHING-by-default with ENTER triggers.** Discovery seeds the
   watchlist; trade promotion happens later when the entry condition
   fires. High-conviction direct-to-ACTIVE is an escape hatch, not the
   primary mode.

Implied but not stated in VISION: **Discovery should be archetype-
aware.** Pillar 1 lists six archetypes the system targets (catalyst
events, momentum breakouts, secular themes, earnings drift, intraday
momentum, ETF macro) and the daily-run prompt already branches on
DAY-only vs swing. Discovery doesn't.

---

## What discovery actually does

The weekly cron lives at [lib/inngest/functions/discovery-run.ts](lib/inngest/functions/discovery-run.ts).
For each enabled `AgentConfig`:

1. Load the analyst's existing coverage tickers (ACTIVE + WATCHING
   theses) — [discovery-run.ts:63](lib/inngest/functions/discovery-run.ts:63).
2. Create a `ResearchRun` row with `mode: "DISCOVERY"`, `status: "RUNNING"`
   — [discovery-run.ts:75](lib/inngest/functions/discovery-run.ts:75).
3. Spawn `createResearchTools(..., discoveryOnly: true)` and apply the
   `MODES.discovery.toolAllowlist` — [discovery-run.ts:100](lib/inngest/functions/discovery-run.ts:100).
4. Build the system prompt via `buildDiscoverySystemPrompt({ config,
   existingTickers })` — [discovery-run.ts:134](lib/inngest/functions/discovery-run.ts:134).
5. Call `generateText` (GPT-4o, `maxSteps: 25`, `maxDuration: 240s`)
   with a hard-coded user prompt — [discovery-run.ts:146](lib/inngest/functions/discovery-run.ts:146).
6. Persist messages, count theses, flip the run to COMPLETE if
   `record_run_summary` fired else FAILED — [discovery-run.ts:217](lib/inngest/functions/discovery-run.ts:217).

The prompt at [lib/agent/system-prompts/discovery.ts](lib/agent/system-prompts/discovery.ts)
prescribes a 5-step workflow:

- **Step 1 — Scan three sources** in this exact order: `read_signals`,
  `get_market_movers(scope: "universe")`, `get_earnings_calendar(scope: "universe")`.
- **Step 2 — Score** — "pick the 2-3 most promising candidates," then
  call `get_stock_data` for each and score on the same daily-run
  composite (trendStrength + relativeStrength + entryQuality +
  catalystFreshness). **Threshold: composite ≥ 7.**
- **Step 3 — Mint theses** — `record_thesis(status: "WATCHING")` for
  composite 7–7.9, optional `record_thesis(status: "ACTIVE") + place_trade`
  for composite ≥ 8.
- **Step 4 — Cap at 5.**
- **Step 5 — `record_run_summary` then `complete_run`.**

The allowlist is at [lib/agent/modes.ts:175](lib/agent/modes.ts:175):
`record_thesis`, `place_trade`, `manage_watchlist`, `record_run_summary`,
`complete_run` for writes; the standard read tools plus `web_search`
and `get_market_context` (which the prompt never asks the agent to
call). **No `update_thesis`, no `close_position`, no `manage_position`** —
discovery cannot touch the existing book.

The run replay UI at [app/(root)/runs/[id]/page.tsx:142](<app/(root)/runs/[id]/page.tsx:142>)
renders `AgentChat` whenever `isLive || hasReplay`, so a FAILED run
with persisted messages still shows the transcript. A FAILED run with
no messages collapses to the "Run failed" empty state with the
`parameters.error` string (when present).

---

## Gaps

In addition to the six listed in the brief.

### 7. Step 1 lookback default is "today only," prompt claims "past 7 days"

The prompt at [discovery.ts:46](lib/agent/system-prompts/discovery.ts:46)
says read_signals returns "Routed signals over the past 7 days." It
doesn't. The tool's `lookbackDays` parameter defaults to `0` (today
only) — see [read-signals.ts:199](lib/agent/tools/read-signals.ts:199)
and the default destructure at [read-signals.ts:237](lib/agent/tools/read-signals.ts:237).
The prompt never tells the agent to pass `lookbackDays: 7`, so the
Sunday cron reads **Sunday's** signals — and Sunday is a market-closed
day with no firm-market-sweep / portfolio-watchlist-monitor /
domain-monitor activity. The agent sees an empty inbox and either
fails the run or hallucinates candidates. **This is plausibly the
dominant cause of the 2026-05-10 zero-theses outcome**, not the three
tool-surface bugs PR #247 chased.

### 8. The prompt never instructs the agent to widen `lookbackDays`

Even if Gap 7 is addressed at the tool default level, the prompt
should explicitly say *"call read_signals with lookbackDays: 7"* in
Step 1. Today it doesn't, and discovery-mode tools that quietly look
back further would diverge from the prompt's stated semantics.

### 9. `scope: "universe"` on movers + earnings is the OPPOSITE of what discovery wants (pre-PR #247)

On this branch (`main` = `e230516`), [get-market-movers.ts:107](lib/agent/tools/get-market-movers.ts:107)
and [get-earnings-calendar.ts:109](lib/agent/tools/get-earnings-calendar.ts:109)
intersect with `watchlist ∪ positionTickers`. The prompt at
[discovery.ts:91](lib/agent/system-prompts/discovery.ts:91)
describes `scope: "universe"` as "FENCED to your sectors/industries/themes
plus tickers you already cover. The 'your names' list is filtered out
by the tool." Both halves of that sentence are wrong: the tools do
NOT fence by sector/industry/theme (the comments at 107 and 109 note
that's "deferred to router-side"), and they INCLUDE coverage names,
they don't filter them out. PR #247 (per its commit message) flips
the semantics so coverage is excluded in discovery mode — assume that
lands, but acknowledge that the prompt language at lines 91-97 will
still be misleading until rewritten.

### 10. `read_signals` discovery-mode lookback returns nothing on Sunday for any analyst that doesn't have backfilled routes

Even after PR #247's "ticker-NOT-in-coverage" rewrite of the discovery
bucket, the underlying query at [read-signals.ts:336](lib/agent/tools/read-signals.ts:336)
is windowed by `tradingDay` and `routedAt`. The signal-router cron
doesn't run on Sunday, and no `AnalystSignalRoute` rows get added
Sunday morning. So unless the agent passes `lookbackDays: 7`, the
discovery inbox is empty for every analyst on every Sunday — by
construction.

### 11. The composite ≥ 7 threshold is the daily-run "tradeable today" bar

Daily-run system prompt at [system-prompt.ts:172](lib/agent/system-prompt.ts:172)
sets composite ≥ 7 **and** R/R ≥ 2:1 **and** in-Universe as the
threshold to TRADE. Discovery's job per VISION is to mint **WATCHING**
candidates that aren't tradeable today but could be next week. Using
the same threshold means a candidate that's interesting but doesn't
have a clean setup *right now* — exactly the population WATCHING is
for — gets passed instead of minted. Threshold should be ~5 for
WATCHING, 7 for high-conviction ACTIVE.

### 12. The 4-dimension scoring rubric is calibrated for momentum/breakout, applied to every archetype

[discovery.ts:107](lib/agent/system-prompts/discovery.ts:107)
inherits the daily-run rubric (trendStrength 0-3, relativeStrength
0-3, entryQuality 0-2, catalystFreshness 0-2). A Deep Value Contrarian
([strategy-archetypes.ts:414](lib/agent/knowledge/strategy-archetypes.ts:414))
**buys downtrends** — trendStrength: 3 for them is a sell signal.
An Insider Cluster Buying archetype ([strategy-archetypes.ts:269](lib/agent/knowledge/strategy-archetypes.ts:269))
cares about Form 4 cluster patterns; the rubric has no slot for that.
The composite gate is the same shape used to grade a Momentum
Breakout — applied universally, it systematically passes on every
non-momentum candidate.

### 13. Provenance gate forces ROUTED_SIGNAL but two of the three Step 1 sources don't produce signal IDs

[discovery.ts:128](lib/agent/system-prompts/discovery.ts:128) says:
"source_kind = 'ROUTED_SIGNAL' with non-empty source_signal_ids drawn
from this run's read_signals output." A thesis born from
`get_market_movers` or `get_earnings_calendar` has no `signalId` to
cite — the FMP pull tools don't write `Signal` rows. The agent has
two bad options: (a) use ROUTED_SIGNAL with a faked or unrelated
signal ID (the [record-thesis.ts:451](lib/agent/tools/record-thesis.ts:451)
"valid routes today" guard rejects this — and on Sunday with no
routes, *every* citation fails this guard), or (b) use WEB_SEARCH
provenance, which triggers the soft nudge at
[record-thesis.ts:424](lib/agent/tools/record-thesis.ts:424)
because the candidate's ticker WAS in `read_signals` output for some
matching session-window signal. The architecture-VISION goal — Monitor
ROI credit per source — is broken either way.

### 14. WATCHING + LONG/SHORT requires `target_price` (the ENTER trigger level), enforced at write time

[record-thesis.ts:689](lib/agent/tools/record-thesis.ts:689) rejects
a WATCHING thesis without an ENTER trigger; the default ENTER trigger
template fires off `target_price`. So every WATCHING thesis the
discovery agent mints needs an entry breakout level identified at
mint time. The prompt's "lower conviction → WATCHING with triggers
describing what would flip it to ACTIVE" framing
([discovery.ts:122](lib/agent/system-prompts/discovery.ts:122))
under-specifies this — it doesn't tell the agent to set `target_price`
explicitly OR derive an ENTER trigger from setup levels. Agents that
write "broad-strokes WATCHING" without a numeric breakout level get
their thesis rejected.

### 15. No `get_market_context` call — discovery is regime-blind

Daily-run prompt requires `get_market_context` (it's structurally
implicit in the rubric: "regime supportive" is part of entry-quality
scoring). Discovery's prompt never asks for it. Sunday's "what should
I scan for this week" decision should anchor on regime — if SPY just
broke its 200d and VIX is at 28, you should bias to defensive themes
and oversold bounces this week, not momentum breakouts. Today's
discovery prompt funnels every analyst through the same three sources
with no regime overlay.

### 16. No cross-analyst overlap check at the workflow level

The brief notes the daily run does this. Discovery doesn't. The
`record_thesis` tool has a hard cross-analyst overlap guard for
DAY-only analysts ([record-thesis.ts:866](lib/agent/tools/record-thesis.ts:866))
— so day-trader discovery is partially protected — but every other
archetype can mint a duplicate of another analyst's existing coverage.
The 2026-05-10 EV Catalyst case (3 attempts to mint $MU, all rejected
by the same-direction guard) is what this gap looks like in practice.

### 17. "Pick the 2-3 most promising before scoring" is lossy and arbitrary

[discovery.ts:103](lib/agent/system-prompts/discovery.ts:103) tells
the agent to pre-prune the candidate pool to 2-3 before calling
`get_stock_data` to validate. This caps real surface area at 2-3
even when 8 promising names surfaced. The pre-prune is also done by
prose, with no scoring methodology — the model is asked to triage
without the tools needed to triage. Order should be: surface all
candidates → score the top 6-8 with `get_stock_data` → mint the ones
that clear the bar.

### 18. Day-trader analysts run weekly discovery — wrong cadence

The cron loops every enabled analyst including `holdDurations:["DAY"]`
ones. An Intraday Momentum Scalper's discovery surface is *today's
tape*, not last week's routed signals. A WATCHING thesis with a
DAY-horizon TRADE setup is logically broken — Saturday's level won't
fire on Monday's open because the level depends on Monday's premarket
gap. Either skip DAY-only analysts in the discovery cron, or give them
a separate "intraday discovery" workflow that runs each morning before
the daily run.

### 19. No idempotency on per-analyst step.run

[discovery-run.ts:58](lib/inngest/functions/discovery-run.ts:58)
wraps each analyst in `step.run("discovery-<config.id>", ...)`.
Inside, `prisma.researchRun.create` runs *before* the try/catch around
`generateText`. If the step gets retried by Inngest after a transient
failure (db blip, OpenAI 502), a second `ResearchRun` row is created
for the same analyst-week. Two runs, two sets of theses, double-billed
LLM calls. The `concurrency: { limit: 1 }` on the outer function
([discovery-run.ts:28](lib/inngest/functions/discovery-run.ts:28))
prevents *parallel* duplicate cron fires, not retry duplicates.

### 20. FAILED status hides successful theses behind the "Run failed" badge

[discovery-run.ts:217](lib/inngest/functions/discovery-run.ts:217)
sets COMPLETE only if `record_run_summary` fired. So a run that
minted 4 WATCHING theses but token-limited or prose-terminated before
`record_run_summary` lands as FAILED — even though four valid
contributions were saved. The page at
[runs/[id]/page.tsx:166](<app/(root)/runs/[id]/page.tsx:166>)
shows "Run failed" in the empty-state branch and the run feed badge
treats FAILED as "this didn't work" — visually misrepresenting a
partial-success run. Counting theses created should be a co-equal
signal alongside `ranSummary`.

### 21. The discovery prompt is missing the "tool-call discipline" block that the daily-run prompt has

[system-prompt.ts:477](lib/agent/system-prompt.ts:477) has a load-
bearing block warning GPT-4o about prose-termination — the failure
mode where the model narrates "Next, I'll proceed to..." and the
generateText loop ends. Per CLAUDE.md, this block was added after 3
of 7 morning-cron runs failed identically on 2026-05-07. The PR #247
commit message explicitly notes Secular Theme Architect prose-
terminated in discovery mode on 2026-05-10 from the same failure
mode. The discovery prompt on `main` has no such block. PR #247 adds
one — confirm that lands.

### 22. No instruction on watchlist add (`manage_watchlist`) despite being in the allowlist

`manage_watchlist` is in [modes.ts:196](lib/agent/modes.ts:196) but
the discovery prompt never mentions it. Today watchlist and WATCHING
theses are still separate tables (the docs/THESIS_ARCHITECTURE_PLAN.md
collapse is "pending"). An analyst might want to track a name as
watchlist-only (no thesis) — discovery can't surface that affordance
because the prompt never names it.

### 23. Universe-fence not enforced in tools, only narrated in prompt

[discovery.ts:67](lib/agent/system-prompts/discovery.ts:67) lists
sectors/industries/themes as the fence. None of the three Step 1
sources enforces these — `read_signals` was already routed by the
router (which DOES apply the fence), but `get_market_movers` and
`get_earnings_calendar` are not sector-fenced (the in-tool comments
acknowledge this). The agent has to manually filter, with no
enforcement. A Healthcare-only analyst can mint an NVDA thesis from
the movers list and nothing rejects it.

### 24. Tool-context flag `discoveryOnly` is a single boolean masking three behaviors

[read-signals.ts:587](lib/agent/tools/read-signals.ts:587) treats
`ctx.discoveryOnly` as the discovery-mode switch. Post-PR #247 it
also drives the coverage-exclusion rewrite. The single flag couples
three independent decisions (hide portfolio/watchlist buckets, exclude
covered-ticker signals, ignore `triggerId`). When one of those needs
tuning per archetype, all three move together. The right shape is a
small `ToolContext.mode: "DAILY" | "DISCOVERY" | "TACTICAL"` enum.

---

## Proposed redesign

A spec, not code. Implementation should follow user sign-off.

### A. Branch the discovery prompt by archetype family

Three families, picked off `AgentConfig` (which already carries
`holdDurations` + the analystPrompt — the latter we can fingerprint
against the archetype catalog, or store the chosen archetype id
explicitly on the config).

| Family | Archetypes | Primary surface | Secondary | Skip |
|---|---|---|---|---|
| **EVENT_DRIVEN** | Earnings Drift, Catalyst Event | `get_earnings_calendar` (full firm, 7-30d ahead) + `read_signals` for catalyst signals | filings via `get_sec_filings`, EPS history via `get_earnings_data` | movers |
| **MOMENTUM** | Momentum Breakout, Mean Reversion, Sector Rotation, Unusual Options | `get_market_movers` (gainers + losers + actives, scope:"all") + `get_market_context` for regime | `read_signals` for confirming flow | earnings (unless catalyst-adjacent) |
| **FUNDAMENTAL** | Deep Value, Thematic Secular, Insider Cluster | `read_signals` (lookbackDays: 7) filtered by analyst's themes + `get_sec_filings` | `get_earnings_data` for quality checks | today's movers |

A fourth bucket — **DAY** — should not run weekly discovery at all
(see Gap 18). Either skip them in the cron, or replace with an
intraday "today's tape preview" workflow that runs each morning.

Each family gets its own prompt template with:

- The right Step-1 source priority (don't anchor MOMENTUM on
  read_signals when movers is the firehose).
- A scoring rubric tuned to that family. EVENT_DRIVEN scores catalyst
  proximity + EPS surprise margin, not trendStrength. MOMENTUM scores
  trendStrength + RS + volume + entry quality (current rubric). DEEP
  VALUE scores valuation gap + balance-sheet quality + sentiment
  contrarianism.
- A lower composite threshold (5/10) for WATCHING, higher (7/10) for
  high-conviction ACTIVE + starter trade.

### B. Cron-side prefetch + summarize, then narrate

Today the cron hands the agent an empty system prompt + a kickoff
user message. The agent then makes its own decision about what to
scan. That's where the prose-termination failures come from — the
agent has no work to start on.

Better: do the scan in the cron, summarize it in the system prompt
as **today's data**, and have the agent enter at the *scoring* step.
Same shape as the daily-run prompt, which injects portfolio +
priorityReviews + triggersFired + activeTheses as text *before* the
agent starts working.

The agent's Step 1 then becomes: "Here are 12 candidate tickers
filtered by your fence and excluded from your coverage. Score them.
Mint up to 5 WATCHING theses." No firehose calls, no tool-call
discipline trap, no scope:"universe" ambiguity.

### C. Universe enforcement at tool boundary

`get_market_movers` and `get_earnings_calendar` should accept
`mode: "DISCOVERY" | "DAILY"` (or read `ctx.mode`) and:

- DISCOVERY mode: apply sector/industry/exclusion fence at the tool,
  exclude coverage set, surface 15-25 candidates.
- DAILY mode: current behavior (no fence beyond watchlist intersection).

Today the prompt asks the model to do this. The model can't enforce
its own fence reliably. Move it to the tool.

### D. Drop the per-step ResearchRun creation outside the try/catch

[discovery-run.ts](lib/inngest/functions/discovery-run.ts) should
either (a) wrap the entire body of the step.run including
`researchRun.create` in a try/catch so retries are pure, or (b) move
the ResearchRun create *before* the step.run and pass the runId in,
so the retry doesn't create a second row. Either way, fix the
idempotency hole.

### E. Make "minted theses with no record_run_summary" a partial-success

Change the COMPLETE/FAILED branch in
[discovery-run.ts:217](lib/inngest/functions/discovery-run.ts:217) to:

- `newTheses > 0 && ranSummary` → COMPLETE
- `newTheses > 0 && !ranSummary` → COMPLETE_PARTIAL (new status), or
  COMPLETE with a `parameters.note` flag indicating the summary call
  was missed.
- `newTheses === 0 && ranSummary` → COMPLETE (legitimate zero-result)
- `newTheses === 0 && !ranSummary` → FAILED

The page and run-feed UI then differentiate "the work landed but
the cleanup didn't" from "nothing landed."

### F. Cross-analyst pre-fence

Before the per-analyst loop spawns the agent, query the union of
ACTIVE+WATCHING thesis tickers across **all other analysts on the
account** and pass it as another set to exclude (alongside the
analyst's own coverage). Saves a trip through `record_thesis`'s
same-direction guard, makes the cross-analyst rule visible to the
agent, and turns "the analyst tried to mint duplicate coverage three
times" into "the analyst never saw the duplicate candidate to begin
with."

### G. Drop `lookbackDays` defaulting to 0 in discovery mode

Either change the read_signals default when `ctx.mode === "DISCOVERY"`
to `lookbackDays: 7`, or have the prompt explicitly say
`lookbackDays: 7` on the Step 1 call. Sunday is the wrong day to
scan today's signals — there are none.

---

## Open questions

1. **One prompt vs three?** The family branching (A) is more work
   upfront but produces dramatically better candidates per archetype.
   Alternative: keep one prompt but make Step 1 source-priority a
   templated variable read off the chosen archetype. Which is the
   right trade-off here?

2. **Where does the chosen archetype id live?** Today it's implicit
   in `analystPrompt`. To branch by archetype we either (a) add
   `AgentConfig.archetypeId: string?`, (b) infer it from `holdDurations`
   + `defaultFeeds` overlap with the catalog, or (c) re-derive it at
   runtime via a one-shot classifier call. Option (a) is the cleanest
   but requires a migration.

3. **DAY-only analysts in the weekly cron — skip or repurpose?**
   Skipping is one line. Repurposing (turning their weekly slot into
   an intraday preview that runs each morning) is a bigger project
   but might be the right shape for the DAY playbook anyway.

4. **Should discovery directly place trades (ACTIVE + place_trade)
   at all?** VISION says discovery seeds Pillar 3, which says
   WATCHING → ENTER trigger → tactical promotes. The "high-conviction
   starter" path in the current prompt is an architectural bypass.
   Either it should be removed (force everything through the trigger
   path) or it needs explicit framing as "exceptional only."

5. **Are the FMP movers + earnings firehoses actually the right
   discovery surfaces for MOMENTUM, or should the signal router pre-
   process them into routed signals?** Today the cron writes
   aggregate Signal rows for the firehoses, so they SHOULD be visible
   via `read_signals`. If they are, the three-source funnel in Step 1
   is redundant — read_signals already has the data. Worth confirming
   by inspecting a router output the day after a fresh firm-market-sweep.

6. **What's the right WATCHING composite threshold?** I proposed 5.
   It could be 4 (more inclusive, expect more daily-run pruning later)
   or 6 (more selective, trust the discovery agent's filter). The right
   number depends on what fraction of WATCHING theses actually convert
   to ACTIVE via trigger-fire in a 30-day window — data we don't have
   yet.

7. **Should discovery have a "scratch pad" between Step 1 and Step 3?**
   Daily-run injects the portfolio table into the prompt; the agent
   doesn't reconstruct it. Discovery could inject the candidate list
   the same way (Section B above). The trade-off: more cron-side
   compute, less agent-side reasoning surface. For a 25-step budget,
   probably worth it.
