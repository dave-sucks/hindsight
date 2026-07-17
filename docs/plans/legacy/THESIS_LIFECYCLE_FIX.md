> **SHIPPED/SUPERSEDED — see [`../../THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md); kept as build history.**

# Thesis Lifecycle Fix — closing the read / refresh / immediate-buy loop

**Status:** Plan written 2026-05-24. Nothing implemented yet. Open for review.
**Branch staging:** the partial work on `claude/modest-hypatia-99f8bd`
(promotion-rewrite fan-out + half-broken staleness gate) folds into Phase 2
of this plan rather than shipping as-is.
**Migration risk:** ZERO. No schema changes. Tool allowlist + prompt + tool
arg shape changes only.

---

## The problem in one sentence

The thesis-writer sub-agent produces Goldman-depth equity research and writes
it to nine columns on the Thesis row, but **no agent that makes a trade
decision ever reads it**, and **no agent except thesis-writer can ask for a
refresh** — so the research is dead weight, the decision agents fly blind,
and we have no story for what to do when research is stale or missing.

## How we got here

Thesis-research V2 was built as a clean primitive (the `write_thesis_research`
meta-tool + `dispatch_thesis_research` orchestrator) and wired into two
producers (Discovery's two-pass funnel and Principal Chat). The consumer
side was deferred — `THESIS_RESEARCH_V2.md` Phase 3 ("daily-run staleness
gate + read-side surfacing") was scoped but never implemented. Promotion
(PR #324) added a third producer (promote-analyst.actions.ts fan-out) but
again deferred the consumer side. The half-shipped staleness gate I
attempted on 2026-05-24 exposed the gap rather than closing it: the gate
fires on stale research and tells the agent to call a tool that isn't in
its allowlist.

This plan finishes the V2 consumer side, makes refresh available from every
cycle, and adds the "buy this discovery today" path that doesn't exist today.

---

## Audit — what each cycle does TODAY (verified against code)

| Cycle | Writes research? | Reads research? | Can refresh? | Immediate-buy path? |
|---|---|---|---|---|
| **Discovery** (Sun 9 AM, `discovery-run.ts`) | YES — dispatches thesis-writer for picks scoring ≥4 | NO — `get_theses` used only for overlap check | NO — prompt forbids touching existing | NO — prompt + clamp + no entry trigger ready |
| **Daily** (Weekday 8 AM, `morning-research.ts`) | NO — `dispatch_thesis_research` not in allowlist | NO — `get_theses` defaults to dropping research blob; prompt never asks | NO — tool missing | n/a (already runs daily) |
| **Tactical** (event-driven, `tactical-run.ts`) | NO — same | NO — prompt injects belief + 5 recent updates only | NO — tool missing | YES on ENTER triggers, but acts on shallow context |
| **Promotion** (`promote-analyst.actions.ts`) | YES — fans out one refresh per PROMOTED thesis (just-shipped, on branch) | n/a (server action) | This IS the refresh path | Indirect — first live run buys |

Reading down the columns: the read column is **all NO**. The refresh column
is **NO for every agent that needs it**. The write column has two producers
that operate at the edges (Sunday cron, click-promote) but no producer that
fires when an agent in-the-moment realizes the world has changed and wants
to re-anchor.

## The vision (confirmed with David 2026-05-24)

Deep research is the load-bearing asset of the product. The difference
between "this analyst is a chart-pattern scanner" and "this analyst is a
junior PM at a fund" is whether every trade decision is anchored to a
fresh, dossier-depth note that the agent has actually read.

That means:

1. **Every cycle that decides whether to trade reads the research.** Daily
   walking active+watching positions reads the dossier on each. Tactical
   firing on a trigger reads the dossier before acting on the trigger.
   Discovery reading a candidate it's seen before pulls up the prior
   dossier (and the prior PASS rationale if there is one).

2. **Any cycle can request a refresh.** If the agent looks at a 30-day-old
   dossier and the world has visibly changed (earnings since, multiple
   compression, new guidance, sector rotation), it can call
   `dispatch_thesis_research(refresh)` and wait. That is the only legal
   path back to a clean trade decision. The current "I'll just look at
   the chart" workaround disappears.

3. **Discovery can trade today.** When the Sunday discovery scan surfaces
   a name where the right action is "buy today, not next Monday," there
   is a path: mint thesis → dispatch refresh inline → wait for it to
   land → place_trade in the same run. Today this doesn't exist.

4. **Promotion preserves and renews before deciding.** The user clicks
   promote, the rewrite fans out, and either the first live run waits for
   all rewrites to land OR the first live run self-heals via the same
   refresh path any other cycle uses. No fragile race condition.

---

## Phase 1 — Make research visible (the READ side)

**Goal:** every cycle that decides whether to trade has the dossier in its
context when it decides.

### Concrete changes

**`lib/agent/tools/get-theses.ts`**

Today: the tool has an `include_research: boolean` arg defaulting to
`false`. When false, the response excludes `snapshot / bullCase / bearCase /
fundamentals / recentCatalysts / latestEarnings / catalystsAndEvents /
analystConsensus / insiderTechnical / researchData`. Nothing in any prompt
asks for `include_research: true`, so it's never set.

Change the default. Specifically:

- `include_research` defaults to `"summary"` (a new tier) — returns
  `snapshot` + `bullCase` + `bearCase` + `researchUpdatedAt` + new
  `researchAge` summary string.
- `include_research: "full"` returns all 9 sections (today's `true` behavior).
- `include_research: false` returns none (today's default — kept for the
  rare caller that explicitly doesn't want it).

The summary tier is the sweet spot: ~1KB per thesis (vs ~5KB for full),
covers the three sections an agent needs to make a trade decision, and
exposes the freshness so the agent can decide whether to refresh.

Add `researchAge` as a computed field on each returned thesis:

```ts
type ResearchAge = {
  daysOld: number | null;  // null if researchUpdatedAt is null
  freshness: "missing" | "stale" | "fresh";
  lastWrittenAt: string | null;  // ISO timestamp
};
```

- `"missing"` — `researchUpdatedAt` is null (legacy seed, no V2 write)
- `"stale"` — `daysOld > STALE_DAYS` (proposal: 14)
- `"fresh"` — `daysOld ≤ STALE_DAYS`

The threshold is one constant in `lib/agent/thesis-research/staleness.ts`.
14 days = fundamentals don't move that fast, but post-earnings or
post-guidance-cut the agent should still refresh; the gate is a floor not
a ceiling.

**`lib/agent/system-prompt.ts` (daily-run V2 prompt)**

Add a Stage-2 instruction (before per-thesis review): "For each thesis,
read its `snapshot`, `bullCase`, `bearCase`, and `researchAge`. If
`researchAge.freshness` is `stale` or `missing` AND you're considering
acting on this thesis (place_trade / close / scale), dispatch a refresh
first via `dispatch_thesis_research(thesis_id, mode: 'refresh')` and wait
for the worker (`step.waitForEvent('app/thesis.written')` semantics from
the agent's perspective; we'll surface this as a `wait_for_thesis_refresh`
tool — see Phase 2). If you're only marking REVIEWED with no action,
stale research is acceptable."

**`lib/agent/system-prompts/intraday-tactical.ts`**

Add the same instruction. Tactical is the higher-stakes refresh case —
it's about to put money on the line off a single signal — so the bar
is "stale or older than 7 days → refresh required."

**`lib/agent/run-input.ts`**

Pre-load the summary-tier research into the per-thesis context block so
the agent sees it on the first turn without a `get_theses` round-trip.
Today `activeTheses` returns `id / ticker / direction / confidence /
reasoningSummary / entryPrice / targetPrice / stopLoss / coreBelief /
horizon / nextReviewAt / catalystDate / maxHoldDays` + PROMOTED context.
Add `snapshot` (text body), `bullCase` (bullets), `bearCase` (bullets),
`researchAge`.

**Cost / context budget**

Summary tier adds ~1KB per thesis to the run-input block. For an analyst
with 30 theses (12 active + 18 watching + a handful of promoted), that's
~30KB on top of the existing ~10KB run-input. Daily-run uses GPT-5.5 with
800s function timeout and effectively unlimited context — fine. Tactical
uses Sonnet 4.6 (per the bake-off) — also fine.

### What Phase 1 alone fixes

- The daily agent reads `snapshot + bullCase + bearCase` on every thesis
  before deciding. The Goldman-depth notes stop being dead weight.
- The agent sees `researchAge.freshness` and can flag "this is missing"
  or "this is stale" in its rationale even before Phase 2 lands the
  refresh tool.
- Promotion's PROMOTION-framed Decision Fields (Re-enter / Downgrade /
  Invalidate, written by the worker) become readable by the first live
  daily run. The promotion fan-out's value is realized.

### What Phase 1 alone does NOT fix

- Stale or missing research is now visible but the agent has no recourse
  except to defer or proceed-anyway. That's Phase 2.
- Discovery still can't trade today. That's also Phase 2.

---

## Phase 2 — Make research refreshable from any cycle (the REFRESH + IMMEDIATE-BUY side)

**Goal:** any cycle that recognizes a research gap can fill it, in-band,
without bouncing to the next run.

### Concrete changes

**`lib/agent/modes.ts`**

Add `dispatch_thesis_research` to the tool allowlists for:

- `research-run` (daily) — currently missing
- `tactical` — currently missing
- `discovery` — present for mints; needs the new `allow_active` arg
  (see below) to be wired without changing the existing
  `forceWatchingMint` clamp

**`lib/agent/tools/dispatch-thesis-research.ts`**

Today: `forceWatchingMint` is hardcoded to `args.mode === "mint"`. That
clamp prevents discovery's mint→ACTIVE path. Loosen it:

- Add `allow_active: boolean` arg (default `false`). When `true` AND the
  caller is the discovery mode, `forceWatchingMint` is set to `false`,
  enabling the worker's `record_thesis` to mint at `direction='LONG' /
  status='WATCHING'` (still WATCHING — see below) without the clamp
  downgrading to a placeholder.
- Mode check is enforced at the tool layer (`ctx.mode === "discovery"`
  required to set `allow_active: true`). Daily and tactical can't bypass
  the clamp — they can only call refresh on existing theses.

(Important: `allow_active` doesn't mean the worker MINTS as ACTIVE.
Workflow theses always start as WATCHING; ACTIVE is owned by `place_trade`.
What `allow_active` does is let the agent that called dispatch *follow*
the dispatch with a `place_trade` call in the same run, which the
existing flow rejects because of the WATCHING clamp's side effects on
trigger generation.)

**New tool: `wait_for_thesis_refresh`**

Agents calling `dispatch_thesis_research(mode: 'refresh')` need a way
to BLOCK on the worker completing before they retry `place_trade`.
Without this, the agent fires the dispatch, drops out of the loop, and
the dispatch races the rest of the run.

New tool in `lib/agent/tools/wait-for-thesis-refresh.ts`:

```ts
defineTool({
  description: "Wait for a previously-dispatched thesis-writer refresh to land.",
  schema: z.object({
    child_run_id: z.string().describe("The childRunId returned by dispatch_thesis_research"),
    timeout_seconds: z.number().min(30).max(180).default(150),
  }),
  ui: "tool-ui",
  execute: async ({ child_run_id, timeout_seconds }, ctx) => {
    // Poll ResearchRun.status until COMPLETE or timeout
    // Optionally use Inngest waitForEvent if we expose it server-side
    // Return the updated Thesis row excerpt + researchAge
  }
})
```

Poll-based is fine for v1; ~60-120s typical wait, 2s poll interval = 30-60
polls per call. Each poll is one SELECT on `ResearchRun`. Cheap.

Allowlist: every mode that can dispatch should be able to wait. So:
research-run, tactical, discovery, principal-chat, builder, editor.

**`lib/agent/system-prompt.ts` and `lib/agent/system-prompts/intraday-tactical.ts`**

Teach the dispatch-then-wait pattern explicitly:

```
If a thesis you're about to act on has researchAge.freshness = "stale"
or "missing":
  1. dispatch_thesis_research(thesis_id, mode: 'refresh') → childRunId
  2. wait_for_thesis_refresh(child_run_id: childRunId, timeout_seconds: 150)
  3. get_theses(ticker, include_research: 'summary') → confirm freshness=fresh
  4. THEN place_trade / close_position / etc.
If the worker fails or times out, you may proceed with the original
research and add "refresh failed" to your rationale, OR defer the action
with update_thesis(REVIEWED-only). Do not silently trade off stale
research — your rationale must explicitly acknowledge it.
```

**`lib/agent/system-prompts/discovery.ts`**

Add the immediate-buy path:

```
For a candidate where the composite is ≥7 AND the catalyst is dated
within the next 5 trading days AND there's no existing ACTIVE position:
  1. dispatch_thesis_research(ticker, mode: 'mint', allow_active: true)
     → childRunId
  2. wait_for_thesis_refresh(child_run_id: childRunId)
  3. The worker writes a WATCHING thesis with full research_data + sections.
  4. update_thesis(thesis_id, change_status: 'ACTIVE', target_price,
     stop_loss, entry_price) — promotes WATCHING → ACTIVE (the rare path
     where the discovery agent itself does the promotion).
  5. place_trade(thesis_id, ...) — same-day entry.

Use this path SPARINGLY. Most discoveries are WATCHING; only fire
immediate-buy when the catalyst window genuinely can't wait for the
next daily run.
```

**`lib/agent/tools/place-trade.ts` (the gate from the half-shipped commit)**

With `dispatch_thesis_research` now in daily/tactical allowlists, the
gate's recovery instruction is satisfiable. Keep the gate but:

- The detection logic for "refresh dispatched this run" (today: looks
  for child runs with `parentRunId = ctx.runId AND mode = 'THESIS_WRITER'
  AND parameters.existingThesisId = thesis_id`) is correct — keep as-is.
- The error message points at the now-valid tools.
- Threshold matches Phase 1's `STALE_DAYS` constant (14 days), not the
  hardcoded 7 in the current shipped half-fix.

### What Phase 2 fixes

- Daily can refresh a stale thesis mid-run and trade off fresh data.
- Tactical can refresh on a 30-day-old trigger fire before deciding.
- Discovery has a path to "buy this today."
- The staleness gate works (its recovery is now valid for all callers).

### What Phase 2 does NOT fix

- The promotion race: if the first live daily-run cron fires before the
  promotion's fan-out workers complete, daily sees stale research. WITH
  Phase 2 the daily run can self-heal (dispatch → wait → trade), but
  that's an unnecessary 60-120s delay if we could just let the daily
  start a couple minutes later. Phase 3.

---

## Phase 3 — Promotion race (small)

**Goal:** make the just-shipped promotion fan-out reliably land before
the first live daily run reads PROMOTED theses, OR make the daily run
gracefully wait when it doesn't.

### Two viable shapes

**Option A — block in the server action**

`promoteAnalystToLive` waits up to ~150s for the dispatched workers to
complete. UI shows "Promotion completing — refreshing N theses…" during
the wait. Dialog closes only after success.

Pros: dialog state is honest (you see "done" only when truly done).
First live run sees fresh research guaranteed.

Cons: user waits 60-120s in the dialog (annoying). Server action ties up
a connection during that time.

**Option B — defer the first daily run with `promotionPending` flag**

Promotion sets `AgentConfig.promotionPending = true`. The morning-research
cron skips analysts with `promotionPending = true`. The thesis-writer
Inngest function, on the LAST expected refresh landing, clears the flag.

Pros: user dialog is instant. First daily run guaranteed fresh.

Cons: state machine adds a flag. If a worker fails the flag never clears
(needs a 24h timeout sweep or similar).

**Option C — rely on Phase 2 self-heal (no new mechanism)**

With Phase 2 done, the daily run can refresh in-band. Promotion stays
fire-and-forget. First daily run reads PROMOTED, sees `researchAge =
missing/stale`, dispatches refresh, waits 60-120s, then trades. Slower
first-live-run (by ~5-10 min for 5 promoted theses since each is a
separate refresh), but no new state.

### Recommendation

**Option C with one nuance.** Phase 2 gives us the self-heal path for
free; we shouldn't add machinery we don't need. The one nuance: the
promotion DIALOG should still hold open showing "Rewrites streaming" with
deep-links (that's what the branch already builds). User sees the
rewrites land in real-time; if they fire the first live run manually
before the rewrites complete, the run self-heals. If they wait until the
next 8 AM cron, the rewrites have long since landed and the run is
instant.

### Future cleanup

If self-heal feels noisy in practice (e.g. every first-live-run takes
5 extra minutes because every promoted thesis has to wait for its
refresh), revisit Option A or B. Don't pre-build for the imagined cost.

---

## Cross-cutting design decisions

### Why `summary` and `full` tiers instead of one-size-fits-all

Discovery uses `summary` to triage 50+ candidates — needs to be cheap.
Daily uses `summary` per-thesis on the first pass, can call
`include_research: "full"` to drill into the few theses it's actively
considering. Tactical loads `full` because it's already focused on one
thesis. Promotion's first-live-run uses `full` because it's the highest-
stakes call. The tier lets callers pay for what they need.

### Why a NEW `wait_for_thesis_refresh` tool and not `step.waitForEvent`

`step.waitForEvent` is an Inngest primitive; it works inside Inngest
functions but the agent loop calls tools through the AI SDK which has
no concept of Inngest steps. The wait has to live in a tool. Polling
`ResearchRun.status` is the simplest implementation and matches the
existing pattern (e.g. how `place_trade` polls Alpaca for the fill).

### Why `STALE_DAYS = 14` and not 7 or 30

Trade-off between false-positive refreshes (too short → constant
refresh churn, ~90s per call) and stale-research trades (too long →
agent acts on pre-earnings data when the earnings already happened).

14 days covers most catalysts: earnings every ~90 days, but the
post-earnings 14-day window is the high-volatility one where research
matters most. After 14 days the world has usually moved enough to
warrant a re-anchor.

The number is one constant in one file. Tunable.

### Why discovery's immediate-buy path uses `allow_active: true` not a
new mint-as-ACTIVE flow

The watchlist-collapse architecture is clear: WATCHING is the only
"trade-eligible-but-not-yet-traded" state. ACTIVE is owned by
`place_trade`. We don't want a "mint as ACTIVE" path that bypasses the
trade tool — the trade tool has the alpaca call, the position record,
the trigger regeneration. The clean shape is: mint WATCHING → promote
WATCHING→ACTIVE via `update_thesis(change_status: 'ACTIVE')` → place_trade.
`allow_active` just removes the discovery-specific clamp that today
makes step 2 impossible.

### Why we're NOT touching the prompt's stage structure

Per CLAUDE.md, the Stage-1/Stage-2/etc. headers in the daily-run prompt
are load-bearing. The 2026-04-20 incident proved that inlining the
stages breaks GPT-4o's tool-call discipline. All Phase 1/2 prompt
additions go INSIDE existing stages (Stage 2 for the read instruction;
Stage 4 for the dispatch-then-wait pattern; etc.), not as new stages.

---

## What's currently on the branch (`claude/modest-hypatia-99f8bd`)

The previous session shipped 4 of 5 useful changes and 1 half-broken one.
This plan folds them in cleanly:

| Branch change | Status in this plan |
|---|---|
| Promotion-context arg on `build-synthesis-prompt.ts` | Keep — used by Phase 2's promotion-refresh path |
| `promotion_context` plumbed through `write_thesis_research` | Keep — same |
| Auto-populate `promotion_context` in `dispatch_thesis_research` for PROMOTED-refresh | Keep — same |
| `promotionContext` threaded through Inngest worker + agent prompt | Keep — same |
| Promotion fan-out in `promoteAnalystToLive` | Keep — exactly what Phase 3 Option C wants |
| `dispatchedRewrites` UI in `PromoteAnalystDialog` | Keep — exactly what Phase 3 Option C wants |
| **Staleness gate in `place_trade`** | **Hold** until Phase 2 lands. Today's gate refuses with an unsatisfiable instruction (the tool isn't in daily/tactical allowlists). Land it as part of Phase 2's `modes.ts` change so the gate's recovery path is real on the same commit. |

**Recommendation:** rebase the branch onto a fresh commit that:
1. Drops the `place_trade` staleness gate hunk
2. Keeps everything else
3. Lands as "Phase 0 — promotion path complete" PR

Then Phase 1 / Phase 2 ship as separate follow-up PRs.

---

## Order of operations

1. **Phase 0** (= rebase the current branch with the staleness gate removed).
   PR title: "Promotion-aware thesis refresh fan-out". Ship.
2. **Phase 1** PR — read-side. Get `include_research: 'summary'` default +
   `researchAge` + run-input pre-loading + prompt instructions. Ship.
3. **Phase 2** PR — refresh-side. Allowlists + `wait_for_thesis_refresh`
   tool + `allow_active` arg + prompt instructions + reinstated
   `place_trade` staleness gate. Ship.
4. Skip Phase 3 — rely on self-heal. Revisit only if it bites.

Total: 3 PRs, each independently safe to ship. No schema changes anywhere.

---

## Test plan (per phase)

### Phase 0 (promotion fan-out)
Already specified in the original session's test plan:
1. Promote a test analyst with 2-3 ACTIVE theses.
2. Verify success-state shows N rewrite deep-links.
3. Watch the rewrites stream.
4. Confirm each PROMOTED thesis has fresh `researchUpdatedAt` + promotion-
   framed Decision Fields.

### Phase 1 (read side)
1. Trigger a manual daily run on an analyst with 2-3 ACTIVE theses that
   have populated research.
2. Inspect the run transcript: confirm the agent's per-thesis rationale
   references specific bull/bear case bullets from the dossier (not just
   coreBelief).
3. Trigger a daily run on an analyst with a thesis that has
   `researchUpdatedAt = null`. Confirm the agent's rationale notes
   "research missing" in its decision.
4. Promote an analyst. After rewrites land, trigger the first live daily
   run manually. Confirm the agent references PROMOTION-framed Decision
   Fields ("re-enter / downgrade / invalidate") in its per-thesis call.

### Phase 2 (refresh side + immediate-buy)
1. Trigger a daily run on an analyst with a stale (>14 days) WATCHING
   thesis. Confirm the agent calls `dispatch_thesis_research` →
   `wait_for_thesis_refresh` → `get_theses` → trades only after fresh
   research lands.
2. Force a worker timeout (kill the Inngest dev service). Confirm the
   agent proceeds with explicit "refresh failed" rationale OR defers.
3. Trigger a discovery run on a Sunday where a candidate hits the
   immediate-buy criteria (composite ≥7, catalyst within 5 days). Confirm
   the mint → wait → promote → place_trade flow lands a same-day position.
4. Trigger `place_trade` directly from principal chat on a 20-day-old
   WATCHING thesis. Confirm the staleness gate fires AND the agent
   complies (dispatches refresh → waits → retries).

---

## Open questions

These are real questions I don't have answers to. Want your call before
implementing:

1. **`STALE_DAYS = 14` — right number?** My case for 14 is in the
   cross-cutting section. Could be 7 (stricter, more refresh churn) or
   30 (laxer, more risk of trading on dead context). Pick one.

2. **Should the daily-run agent ALSO refresh ACTIVE theses opportunistically?**
   Today's plan: refresh on stale ACTIVE only if the agent is about to
   close or scale. Could be: refresh every Friday's daily-run for any
   ACTIVE thesis with research > 14d, regardless of action intent
   (weekly-checkup pattern). Costs ~90s × N theses per Friday but keeps
   the dossier evergreen.

3. **Discovery's immediate-buy threshold (composite ≥7, catalyst ≤5d)
   — right cutoffs?** These are mine, not researched. The right shape
   might be "discovery never immediate-buys; that's tactical's job after
   the discovery-minted WATCHING thesis sits for 24h." More conservative,
   simpler.

4. **Should `wait_for_thesis_refresh` be replaced by making
   `dispatch_thesis_research` itself sync (await internally)?** Cleaner
   API but couples the agent's wall-time to the worker's. Today's plan
   (separate tool) lets the agent fire multiple refreshes in parallel
   then wait on them, which is the right shape for daily walking 5+
   stale theses.

5. **Backfill question:** the 36 legacy WATCHING theses with NULL
   `researchUpdatedAt` (per 2026-05-24 diagnostic). Pre-emptively
   dispatch refreshes for all of them in a one-off script? Or let the
   gate fire naturally on first trade attempt? Either way, post-Phase-2
   it self-heals. Just pick which feels right operationally.

---

## See also

- [`THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) — the durable
  thesis lifecycle reference. Update §9 (producers + gates) and §10
  (consumers) once Phases 1+2 land.
- [`THESIS_RESEARCH_V2.md`](../THESIS_RESEARCH_V2.md) — the V2 plan that
  built the producer side. Mark Phase 3 (read-side surfacing) as
  superseded by this plan.
- [`PROD_DEPLOYMENT_PLAN.md`](../PROD_DEPLOYMENT_PLAN.md) — the
  PAPER→LIVE promotion plan. This plan's Phase 3 supersedes its
  "first-live-run rebuy steering" because promotion-refresh is now the
  primary mechanism.
- [`PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle. All
  refresh logic lives at Layer 1 (tool gates) so prompts don't have to
  remember the rule.
