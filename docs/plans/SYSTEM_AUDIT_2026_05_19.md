# Hindsight — System Audit 2026-05-19 (priority queue)

> **What this is:** the live priority queue for the post-tactical-review system
> audit. Lives outside [`GAPS.md`](../GAPS.md) because every item here is a P0
> blocker; the GAPS doc is the rolling thesis-architecture rework punch list,
> this doc is the "stop everything and fix these" list. Companion to
> [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) (the live reference)
> and to the daily / discovery / tactical run reviews in `docs/run-reviews/`,
> `docs/discovery-reviews/`, `docs/tactical-reviews/`.
>
> **What's in scope:** four categories surfaced together by the 2026-05-19
> audit — the **data-layer hole** that breaks every entry, the **trigger
> hygiene gaps** that turn the run feed into noise, the **discovery cap
> blowout** that just flooded the book, and the **gpt-5.5 verbosity shift**
> that broke the REVIEWED vs UPDATED audit-log distinction. Each is documented
> with the production data behind it, the code path that needs to change, and
> where it sits in the order of attack.
>
> **What's NOT in scope:** anything already tracked in
> [`THESIS_RESEARCH_V2.md`](./THESIS_RESEARCH_V2.md) (the deep-research
> rewrite). The audit findings are pre-V2 hygiene; V2 lands on top of a
> system that doesn't have these holes.
>
> **Owner:** principal. **Audience:** future sessions picking this up cold —
> the audit transcripts are too long; this doc is the durable artifact.

---

## 0. Status table

| # | Item | Severity | Status |
|---|---|---|---|
| **A1** | `get_stock_data.technicals` returns `null` on 100% of runs — blocks every entry | **P0 — blocker** | **PR open #289** ✓ |
| **A2** | `place_trade` doesn't drop ENTER triggers on WATCHING → ACTIVE promotion (AVGO fires 8×) | **P0 — wild-west symptom** | **PR open #292** ✓ |
| **A3** | Discovery cap is supposed to be 8 / run; ran at 7-8 / run on 2026-05-17 → 38 new WATCHING in one day | **P0 — book flood** | **PR open #293** ✓ (Layer-1 enforcement) |
| **A4** | Newly-minted WATCHING theses get `nextReviewAt = createdAt + ~4-7d` regardless of horizon — COMPOUNDER should be 30-90d | **P0 — review storm** | **PR open #291** ✓ |
| **A5** | `REVIEW_DATE_HIT` trigger uses a flat 7d cooldown, ignoring horizon. Should track horizon hygiene cadence (14/30/90d) | **P0 — review storm** | **PR open #291** ✓ (bundled with A4) |
| **A6** | `complete_run` preflight refuses every tactical run for missing `record_run_summary` but tactical can't call it | **P1 — cosmetic but training agent to ignore gates** | **PR open #290** ✓ |
| **A7** | `update_thesis` classifies narrative-only patches as UPDATED instead of REVIEWED — audit log collapsed since gpt-5.5 swap | **P1 — audit-log hygiene** | **PR open #290** ✓ (bundled with A6) |
| **A8** | Cross-analyst discovery duplication: 4 analysts added AMBA on the same Sunday | **P2 — book quality** | Open (defer — revisit after A3 ships) |

### Follow-on findings (post-A1 / A2 / A4 re-audit)

| # | Item | Status |
|---|---|---|
| **B1** | `get_stock_data` made Alpaca primary, dropped dead Finnhub `/stock/candle` + FMP `/historical-price-full` fallbacks (~500ms latency cleanup) | **PR open #294** ✓ |
| **B2** | FMP `/api/v3` + `/v4` deprecated 2025-08-31 — migrated every tool to `/stable/*` paths. Affects get_stock_data, get_options_flow, get_market_context, get_financials_deep, get_earnings_history, get_analyst_coverage, get_peers_with_metrics | **PR open #294** ✓ (bundled with B1) |
| **B3** | One-shot repair script `fix-watching-next-review.ts` for the 56 existing WATCHING theses with too-short `nextReviewAt` (pre-A4 production state) | **PR open #294** ✓ (bundled) |
| **B4** | `reconcile-orders.ts` Position-close fill silently null-ed `closeReason` + `closeSource`. 4 mystery 5/18 closes (AMZN, TSM, NVDA, AMD) traced to this path | **PR open #295** ✓ |
| **B5** | Anti-regression tests for `WATCHING_FIRST_REVIEW_DAYS` ≥ `HORIZON_REVIEW_DAYS` + per-horizon REVIEW_DATE_HIT cooldown coverage | **PR open #295** ✓ (bundled with B4) |
| **B6** | Zombie-position guard in `update_thesis` extended to `change_status='CLOSED'` (was only INVALIDATED + ARCHIVED before — CLOSED was a third polarity of the same bug) | **PR open #295** ✓ (bundled) |
| **B7** | Removed legacy keyword-scan promotion gate from `record_run_summary` (~220 lines). `complete_run`'s preflight (PR #266) is the structural superset; the keyword regex was false-failing legitimate rejections. Closes [GAPS P1-13](../GAPS.md#p1-13--old-promotion-keyword-gate-in-record_run_summary-is-now-redundant--actively-wrong) | **PR open #296** ✓ |

---

## 1. Production data snapshot (the numbers driving this list)

Snapshot as of 2026-05-19 morning. Re-run the queries at the bottom of the
tactical-review file ([`docs/tactical-reviews/2026-05-18.md`](../tactical-reviews/2026-05-18.md))
to refresh.

### Tactical surface — 14 days

| Metric | Value | Notes |
|---|---|---|
| Total tactical runs | 144 | |
| COMPLETE / FAILED | 128 / 16 | All 16 failures clustered on 2026-05-11; nothing since |
| `place_trade` calls | 11 | All 11 were 5/07–5/14 |
| `close_position` calls | 5 | EXIT-action runs |
| `manage_position` calls | 3 | One TRIM on 5/15 |
| `update_thesis` ARCHIVED rows | **0 in 14 days** | Tactical has never archived a thesis |
| `get_stock_data.technicals` non-null | **0 / 128** | 100% null. See A1 |
| ENTER conversion rate | 31% (11/36) | Of 36 PRICE_ABOVE/ENTER triggers, 11 placed trades |
| EXIT conversion rate | 50% (5/10) | Of 10 EXIT triggers, 5 closed/managed |
| **Wasted ENTER fires** | **35 / 36** | ENTER on already-held names (AVGO 8×, GOOGL 7× etc.) |

### Daily-run surface — today (2026-05-18) vs prior

| Metric | 2026-05-18 | 2026-05-15 | Notes |
|---|---|---|---|
| Morning runs (total / OK / fail) | 7 / 5 / 2 | 6 / 6 / 0 | Earnings Drift narration-gate FAIL (correct catch); Secular Theme timeout retry |
| `place_trade` calls | 0 | 0 | Same null-technicals blocker as tactical |
| `close_position` calls | **10** | 0 | Cleaning up zombie ACTIVE theses |
| `update_thesis` type = UPDATED | 18 | 25 | |
| `update_thesis` type = REVIEWED | **0** | 3 | See A7 — gpt-5.5 verbosity collapse |
| `update_thesis` type = INVALIDATED | **9** | 0 | Tech Momentum mass-prune on risk-off tape |
| `update_thesis` type = CLOSED | 7 | 0 | The zombie sweep |
| `update_thesis` type = STATUS_CHANGED | 1 | 0 | |

### Open book by analyst (current)

| Analyst | ACTIVE | WATCHING | Open positions | Triggers monitored | INV in 14d | ARC in 14d | CLO in 14d |
|---|---|---|---|---|---|---|---|
| Secular Theme | 4 | 18 | 2 | **125** | 4 | 8 | 1 |
| Tech Momentum | 0 | 14 | **0** | 65 | 7 | 20 | 3 |
| Earnings Drift | 2 | 9 | 2 | 58 | 3 | 8 | 5 |
| EV Catalyst | 2 | 9 | 2 | 57 | 0 | 10 | 1 |
| Catalyst Event Raider | 0 | 8 | 0 | 48 | 0 | 12 | 3 |
| Intraday Scalper | 0 | 1 | 0 | 5 | 2 | 0 | 5 |
| **Total** | **8** | **59** | **6** | **358** | **16** | **58** | **18** |

**Reading:** 67 theses on the open book, 6 open positions, 358 triggers being
evaluated every 5 minutes during market hours. Tech Momentum has 14 WATCHING
and zero open positions — its entire 14-day discovery output is sitting on the
watchlist because the entry tool is broken (A1).

The pruning machine is working (58 ARCHIVED + 16 INVALIDATED + 18 CLOSED = 92
terminal rows in 14 days). But discovery is shovelling theses faster than
pruning can keep up (~38 minted on 5/17 alone vs ~6.6/day pruned average).

### Horizon assignment (this is healthy)

| Analyst | CATALYST | TRADE | TARGET | COMPOUNDER | Total | Match to strategy? |
|---|---|---|---|---|---|---|
| Secular Theme | 1 | 0 | 1 | 20 | 22 | ✓ (long-term secular) |
| Tech Momentum | 0 | 14 | 0 | 0 | 14 | ✓ (short-term momentum) |
| Earnings Drift | 3 | 0 | 8 | 0 | 11 | ✓ (earnings catalyst + swing) |
| EV Catalyst | 8 | 2 | 1 | 0 | 11 | ✓ (catalyst-heavy) |
| Catalyst Event Raider | 8 | 0 | 0 | 0 | 8 | ✓ (catalyst-pure) |
| Intraday Scalper | 0 | 1 | 0 | 0 | 1 | ✓ |

**The agent picks horizons that match analyst strategy.** The wild-west feel
is not coming from the horizon-assignment layer — it's coming from the
nextReviewAt + cooldown layers running ahead of the horizons that have been
correctly assigned.

### Discovery yield (Sunday cron)

| Sunday | Minted (WATCHING) | Per analyst | Notes |
|---|---|---|---|
| 5/07 | 1 | 0-1 | Most analysts produced 0 |
| 5/10 | 0 | 0 | 5 of 6 FAILED |
| 5/15 (Thu) | 8 | Secular Theme only | First big mint after gpt-5.5 swap |
| **5/17** | **38** | **7-8** | **The explosion** |

The cap is supposed to be 5 / run (CLAUDE.md, discovery prompt). It ran at
7-8 / run yesterday. Cap enforcement gone. See A3.

---

## 2. P0 items

### A1 — `get_stock_data.technicals` returns `null` on 100% of runs

**Severity: keystone blocker.** Until this is fixed, daily-run cannot trade
and tactical cannot trade no matter what else ships.

**Source:** Tactical run review 2026-05-18 + cross-check against morning-run
sampled data.

**Symptom.** `data.technicals` is `null` on **128 of 128** tactical runs over
the past 14 days. Same on every morning-run sampled (10/10 from 5/15 cohort).
Affected tickers cover the full market-cap spectrum — MDB ($25B), AVGO ($2T),
ZS ($20B), DELL ($158B), NVDA, AMD. Not just small-caps.

**Why this breaks trading.** The tactical prompt at
[`lib/agent/system-prompts/intraday-tactical.ts:210-214`](../../lib/agent/system-prompts/intraday-tactical.ts:210)
mandates *"today's volume needs to be 1.5x the 20-day average"* as a
pre-`place_trade` confirmation gate. The required data (`technicals.volumeRatio`)
isn't present. Agent reads instructions, calls `get_stock_data`, gets nothing
back, does the only thing possible — passes on entry. Every breakout becomes
a non-entry. The daily-run agent reads the same data and behaves identically.

**Code path.** [`lib/agent/tools/get-stock-data.ts:130-180`](../../lib/agent/tools/get-stock-data.ts:130).
The function builds `candles` from FMP `historical-price-full` (primary) or
Alpaca bars (fallback). When `candles` ends up empty/null, `technicals` ends
up null. The downstream `volumeRatio` computation at line 178 never runs.

**Hypothesis (likely).** FMP `/historical-price-full` is returning 401/403 on
the legacy plan AND the Alpaca-bars fallback isn't catching the failure
because of a `candles.s !== "ok"` guard short-circuiting before fallback, or
the fallback condition itself is wrong. CLAUDE.md warns *"FMP historical-price-full
may 403 on legacy plan (affects technical analysis for small-cap/ADR tickers)"*
— except it's 100% of tickers, not just small-cap.

**Fix path.** Re-audit the FMP→Alpaca fallback chain in get-stock-data.ts.
Probable shapes:

- (a) Switch Alpaca-bars to primary; FMP becomes fallback. Alpaca data is
  what we trade against anyway.
- (b) Keep FMP primary but make the fallback condition `!candles || candles.s !== "ok" || candles.c.length === 0`
  (current condition is incomplete).
- (c) Add a one-line log when both providers fail, so this can't silently
  recur.

Verify with a manual call against MSFT — expect `technicals.volumeRatio` to
come back non-null.

---

### A2 — ENTER triggers don't drop on WATCHING → ACTIVE promotion

**Severity: wild-west symptom.** 35 of 36 ENTER-trigger tactical runs in 14
days fired on tickers the analyst already held. Pure wasted compute, and the
single biggest reason the trigger feed looks chaotic.

**Source:** Tactical run review 2026-05-18.

**Symptom.** Recurring ENTER fires on already-OPEN positions:

| Analyst | Ticker | ENTER fired 14d | Position state |
|---|---|---|---|
| Earnings Drift | AVGO | **8 times** | OPEN since 4/06 |
| Secular Theme | AVGO | 7 | OPEN since 4/13 |
| Secular Theme | GOOGL | 7 | OPEN since 5/07 |
| Earnings Drift | TSM | 5 | OPEN until 5/18 close |
| Tech Momentum | TSM | 4 | CLOSED 5/07 |

Every one is a tactical run that should never have happened. Agent reads
"ENTER on AVGO," sees AVGO already OPEN, writes update_thesis saying *"ENTER
trigger is stale — position is already active."* The position has been ACTIVE
for over a month and the same ENTER trigger fires every single day.

**Root cause.** `place_trade` ([`lib/agent/tools/place-trade.ts`](../../lib/agent/tools/place-trade.ts))
flips a thesis WATCHING → ACTIVE atomically (PR #265). But it does NOT drop
the ENTER triggers from the now-active thesis's `triggers[]` array. They sit
there forever, re-firing every time price ticks above the breakout level.

The trigger evaluator ([`lib/inngest/functions/trigger-evaluator.ts`](../../lib/inngest/functions/trigger-evaluator.ts))
doesn't filter by thesis status — it walks triggers for ACTIVE + WATCHING
theses uniformly. An ENTER trigger on an ACTIVE thesis is structurally
nonsensical (you can't "enter" something you already hold), but the system
has no opinion about that.

**Fix path.** In `place_trade`'s WATCHING → ACTIVE transition, prune the
triggers array. Two options:

- (a) Drop all triggers where `action === "ENTER"`. Conservative — keeps the
  thesis's EXIT/REVIEW triggers (which become operational once held).
- (b) Replace the entire trigger array with the horizon-keyed HELD defaults
  via `defaultTriggersForHorizon(horizon, thesis, "HELD")`. Aligns the active
  thesis with the defaults it would have gotten if minted in the held state.

Recommend (b). It also sweeps up any other stale-on-promotion triggers
(WATCHING templates have `REVIEW_DATE_HIT` with watching cadence; HELD
templates have different review structure).

Migration: existing ACTIVE theses with leftover ENTER triggers (AVGO, GOOGL,
etc.) need a one-shot SQL cleanup at deploy time. ~5-10 rows.

---

### A3 — Discovery cap blew out: 38 new WATCHING in one Sunday

**Severity: book flood.** Yesterday's discovery doubled the per-analyst book
in a single morning. The cap was supposed to be 5 / run; it ran 7-8 / run.

**Source:** 2026-05-17 Sunday discovery review (5 analysts ran COMPLETE).

**Symptom.**

| Analyst | New WATCHING 5/17 | PASS / ARCHIVED 5/17 |
|---|---|---|
| Tech Momentum Trader | 8 | 6 |
| Catalyst Event Raider | 8 | 5 |
| Earnings Drift Trader | 8 | 4 |
| EV Catalyst Event Trader | 7 | 3 |
| Secular Theme Architect | 7 | 3 |
| **Total** | **38** | **21** |

Compare to historical:

| Sunday | Per-analyst mint |
|---|---|
| 5/07 | 0–1 |
| 5/10 | 0 (5/6 failed) |
| **5/17** | **7–8** |

**Root cause.** Discovery prompt got rewritten in PRs #268 + #271 + #273
(2026-05-13 → 2026-05-15) — triage rules + GPT-5.5 swap + maxDuration
tuning. The "5 per run" cap line in the prompt is either gone or being
ignored by gpt-5.5's longer reasoning budget.

**Fix path.** Two layers (per the three-layer principle):

- **Layer 1 (tool):** `record_thesis` rejects the 6th WATCHING mint per run.
  Counts current-run WATCHING-direction `record_thesis` calls; refuses with
  a structured error when count ≥ 5. Layer-1 enforcement so prompt drift
  can't quietly raise the cap again.
- **Layer 3 (prompt):** Confirm the discovery prompt still states the cap.
  If it doesn't, restore it. Wording should be explicit: *"Mint at most 5
  new WATCHING theses per run. Beyond 5, PASS the remainder with rationale."*

Bonus: a one-off SQL to ARCHIVE the duplicates from 5/17 (see A8) — anything
that 3+ analysts added simultaneously is institutional pile-on, not edge.

---

### A4 — Newly-minted WATCHING theses get short `nextReviewAt` regardless of horizon

**Severity: review storm.** This is the root cause of "every stock is being
reviewed every other day." Compounders (90d cadence by design) are being
scheduled for first review 30 days out — too aggressive. Catalysts (14d
cadence) are being scheduled for 4.5 days out. The triggers fire, REVIEW_DATE_HIT
loads up the tactical surface, and Mondays after a big Sunday discovery look
like nonsense.

**Source:** This audit. Query result:

```
horizon       minted (7d)   avg_days_to_first_review
COMPOUNDER    15            30.0       ← should be 90
TRADE         15            4.1        ← reasonable (TRADE is 14d max)
CATALYST      13            4.5        ← should be ~14
TARGET        8             7.0        ← reasonable (TARGET = weekly)
```

**Why this matters.** The trigger system already encodes per-horizon review
cadences correctly in [`horizon-policy.ts`](../../lib/agent/horizon-policy.ts)
and [`triggers/defaults.ts`](../../lib/agent/triggers/defaults.ts):

| Horizon | `HORIZON_REVIEW_DAYS` | Hygiene trigger cadence |
|---|---|---|
| CATALYST | 1 | TIME_ELAPSED days=14, cooldown=12 |
| TRADE | 1 | TIME_ELAPSED days=maxHoldDays, cooldown=80% |
| TARGET | 7 | TIME_ELAPSED days=30, cooldown=25 |
| COMPOUNDER | 30 | TIME_ELAPSED days=90, cooldown=80 |

`HORIZON_REVIEW_DAYS` is what `record_thesis` uses to compute `nextReviewAt`
when the agent doesn't supply one. But these are defaults for the
**held-side** review cadence — they're too aggressive for newly-minted
WATCHING theses that haven't moved yet.

A newly-minted COMPOUNDER WATCHING does NOT need a review in 30 days. The
underlying business doesn't change that fast. The first review should track
the **hygiene trigger** cadence (90 days for COMPOUNDER), not the held-side
operational cadence.

**The right pattern.** For WATCHING-direction theses, set `nextReviewAt`
based on the hygiene-trigger cadence in the WATCHING template:

| Horizon | WATCHING first-review-at |
|---|---|
| CATALYST | createdAt + 14 days (catalyst-window hygiene) |
| TRADE | createdAt + 14 days (trade-window hygiene) |
| TARGET | createdAt + 30 days (monthly hygiene) |
| COMPOUNDER | createdAt + 90 days (quarterly hygiene) |

**Fix path.** `record_thesis` ([`lib/agent/tools/record-thesis.ts`](../../lib/agent/tools/record-thesis.ts))
when minting a LONG/SHORT WATCHING thesis:

```ts
const WATCHING_FIRST_REVIEW_DAYS: Record<Horizon, number> = {
  CATALYST: 14,
  TRADE: 14,
  TARGET: 30,
  COMPOUNDER: 90,
};
const defaultReviewDays = WATCHING_FIRST_REVIEW_DAYS[horizon];
nextReviewAt = args.next_review_at ?? addDays(now, defaultReviewDays);
```

The agent can still override `next_review_at` when a specific signal warrants
a faster look (earnings in 5 days, etc.). The default just stops the "review
in 4 days for everything" behavior.

**Edge case — PENDING.** PENDING theses (user-added seeds) should still get
`nextReviewAt = createdAt` so the next daily run picks them up immediately
for first research. Those are first-research-due, not first-review-due. Keep
that path as-is.

**Migration.** Update the 38 newly-minted theses from 5/17 to push
`nextReviewAt` out per horizon (one SQL).

---

### A5 — `REVIEW_DATE_HIT` cooldown is flat 7d, ignores horizon

**Severity: review storm (companion to A4).** Even after A4 fixes the
initial scheduling, REVIEW_DATE_HIT re-fires every 7 days regardless of
horizon. A COMPOUNDER WATCHING fires daily-then-7d-then-7d-then-7d. Should
be quarterly.

**Source:** Code read at
[`lib/agent/triggers/defaults.ts:317-322`](../../lib/agent/triggers/defaults.ts:317).

```ts
function reviewDateHitTrigger(): Trigger {
  return {
    id: createId(),
    predicate: { kind: "REVIEW_DATE_HIT" },
    action: "REVIEW",
    rationale: `Scheduled review date reached. Walk the thesis against today's tape.`,
    cooldownDays: 1,  // ← flat across horizons
  };
}
```

And at [`lib/agent/triggers/defaults.ts:625-627`](../../lib/agent/triggers/defaults.ts:625):

```ts
case "REVIEW_DATE_HIT":
  return 7;  // ← default-cooldown fallback also flat
```

**Why this matters.** REVIEW_DATE_HIT fires when `nextReviewAt < now`. Once
fired, the cooldown stops it from re-firing for N days. A 1-day cooldown
means the same REVIEW fires every market day until the agent updates
`nextReviewAt`. The agent's `update_thesis` does auto-bump `nextReviewAt` by
horizon cadence (good — there's a fix at lines 819-852 of update-thesis.ts
for this exact bug). So in practice the cooldown matters less because the
nextReviewAt bump pushes the predicate out of the fired window.

**But** the 7d fallback (in `defaultCooldownDaysForPredicate`) WILL bite
when nextReviewAt is set short (per A4). With A4 fixed, A5 becomes a
papercut — but worth fixing in the same PR for symmetry.

**Fix path.** Make `reviewDateHitTrigger()` horizon-aware:

```ts
function reviewDateHitTrigger(horizon: Horizon): Trigger {
  const cooldown = {
    CATALYST: 7,    // catalyst events move fast
    TRADE: 7,       // trade windows are short
    TARGET: 14,     // monthly-ish
    COMPOUNDER: 60, // quarterly-ish
  }[horizon];
  return {
    id: createId(),
    predicate: { kind: "REVIEW_DATE_HIT" },
    action: "REVIEW",
    rationale: `Scheduled review date reached. Walk the thesis against today's tape.`,
    cooldownDays: cooldown,
  };
}
```

Same for `defaultCooldownDaysForPredicate` — it should take the horizon
context. (Sometimes the predicate has no horizon context though — review
the call sites.)

---

## 3. P1 items

### A6 — `complete_run` preflight refuses every tactical run

**Severity: cosmetic but corrosive.** Today every tactical run wastes 2 of
its 15 max steps on doomed `complete_run` retries. The runs still complete
because `tactical-run.ts:515` sets status to COMPLETE based on `update_thesis`
firing. But:

- The agent transcripts fill with refusal messages
- The model is being trained to ignore gate refusals (which leaks into
  daily-run, where they DO matter)
- The wasted steps eat into the 15-step budget that's tight to begin with

**Source:** Tactical run review 2026-05-18 (deep dive) + 5/15 daily review
Open Question 6 (caught, never resolved).

**Symptom.** `complete_run` preflight ([`lib/agent/tools/complete-run.ts:286-300`](../../lib/agent/tools/complete-run.ts:286))
fires for every run with `runId && analystId && !podcastSegmentId`. It
doesn't check mode. The first gate checks for a `run_summary` RunEvent row;
if missing, returns `no_run_summary`.

But tactical's allowlist ([`lib/agent/modes.ts:268-283`](../../lib/agent/modes.ts:268))
does NOT include `record_run_summary`. The agent literally cannot fix the
violation. Today: 70 `complete_run` calls for 35 tactical runs (2× per run).

**Fix path.** One-line mode check in the preflight:

```ts
if (ctx.runId && ctx.analystId && !ctx.podcastSegmentId) {
  // Tactical doesn't need a run_summary — it's a single-thesis run
  const skipSummaryGate = ctx.runMode === "INTRADAY_TACTICAL";
  const preflightFailure = await runCompleteRunPreflight(
    ctx.runId, ctx.analystId, { skipSummaryGate },
  );
  ...
}
```

The `unaddressed_theses` gate should still fire (single-thesis tactical
runs that don't address their one triggered thesis are real failures).

---

### A7 — `update_thesis` over-classifies as UPDATED since gpt-5.5 swap

**Severity: audit-log hygiene.** REVIEWED has been dead since 5/12 (the
gpt-5.5 swap day). Run reviews can no longer tell "agent looked at it" from
"agent edited it."

**Source:** Tactical run review 2026-05-18 + daily-run pattern across 14 days:

| Day | Model | UPDATED | REVIEWED |
|---|---|---|---|
| 5/05 | gpt-4o | 9 | 9 |
| 5/11 | gpt-4o | 4 | 6 |
| 5/12 | swap | 13 | 0 |
| 5/13 | gpt-5.5 | 14 | 0 |
| 5/14 | gpt-5.5 | 23 | 0 |
| 5/15 | gpt-5.5 | 25 | 3 |
| 5/18 | gpt-5.5 | 18 | 0 |

**Root cause.** Under gpt-5.5 the agent fills `reasoning_summary` +
`risk_flags` + `next_review_at` even on pure-housekeeping reviews. The
update-thesis tool ([`lib/agent/tools/update-thesis.ts:825`](../../lib/agent/tools/update-thesis.ts:825))
sees a non-empty patch and classifies UPDATED. Under gpt-4o the agent
called `update_thesis(rationale: "...")` with no other fields → empty
patch → REVIEWED.

**Fix path.** Reclassify "narrative-only" patches as REVIEWED. Define a
narrative-only key set:

```ts
const NARRATIVE_ONLY_KEYS = new Set([
  "reasoningSummary",
  "riskFlags",
  "thesisBullets",
  "nextReviewAt",
]);
const patchKeys = Object.keys(patch);
const isNarrativeOnly =
  patchKeys.length > 0 &&
  patchKeys.every((k) => NARRATIVE_ONLY_KEYS.has(k));
```

If `isNarrativeOnly`, write `type='REVIEWED'` instead of `UPDATED`. Structural
fields (target, stop, entry, horizon, triggers, coreBelief, keyAssumptions,
invalidationConds, status, direction) trigger UPDATED.

Same fix improves the audit-log signal for tactical too.

---

### A8 — Cross-analyst discovery duplication

**Severity: book quality, no bug.** Yesterday 4 analysts added AMBA. 2+
analysts added POET, MDB, ZS, SNOW, OKTA, NVDA, SNPS, WDAY. Not analyst
specialization — pile-on.

**Source:** Discovery yield analysis 5/17.

**Fix path.** Lower priority than A1-A5; flagged to revisit after the
cap (A3) is enforced. If the per-run cap is 5 and 6 analysts each pick 5,
some duplication is inherent (5 hot tickers × 6 analysts = 30 picks). The
real question is whether the universe fences differentiate enough — and
that's a [`P1-9` in GAPS.md](../GAPS.md#p1-9--discovery-prompt-is-archetype-blind) territory.

For now: a one-line addition to discovery's prompt — *"Before adding a
candidate, call `get_theses({ tickers: [X], scope: 'all-analysts' })`. If
2+ other analysts have already added this ticker today, you must PASS
unless you have a structurally different angle."* Soft-form Layer-3 guard.

---

## 4. Trigger philosophy — how it's *supposed* to work

The trigger system is the operational backbone — it's what decides when to
wake tactical runs. Built on three layers:

### Layer 1 — Per-horizon templates ([`lib/agent/triggers/defaults.ts`](../../lib/agent/triggers/defaults.ts))

Every (horizon, state) pair has a built-in trigger template. The agent
inherits these automatically when it mints a thesis; agent-supplied
overrides take precedence on the same (predicate.kind, action) bucket.

**WATCHING templates** (no position; entry-focused):

| Horizon | Entry trigger cooldown | Hygiene cadence | Total triggers |
|---|---|---|---|
| CATALYST | 1d | 14d | 5 (entry + REVIEW_DATE_HIT + 3 catalyst-event REVIEWs + 14d hygiene) |
| TRADE | 1d | 14d | 4 (entry + REVIEW_DATE_HIT + 2 earnings REVIEW + 14d hygiene) |
| TARGET | 1d | 30d | 5 (entry + support-REVIEW + 2 earnings + 30d hygiene) |
| COMPOUNDER | **7d** | 90d | 5 (entry + 3 fundamental REVIEW + 90d hygiene) |

**HELD templates** (position open; exit-focused):

| Horizon | Stop cooldown | Hygiene cadence | Total triggers |
|---|---|---|---|
| CATALYST | 0d (terminal) | (catalyst events) | 5 |
| TRADE | 0d (terminal) | maxHoldDays | 3 |
| TARGET | 0d (terminal) | 30d | 5 |
| COMPOUNDER | 0d (terminal) | 90d | 6 |

The template design is sound. Stops are zero-cooldown (the position closes
and the cron's status:ACTIVE filter takes over). Hygiene-cadence reviews are
80% of the window (90d → 80d cooldown), so a single fire doesn't re-fire
mid-window. Earnings predicates use 7d cooldown to span the post-earnings
aftershock window. Filings use 1d cooldown so material 8-Ks don't get
suppressed.

### Layer 2 — `nextReviewAt` (scheduled-review clock)

`Thesis.nextReviewAt` is when the next scheduled review is due. The
`REVIEW_DATE_HIT` trigger fires when `nextReviewAt < now`. The `update_thesis`
auto-bump pushes `nextReviewAt` forward by horizon cadence after each
review.

**Per-horizon `nextReviewAt` cadence (held-side):**

| Horizon | Days |
|---|---|
| CATALYST | 1 |
| TRADE | 1 |
| TARGET | 7 |
| COMPOUNDER | 30 |

These come from `HORIZON_REVIEW_DAYS` in [`horizon-policy.ts`](../../lib/agent/horizon-policy.ts).
Note: these are operational cadences for held positions, not watchlist
hygiene cadences. Held positions get reviewed more often than watchlist
candidates — different jobs.

**The bug (A4):** the WATCHING-side first-review cadence is currently using
the held-side `HORIZON_REVIEW_DAYS` table. COMPOUNDER WATCHING theses are
scheduled for first review in 30 days when they should be 90.

### Layer 3 — Trigger evaluator cron ([`lib/inngest/functions/trigger-evaluator.ts`](../../lib/inngest/functions/trigger-evaluator.ts))

Runs every 5 minutes during market hours + on `app/signal.routed`. Walks
all ACTIVE + WATCHING theses, evaluates each trigger via `shouldFire`
(predicate match × cooldown × not-recently-fired). When a match fires, emits
`app/thesis.trigger.fired` → spawns a tactical run.

### Why production looks "wild west"

The design is right, but **three operational gaps** turn the trigger feed
into noise:

1. **ENTER triggers don't drop on promotion (A2).** AVGO fires 8 times as
   ENTER on an already-held position. Pure noise — the entry trigger lives
   forever in the now-active thesis.
2. **Sunday discovery floods the next Monday's REVIEW load (A3 + A4).** 38
   new WATCHING theses minted with `nextReviewAt = createdAt + ~4 days`. By
   Monday/Tuesday, most have hit their first REVIEW_DATE_HIT. Today: 28
   REVIEW_DATE_HIT fires for that single Sunday cohort.
3. **`update_thesis` auto-bumps `nextReviewAt` correctly, but the bump uses
   held-side cadence (1/1/7/30 days) when the thesis is still WATCHING.**
   So even after a REVIEW_DATE_HIT fires and the agent reviews, the next
   review fires in 1-30 days — for COMPOUNDER WATCHING this is too fast.

### The "smart trigger" the user described

> *"Oh this is a catalyst-driven bet, I'd only buy it if XYZ happens.
> So don't bother reviewing more than every 30 days."*

The system already encodes this:

- **CATALYST horizon** → entry trigger on the specific event (price level,
  earnings beat, FILING) + 14-day hygiene. The agent maps "I'd only buy it
  if XYZ happens" to a specific predicate in the entry trigger. XYZ doesn't
  fire → no tactical run.
- **COMPOUNDER horizon** → 90-day hygiene cadence. The system literally
  won't bother reviewing the thesis more than quarterly unless a real event
  (earnings, guidance change, 8-K) fires.

**The user's intuition matches the design.** What's broken is the operational
plumbing on top — A1 (data hole), A2 (stale ENTER triggers), A4 (wrong
first-review for WATCHING).

Fix A1+A2+A4 and the trigger feed should drop from ~35 tactical/day to
something like 8-12/day, mostly real signals.

---

## 5. Order of attack

Ranked by leverage (effect per unit work):

| Order | Item | Effort | Effect |
|---|---|---|---|
| **1** | A1 — `get_stock_data.technicals` null | ~2-4h | Unblocks both tactical AND daily-run entries. Single highest-leverage fix in the system. |
| **2** | A4 — WATCHING first-review-at by horizon | ~1h | Stops the next Sunday-discovery flood from creating Monday review storms |
| **3** | A2 — Drop ENTER on WATCHING → ACTIVE | ~2-3h | Kills ~35 wasted tactical runs/14 days. AVGO/GOOGL/TSM stop firing. |
| **4** | A3 — Discovery cap enforcement | ~2h | Caps the Sunday flood at the source. Combine with A4 to keep Monday sane. |
| **5** | A5 — Horizon-aware REVIEW_DATE_HIT cooldown | ~1h | Symmetry with A4. Belt + suspenders. |
| **6** | A6 — Skip `no_run_summary` for INTRADAY_TACTICAL | ~30m | Cleans up tactical transcripts. Stops training agent to ignore gates. |
| **7** | A7 — Narrative-only patches → REVIEWED | ~1h | Restores audit-log signal for future run reviews. |
| **8** | A8 — Cross-analyst discovery de-dup | ~1h | Lower priority. Defer until A3 lands and the duplication shape becomes visible. |

**Total:** ~10-14h to clear all 8 items. Two PRs of bundling makes sense:

- **PR 1 (core):** A1 + A2 + A4 + A5. The "fix the wild west + unblock
  trading" bundle. Single coherent change to triggers + data layer.
- **PR 2 (hygiene):** A3 + A6 + A7. The "tighten the gates" bundle.
- **Defer:** A8 — revisit after PR 1 lands and the cap is enforced.

After PR 1 the daily/tactical surfaces should look very different. Re-run
the audit then. Targets for the next snapshot:

| Metric | Today | Target after PR 1 |
|---|---|---|
| Tactical runs / day | 35 | 8-15 |
| ENTER conversion rate | 31% | 60%+ |
| Wasted-ENTER (already-held) | 35 / 36 | 0 |
| Daily-run `place_trade` count | 0 | 2-5 |
| Total triggers monitored | 358 | 300 |
| Open WATCHING book | 59 | 40 (after duplicates ARCHIVED) |

---

## 5a. Architectural rethink — the bigger picture (added post-2026-05-19 re-audit)

After reviewing today's (2026-05-19) data and reading the prompts + tools + docs
end-to-end, the **per-item patchwork above (A1–A7, B1–B7) fixes real bugs but
doesn't address the deeper shape problem.** Tactical isn't doing what it's
supposed to do, and the trigger system spawns runs that don't need to exist.

This section captures the architectural take so the next session has it.

### 5a.1. The three modes — clean separation

| Mode | When | Job | Trigger surface |
|---|---|---|---|
| **Discovery** | Sunday cron | Find new candidates to track | None — produces WATCHING theses |
| **Daily** | Weekday 8am cron | Walk the whole book, decide what's actionable today | Reads `needsAction` per thesis (REVIEW_DUE, TRIGGER_FIRED, TRIGGER_MATCHING_NOW) |
| **Tactical** | Event-driven (5-min cron + signal.routed) | React to one specific event mid-session | Spawned by `app/thesis.trigger.fired` |

That separation is clean in theory. In practice, **tactical fires on triggers
that aren't really "events"** — REVIEW_DATE_HIT, PRICE_BELOW/REVIEW,
TIME_ELAPSED — which produces busywork.

### 5a.2. Today (2026-05-19) reality check

16 tactical runs today produced 0 trades. Breakdown:

| Predicate × Action | Count | Outcome |
|---|---|---|
| PRICE_ABOVE / ENTER | 6 | 1 correctly passed (already-held AVGO); 5 passed (3 for null technicals, 2 legitimately faded back below trigger) |
| PRICE_BELOW / REVIEW | 4 | All wrote "REVIEW, no action, nextReviewAt bumped" |
| REVIEW_DATE_HIT / REVIEW | 5 | 2 INVALIDATED, 3 wrote "no change" |
| **Real-event tactical work** | 7 | The 6 ENTERs + 2 invalidations (5 of those productive) |
| **Busywork** | 9 | The 4 PRICE_BELOW/REVIEW + 5 REVIEW_DATE_HIT minus 2 invalidations |

**Meanwhile daily-run did real work today** (without any of the audit PRs landed):
- Placed an F SHORT at $13.03 (news-confirmed setup, then cancelled — needs follow-up)
- Closed TSLA LONG at $409.99 (stop hit, was held since 5/12)
- INVALIDATED 6 watch theses with concrete data-driven rationales
- STATUS_CHANGED 1

**Conclusion:** daily-run's prompt + structural-belief reading is healthy.
Tactical is mostly noise.

### 5a.3. The trigger problem — three categories, not eight

The trigger predicate types in `lib/agent/triggers/types.ts` are mostly fine
as a kit. The problem is **how they're wired and what action they fire**:

**Real event triggers (need tactical, mid-session decision):**
- PRICE_ABOVE / ENTER — watching thesis breaks entry level → maybe buy
- PRICE_BELOW / EXIT — held position hits stop → maybe sell
- PRICE_ABOVE / EXIT (TRADE horizon) — held trade hits target → maybe close
- EARNINGS_BEAT / EARNINGS_MISS — earnings landed → re-score quickly
- GUIDANCE_CHANGE — guidance cut → re-score
- FILING (8-K material event) — read filing, possibly act
- SIGNAL_TYPE — urgent routed signal (recall, regulatory, etc.)

**Hygiene triggers that don't need tactical (daily-run handles tomorrow):**
- ❌ REVIEW_DATE_HIT — daily-run's `get_theses.needsAction.REVIEW_DUE` already
  reads `nextReviewAt < now` for every thesis. Spawning a tactical run for
  this is fully redundant.
- ❌ TIME_ELAPSED (90d hygiene) — same. Daily-run sees the same overdue
  state via `nextReviewAt`.
- ❌ PRICE_BELOW / REVIEW (support level "re-evaluate") — not urgent. If
  price hit support today, daily-run sees it tomorrow morning.
- ❌ PRICE_ABOVE / REVIEW (target hit, TARGET horizon, hold-or-trail
  decision) — arguable; usually not urgent, daily-run can decide.

**The user's intuition was right:** REVIEW_DATE_HIT is the weird one because
it's a predicate that just wraps `Thesis.nextReviewAt`. There's no market
data involved — it's a clock check that happens to be implemented as a
trigger. Daily-run's `needsAction.REVIEW_DUE` does the exact same clock check
on read. **The trigger version exists as a no-op duplicate.**

### 5a.4. nextReviewAt + needsAction = daily-run's existing scheduled-review path

The mechanism the user described — *"can daily runs already get all theses,
see which ones have review date, and know to review them and skip others?"*
— is already implemented:

1. `lib/agent/needs-action.ts` `computeNeedsAction()` returns
   `{ kind: "REVIEW_DUE", daysOverdue: N }` when `nextReviewAt < now`.
2. `get_theses(needsAction: true)` surfaces this per-thesis to the daily-run
   agent. The agent reads the list, decides which to walk first.
3. `complete_run` preflight refuses if any `needsAction != null` thesis
   wasn't addressed via `update_thesis` in this run.

So `nextReviewAt` IS the field daily-run uses for the review-overdue check.
The REVIEW_DATE_HIT trigger is a parallel-but-equivalent path that spawns
tactical runs for the same condition. **Remove the trigger; keep the field.**

### 5a.5. PRICE_BELOW — answering the user's question directly

> *"Are you saying we don't need triggers → tactical runs for price below,
> because price below won't cause a trigger to buy usually? But hitting a
> price on the way up would trigger a buy?"*

The distinction isn't really direction (PRICE_ABOVE vs PRICE_BELOW). It's
**action**:

| Predicate | Action | Use case | Should fire tactical? |
|---|---|---|---|
| PRICE_ABOVE | ENTER | Watching → "price broke entry, validate" | **Yes — urgent** |
| PRICE_ABOVE | EXIT | TRADE/CATALYST held → "target hit, close" | **Yes — urgent** |
| PRICE_ABOVE | REVIEW | TARGET held → "target hit, hold or trail?" | Marginal — daily can handle |
| PRICE_BELOW | EXIT | Held position → "stop hit, sell" | **Yes — urgent** |
| PRICE_BELOW | REVIEW | Watching → "fell to support, better entry or thesis broken?" | **No — daily handles** |

So both PRICE_ABOVE and PRICE_BELOW *can* warrant tactical, but only when
the action is ENTER (for ABOVE) or EXIT (for BELOW on held). The REVIEW
variants are essentially "interesting price level reached, take another
look" — which is exactly what daily-run already does for every thesis
daily.

### 5a.6. THESIS_RESEARCH_V2 implications — should the deep-research agent set ALL triggers?

> *"In my whole thesis v2 where it's set by individual Agents on deep
> research mode... is the plan that those deep research, extra thorough
> agents should be setting all triggers? no hardcoded logic by type?"*

**Yes — this is the right direction.** Here's the layered argument:

The current `defaultTriggersForHorizon` system was designed for the
shallow-research world: discovery agent makes a quick judgment, mints a
WATCHING thesis, and the system attaches a horizon-keyed safety net of
~5 default triggers. That's appropriate when the agent doesn't have time
to think about THIS thesis's specific risks.

In the THESIS_RESEARCH_V2 world, the thesis-writer agent spends 60–120
seconds on per-ticker deep research. It produces structured beliefs
(`coreBelief`, `keyAssumptions`, `invalidationConds`). Those assumptions
ARE the triggers — *"AI capex stays >$200B/quarter through 2026"* maps
directly to `GUIDANCE_CHANGE direction=DOWN → REVIEW`, *"gross margin
remains >70%"* maps to a custom EARNINGS-tied review when the next print
lands. The thesis-writer has the context to pick triggers thoughtfully
per-ticker.

**The right end-state:**

1. **Minimum mechanical defaults** — the system still attaches the
   non-judgment-required safety net:
   - `PRICE_BELOW(stop) → EXIT cd=0` (the hard stop — never let the
     agent forget to set this)
   - `PRICE_ABOVE(target) → EXIT` for TRADE horizon (mechanical exit)
   - Nothing else.
2. **Agent-declared triggers** — the thesis-writer reads its own
   assumptions and adds the specific events that would invalidate or
   confirm them. Typically 2–4 triggers, tightly scoped.
3. **No REVIEW_DATE_HIT** — the field stays, the trigger goes. Daily-run
   reads `needsAction.REVIEW_DUE`.
4. **No TIME_ELAPSED hygiene** — also redundant with daily-run.
5. **No PRICE_BELOW / REVIEW** — not urgent enough.

The end-state trigger count drops dramatically:

| Horizon | Old default count | New default count |
|---|---|---|
| WATCHING CATALYST | 5 | 1 (entry) |
| WATCHING TRADE | 4 | 1 (entry) |
| WATCHING TARGET | 5 | 1 (entry) |
| WATCHING COMPOUNDER | 5 | 1 (entry, 7d cd) |
| HELD CATALYST | 5 | 1 (stop) |
| HELD TRADE | 3 | 2 (stop + target) |
| HELD TARGET | 5 | 1 (stop) |
| HELD COMPOUNDER | 6 | 1 (stop) |

Plus 2–4 agent-declared per thesis. Total triggers monitored drops from
~358 to ~150 across the same book.

### 5a.7. What this means for the open PRs

Re-evaluating the 9 open PRs in light of the architectural take:

| PR | What it does | Survives architectural rewrite? |
|---|---|---|
| **#288** (docs) | Tactical review + audit doc | **Keep** — durable record |
| **#289** (Alpaca feed=iex) | Unblocks `technicals` for ALL data consumers | **Keep** — data-layer fix |
| **#290** (preflight skip tactical + narrative REVIEWED) | Tactical/audit hygiene | **Keep** — survives |
| **#291** (WATCHING first-review + cooldown) | Tunes auto-default cadences | **Close** — defaults mostly going away |
| **#292** (drop ENTER on promotion) | Stops AVGO/GOOGL re-firing on held | **Keep** — survives any rewrite |
| **#293** (discovery 8-cap) | Caps Sunday flood at Layer-1 | **Could close** — could also keep as bandaid while V2 deep-research lands |
| **#294** (FMP migration + Alpaca primary + repair script) | Data-layer cleanup | **Keep** — foundational |
| **#295** (reconcile null fix + zombie CLOSED + tests) | Three real bug fixes | **Keep** — survives |
| **#296** (remove keyword gate) | Removes false-fail regex | **Keep** — survives |

**Recommended action:** close #291 (and possibly #293), merge the other 7.
The closed PR's findings (A4 + A5) are preserved in this doc and become
part of the architectural rewrite.

### 5a.8. The new direction — what to actually build

Calling this **C-series** (architectural rewrite, separate from A/B audit
patches):

| # | Item | Effort | Layer |
|---|---|---|---|
| **C1** | Strip `defaultTriggersForHorizon` down to mechanical safety net (stop EXIT + TRADE target EXIT). Remove REVIEW_DATE_HIT, TIME_ELAPSED hygiene, PRICE_BELOW/REVIEW, OR(filings) REVIEW. ✅ **shipped** | ~3h | Layer 1 (defaults.ts) |
| **C2** | Remove REVIEW_DATE_HIT from default attachment + cleanup script `scripts/dedupe-review-date-hit-triggers.ts` for the 43 existing theses. ✅ **shipped (bundled with C1)** | ~2h | Layer 1 (triggers/) |
| **C3** | Tactical-prompt rewrite — agent reads `coreBelief + keyAssumptions + invalidationConds` first, scores event against them (broken / confirmed / silent), then validates execution conditions. New decision tree: invalidate / act / pass. Volume gate is now horizon-conditional (TRADE keeps 1.5×, TARGET/COMPOUNDER treat as helpful context). ✅ **shipped** | ~2h | Layer 3 (system-prompts/intraday-tactical.ts) |
| **C4** | THESIS_RESEARCH_V2 thesis-writer prompt adds explicit "what triggers should wake me?" section, derives 2–4 triggers from the keyAssumptions. | ~2h | Layer 3 (system-prompts) + plans/THESIS_RESEARCH_V2.md |
| **C5** | Discovery cap of 3 LONG/SHORT WATCHING per run (was 8). Combined with V2 deep-research depth per candidate. | ~1h | Layer 1 (record-thesis.ts) |

**Total:** ~10h. Same order of magnitude as the A-series, but the surface
is structurally cleaner afterwards.

**Expected effect after C-series:**

| Metric | Today | After C-series |
|---|---|---|
| Tactical runs / day | 16 | 3–6 |
| Wasted (no-action) tactical runs | ~9 of 16 | 0 |
| Triggers monitored per analyst | 48–125 | 15–30 |
| Discovery output / Sunday | 38 | 12–18 |
| Tactical decisions grounded in thesis belief | rare | every run |
| `nextReviewAt` source-of-truth | both trigger + field | field only |

The bigger goal: the system the user described — *"manage my portfolio
when important triggers come in"* — is **events the agent's own belief
flagged as decision-points, not auto-attached calendar reminders.**

---

## 6. Out of scope (referenced for navigation)

- **Deep-research thesis rewrite.** [`THESIS_RESEARCH_V2.md`](./THESIS_RESEARCH_V2.md)
  + [`THESIS_SCHEMA_AUDIT.md`](./THESIS_SCHEMA_AUDIT.md). The Phase 1
  thesis-writer agent is being built; Phase 2 wires it into Discovery. The
  audit items here are pre-V2 hygiene that V2 doesn't replace — V2 raises
  the *quality* of each minted thesis, but the *operational plumbing* (when
  triggers fire, how many theses per Sunday, how `nextReviewAt` cadences
  work) is the same code path before and after V2.
- **Discovery prompt archetype-awareness.** `P1-9` in GAPS.md — branching
  the discovery scoring rubric by archetype family (event-driven /
  momentum / fundamental). Tracked separately because it's a structural
  prompt rework, not a hygiene fix.
- **Long-tail gpt-5.5 latency** (Secular Theme 681s timeout on 5/18).
  Filed in run-reviews; might be worth an OpenAI-side investigation. Not a
  blocker yet.
- **The 4 daily-run zombie ACTIVE-without-position theses cleaned today
  (AMD, ASML, MU, NVDA / Earnings Drift).** Healed by the daily-run agent
  on 2026-05-18 — no further action needed. Documented in the 2026-05-18
  run-review.

---

## See also

- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — live thesis-system reference
- [`GAPS.md`](../GAPS.md) — rolling thesis-architecture rework punch list
- [`PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle (which layer each fix lives on)
- [`docs/run-reviews/2026-05-15.md`](../run-reviews/2026-05-15.md) — last daily review
- [`docs/tactical-reviews/2026-05-18.md`](../tactical-reviews/2026-05-18.md) — first tactical review (the audit that surfaced this list)
- [`lib/agent/triggers/defaults.ts`](../../lib/agent/triggers/defaults.ts) — the trigger templates that this audit explains
- [`lib/agent/horizon-policy.ts`](../../lib/agent/horizon-policy.ts) — horizon → review-days mapping
