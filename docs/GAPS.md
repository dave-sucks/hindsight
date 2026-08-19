# Hindsight — Gaps

> **What this is:** the live tracker for what's **open** on the live-trading loop. Scoped to what affects real money, real analysts, real runs.
>
> **How this file is maintained:** **open items only.** When an item closes, move its block to [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) (most-recent on top) with the PR # and date — do not leave closed items here. The PRs are the full record. Keep this file short enough to read in one screen.
>
> **The 5 roles (the mental model behind every item):**
> 1. **Daily run** — manages the portfolio. Walks the book every morning. Trades, exits, trims, adds, edits targets. Reads research; never writes deep research.
> 2. **Tactical run** — same as daily but single-thesis, wakes on triggers.
> 3. **Discovery run** — mints net-new theses (Sunday cron + operator-driven chat).
> 4. **Thesis-writer** — refreshes research on existing theses. Dispatched on promotion + agent judgment. Writes belief / target / stop / triggers / sections. **Never touches status.**
> 5. **Promotion action** — closes paper positions, flips ACTIVE → PROMOTED, fans out writer refreshes. The daily run then decides re-enter / wait / kill.

---

## P0 — Blocks the live trading loop

_None open._ The 2026-06-04 → 08 post-launch sprint cleared the live-loop blockers (compliance auto-sell #390, EXIT-vs-proposal runaway #381, cooldown runaway #377). See [`GAPS_HISTORY.md`](./GAPS_HISTORY.md).

---

## P1 — Quality is degraded but the live loop functions


### P1-31 — Analyst-level (portfolio-level) standing trigger rules, not just per-thesis
**Status:** 🔎 **SHIPPED in [#511](https://github.com/dave-sucks/hindsight/pull/511) (merged 2026-08-17), pending the principal's click-through.**
The trigger cascade landed: account → analyst → thesis levels resolved by one resolver feeding the
UI, the evaluator, tactical-run, `get_theses`, live-evaluate and `complete_run`; code-level defaults
migrated to `Account.triggers` as data (`triggersSeededAt` distinguishes never-seeded from
deliberately-emptied; every account backfilled); archetype seeding on analyst creation. Close (with
P1-32) after the principal's manual click-through — both prior P0s in this area were UI-only and
invisible to tests. Original filing follows:
open, filed 2026-07-06 (principal).
Triggers today are per-thesis. Principal wants **standing rules at the analyst / portfolio level**:
"do X when ANY of my holdings reaches +X% / drops X% in a day / week / trailing / from high." They
auto-apply across the whole book so risk + press behavior is configured once, not per name. Pairs
with the Spine (agent-authored per-thesis ladders in `docs/plans/SCALE_INTO_WINNERS.md` WS0):
standing rules are the floor; the agent fills in smart per-name levels on top.

### P1-32 — Surface + customize triggers / rules / thresholds in settings (UI)
**Status:** 🔎 **SHIPPED in [#511](https://github.com/dave-sucks/hindsight/pull/511) (merged 2026-08-17), pending the principal's click-through** — `/settings/triggers` + the analyst Triggers tab, same pills as the thesis sheet, `canEdit` server-computed. Close with P1-31 after the click-through. Original filing follows:
open, filed 2026-07-06 (principal).
The trigger ladder, the standing rules (P1-31), and the press/protect thresholds
(`RUNNING_WINNER_ABS_GAIN_PCT`, the +7%/−7% rungs, stops) are all code-level today. Principal wants
them **visible and editable in settings / analyst settings** — both to configure the behavior and
to *trust* that monitoring is set up correctly.

### P1-33 — Trigger lifecycle visibility: the chain is recorded but not traceable in the UI
**Status:** open, filed 2026-07-12 (principal). Trust gap: "I need to know when a trigger fired,
whether it woke an agent, what the agent did, and how the ladder/position changed — flawless."
Every step IS in the DB (`TRIGGER_FIRED` rows with `triggerId`, tactical close-outs carrying the
same `triggerId`, `UPDATED` rows with exact `fieldChanges`, proposal outcome rows) but no surface
shows the chain. Build order (spec: `docs/plans/TRIGGER_LIFECYCLE.md` §4): (1) per-trigger timeline
in the thesis sheet, (2) book-level protection strip (per holding: gain, floor-locked %, trail?,
nearest rung), (3) PR8 feed ship-now slice (fires / press-hold-take outcomes / target-reached),
(4) config side folds into PR-E (P1-31/32).

### P1-34 — Signals/news architecture needs a ground-up rethink (dedicated session)
**Status:** open, filed 2026-07-12 (principal). Routing is severed — 0 `AnalystSignalRoute` rows in
14d against 327 flowing signals — so every news/earnings/filing rung on every ladder is decorative
and monitor-ROI crediting (Pillar 5) is dark. History: all-day routing was trash + expensive;
morning-run read-everything was unfocused. Three candidate models framed in
`docs/plans/TRIGGER_LIFECYCLE.md` §6 (vetted push / review-time pull / hybrid: event-class push for
HELD names + review-time targeted pull). **Do not rebuild the pipeline before that design session.**

### P1-35 — Sold-name continuity: a sold name loses all thread with its history (REALIZED on the live book)
**Status:** ✅ **SHIPPED in [#524](https://github.com/dave-sucks/hindsight/pull/524) (merged 2026-08-18)** — both halves + the sub-floor sizing gate. Close after the first live recycle is observed (a protective sale where the analyst attests the belief survived → the thesis returns to WATCHING). Originally: open, promoted from candidate 2026-07-21. **Live — it has already moved real money.**
Selling severs a thesis from its own history both ways:
- **(a) No recycle on protective exits.** A stop/trailing close goes `RETIRED (SOLD)` and is terminal;
  only `closeReason=TARGET` returns to WATCHING. So the "did we sell the dip?" case — the highest-risk
  one — gets no re-look. ARQT/VRDN went dark after +$845/+$445 protective stops.
- **(b) Blind re-mint.** `record_thesis`'s same-ticker guard only checks HOLDING/WATCHING/PROMOTED
  (skips RETIRED); the minting writer never calls `get_theses`; `parentThesisId=null`; it re-underwrites
  from a blank prompt at the stop-out price.
**Confirmed executed:** XENE trailed out 2026-07-16 at ~$66.53 (+$966 banked), was blindly re-minted
that night, and **re-bought LIVE 2026-07-17 at $68.84** — the acting agent could not see it had sold the
name ~20h earlier. Frame + fix options: [`plans/SOLD_NAME_CONTINUITY.md`](./plans/SOLD_NAME_CONTINUITY.md).
Fix: belief-gated recycle on protective exits + extend the same-ticker guard to recent RETIRED rows
(auto-chain the parent, surface the prior exit) + require a history read before any mint. **The #1 new gap.**

### P1-36 — Shape gate contradicts the gain-locked floor (protection silently understated on live names)
**Status:** open, promoted 2026-07-21. The `record_thesis`/`update_thesis` shape gate (LONG:
`target > entry > stop`) rejects a `stopLoss` at/above cost basis — but a gain-locking floor above cost
is the entire point of the Ratchet Invariant. On 2026-07-14 MU's floor was **lowered** 940→840, the agent
explicitly citing "to satisfy shape discipline," so the `stopLoss` column (which mirrors to `Position` +
price-monitor) now understates protection by ~$100 on a live position. The Ratchet and the shape gate
contradict each other on every winner whose floor should exceed entry. Fix: relax the shape gate for
HOLDING (allow stop ≥ entry when gain-locked), OR make trigger rungs the sole home of gain floors and stop
mirroring them into `stopLoss`. Run-review Finding B (7/16).

### P1-37 — Decline-with-retune duty: fired-but-blocked ENTER rungs re-fire forever
**Status:** open, promoted from P2 2026-07-21 (frequency + live cost). A declined ENTER leaves the same
rung armed at the same level, so it re-fires every 5-min tick and every morning. Sharpest case — the
**composite-gate deadlock**: CAPR fired ~5× and CEG 4× over 2026-07-20→21, each blocked because the thesis
composite is 6/10 (< the 65% entry bar); the agent each time says "needs a scoring refresh before deploying"
but **never dispatches one** (0 THESIS_WRITER refreshes), so it loops indefinitely. ~9 wasted GPT-5.5
tactical runs in two days. Fix (symmetric with the re-ladder duty on fires): a tactical that declines an
ENTER on a stable reason must **retune the rung** (raise the level to the real confirmation price / widen
cooldown) or **dispatch the refresh it says it needs** — not silently re-arm. Often the root is a
mis-specified entry level (see P1-38). Run-review Finding E.

### P1-38 — Discovery-mint quality + live-feeder velocity (unvetted mints reach live capital in days)
**Status:** open, filed 2026-07-21. One Grok-seeded discovery batch (2026-07-16) put **4 names into the
LIVE book within 2 trading days** (MNKD/CYTK/XENE 7/17, PRAX 7/20). Discovery is now a fast live-capital
feeder, not just a watchlist populator — with no executability vet on the mint. Symptom: CAPR's entry was
minted at `PRICE_ABOVE $19.12` — a level ~17–26% *below* the 20d/50d, so the predicate is chronically true
while the real entry condition (a confirmed reclaim) never is; paired with a sub-threshold composite it can
never fill, so it just re-fires (feeds P1-37). Fix: vet minted entry levels against structure
(MAs/confirmation), and gate or flag discovery mints before they can reach live capital. Cross-refs P1-35
(blind re-mint) + P1-37 (deadlock). **Extends to protective levels, not just entries:** the same
level-quality defect fires *exits* — MNKD carried a $4.00 floor 1% below a $4.04 entry on a stock with a
$3.84–$4.00 daily range (inside the noise → guaranteed to fire on a dip), and DELL/ZETA floors ratchet up
on a spike then sit *above* a recovering price ("upside-down" stop). Protective levels must be
volatility-aware + thesis-anchored (outside the daily noise band, tied to a real thesis break), not just
1% off entry.

### P1-39 — Proposal fatigue: the exit queue re-asks forever (150 of 210 exit proposals never approved)
**Status:** open, filed 2026-08-03, **code-traced.** Live and systemic across the whole book. 210 exit
proposals ever created, **150 (71%) never approved**; MU alone re-proposed for exit **49× across 22 days
over 3+ months** and still queued (ZETA/MNKD/SNOW also re-proposed in the July/Aug clean-signal window).
**This is NOT the principal deliberately letting a proposal expire** — that's a valid hold; the defect is
the system *re-generating* the same exit indefinitely and ignoring that hold. Root cause (traced, not
inferred): the suppression gate's STOP/TARGET carve-out ([`maybe-await-approval.ts:289`](../lib/proposals/maybe-await-approval.ts))
skips the cross-day cooldown for any protective exit — an assumption that was safe pre-#480, but the Game
Plan put a protective floor on **every** holding, so the carve-out now leaks the entire protective-exit
stream past the cooldown, ignoring rejections *and* expiries. Deeper: the daily-run/tactical agent has no
read path to its own pending queue (only `unapprovedExitCount`, a count), so it re-derives the exit every
run. **CORRECTED FIX (2026-08-13, with the principal):** suppression is the wrong lever — the system must
NEVER go silent on an exit (a name can collapse the next day; an unwanted repeat is fine, silence is not).
A suppression PR (#504) was closed.

**⚠️ FINAL RESOLUTION — PRINCIPAL RULING 2026-08-16.** The "agent trails the floor" answer was ALSO
rejected: an agent moving the principal's line down is silence with extra steps, and it is an
unauthorized level change on live money. The settled model:
- **A trigger is a standing order and fires EVERY day its condition is true.** Decline/expiry = "did
  nothing today" → it fires again tomorrow. Sell-at-$400 alerts daily while under $400, forever.
- **Protective levels ratchet ONE way.** Agents may RAISE/tighten a floor; they may **never lower,
  widen, or delete** one. Lowering a line is the principal's manual act.
- **The principal moves levels in the reject dialog** — already built + verified 2026-08-16
  (`ProposalActions.tsx` renders an inline editable `ThesisTriggersSection`; the proposal-context
  route resolves the thesis by `(account, analyst, ticker, status)`, so it works on held names).

So P1-39's fix is two moves: **(1) ✅ SHIPPED (#513):** remove the cross-day suppression entirely so
every agent-decided exit surfaces (~daily) — this stopped the LIVE silence on MU + CYTK;
**(2) 🔎 BUILT ([#518](https://github.com/dave-sucks/hindsight/pull/518), reworked to the ruling
2026-08-16, awaiting principal review — Lane 1):** the daily exit proposal on a held-through name
carries CONTEXT — `heldThroughFloor: { heldThroughCount, rejectMessage, recentLow }` on the
`get_theses` row + the prompt's ratchet rule — so the ask reads "3rd day under your $860 floor;
recent low $842; suggest ~$840 if you'd rather hold" instead of repeating an identical card. No
needsAction kind, no gate change, no agent-initiated level edits, nothing suppressed.
Close after merge + one validated run showing an enriched (not identical) daily ask.
Full diagnosis + acceptance test:
[`plans/PROPOSAL_FATIGUE.md`](./plans/PROPOSAL_FATIGUE.md). **Subsumes the ex-P2 "hold + retune affordance"
and "narrow the P1-28 carve-out" items.** Secondary (real but NOT the loop's cause, see the doc): the
`Order→TradeDecision→Thesis` null-on-held relation bug (P2 below) + the `PROPOSAL_*` audit lossiness (folds
into the `fieldChanges: {}` P2 item).

### P1-40 — ENTER trigger fires, validates, then never buys — silently (the RARE gap)
**Status:** 🔎 **SHIPPED in [#523](https://github.com/dave-sucks/hindsight/pull/523) (merged 2026-08-17), pending first validated cron.**
The gate: a fired/matching ENTER is resolved only by `place_trade`, a level change
(`update_thesis` triggers/entry_price), or ARCHIVED — a rationale-only REVIEWED row no longer counts.
The daily-run prompt was re-aligned to the gate in the post-merge safety PR (the stale "transient
rejection" path (b) taught exactly what the gate now refuses). **Watch on the first crons:** IONS +
MIRM (Catalyst Event PM, LIVE) have fired ENTERs and sub-floor `targetSizePct` (see the escalated P2
sizing item) — one refuse-and-retry is the gate working; repeated refusal on the same name, or a
good thesis getting ARCHIVED to satisfy the gate, is the bad version. Close after one clean cycle.
Original filing (with the corrected mechanism) follows:
open, filed 2026-08-13, **code-traced.** Live money, and *invisible*. RARE's ENTER trigger fired
2026-08-05; the agent validated every condition (price $28.02 above the $27.50 entry, supportive news, Q2
beat) — wrote it down — and **never called `place_trade`.** No error, no failure, no alert. It was the only
shot: RARE hasn't traded above $27.50 since ($24.93→$26.86), every review since repeats "still below the
trigger," and the window closes ~08-16. **Why nothing caught it (CORRECTED 2026-08-16 — the original description below was wrong):**
it is not that no gate watched. `complete_run`'s `unaddressed_theses` preflight
([`complete-run.ts`](../lib/agent/tools/complete-run.ts)) DOES catch a `needsAction` thesis left
unresolved — but it accepts a **rationale-only REVIEW `update_thesis`** as resolution. The agent
wrote "validated, not entering," which satisfied the gate. RARE didn't slip past a gate; it
*satisfied* one. **Writing about a fired ENTER counts as handling it.** (The narration→execution gate
in `record-run-summary.ts` indeed only watches close/exit/sell verbs, and its `VERB_RULES` comment
says buy verbs are "gated upstream by the morning-research trade-execution gap check" — but that
upstream check only fires when `primary_decision ∈ {ADD, ROTATE}` and `tradesPlaced = 0`, which a
per-thesis ENTER decline never trips.) **So the fix is NOT adding buy verbs to a regex.** It is: a
fired ENTER is resolved only by `place_trade` **or a level change** — buy it, move the bar, or stop
watching. Per the 2026-08-16 standing-order ruling this is a GATE fix only; no agent-side
auto-retuning of the level. **Compounding
(see P2 sizing item):** RARE's `targetSizePct = 4%` ≈ $4k < the $5k `minPositionSize` floor, so Guardrail 5b
may have rejected the entry by its own sizing even if it had tried. Also feeds P1-37 (RARE reviewed 15+ days
for a name actionable one afternoon). **Fix:** tighten `unaddressed_theses` so a fired ENTER
requires a trade or an explicit level change, not prose. It'll recur on SRRK/MIRM in September.

### P1-42 — Price levels aren't triggers: stop / target / next-review fire on nothing
**Status:** open, filed 2026-08-16, **code-traced + probed on live data.** **Spec written:
[`docs/plans/LEVELS_AS_TRIGGERS.md`](plans/LEVELS_AS_TRIGGERS.md) — read that, not this summary.**
`Thesis.stopLoss`, `targetPrice` and `nextReviewAt` are columns the agent edits **independently of the
trigger ladder**, and nothing evaluates them. SNOW (HOLDING, live, composite 9/10) carries
`stop $256 / target $360 / nextReviewAt Aug 21` and a 9-rung ladder containing **none of those levels** —
its only EXIT is a 3% trail. Grep confirms no enforcement path for `stopLoss` anywhere: it is written by
`place_trade`, drawn on the Price Targets card, and fed to the prompts, and never fired on. How it happens:
the stop was raised above entry to lock a gain (correct behavior) and the matching rung was never written —
the agent updated the *column*, not the *ladder*. The sync that exists is one-way (editing a stop **pill**
mirrors onto Thesis + Position via `applyTriggerValueEdit`); `update_thesis` can patch `stop_loss` with no
trigger change at all. Same family: `maxHoldDays`, and the invisible `RUNNING_WINNER` flag, which should be
a rung (`UNPROTECTED_GAIN` should NOT — it reads the other rungs, so it's a ladder linter). **Absorbs
P1-36 and the "flags become rungs" item.** Data-model change on live theses; the backfill would arm floors
that are currently inert, so it needs the principal before it runs.

### P1-41 — Live quotes were served from the Next.js Data Cache (stale prices reached trigger evaluation)
**Status:** **fixed in code 2026-08-14, pending merge + one prod verification.** Branch
`claude/live-price-data-bug-3ce7f7`. **What happened:** the thesis sheet rendered SNOW at
`$337.38 +1.54%` at 11:38 AM ET while the live price was `$329.43 −2.36%` — the displayed numbers
were a self-consistent snapshot of the **prior session's close**, which is why it never looked like
bad data. Finnhub was correct throughout (verified by direct `curl`); the app was caching.
**Root cause:** `getStockQuote` fetched with `cache:'force-cache', next:{revalidate:30}`. The Next.js
Data Cache is **stale-while-revalidate** and persists across invocations/deploys on Vercel, so past
the window the request is *still served the stale value* while refreshing in the background. **The
bound was never the 30s — it was how often the surface got hit.** Five instances existed
(`getStockQuote`, `/api/quotes`, both intraday-bar fetches, and the shared `finnhub()` helper).
**Why it mattered beyond cosmetics:** the `finnhub()` helper (`revalidate:300`) feeds `get_stock_data`
**and the trigger evaluator** — so the first evaluation after any quiet gap (i.e. **the market open**)
scored `GAIN_FROM_ENTRY` / `TRAILING_FROM_HIGH` against the previous close. An overnight gap-down was
invisible to protective stops for one cycle, exactly when a stop matters most. Fills were never
affected (Alpaca market orders execute at the real price) — this corrupted *decisions*, not
*executions*. **The tell that localizes it in seconds:** on the same sheet the **1D chart was correct**
while the header price was a day stale — the chart polls every 30s so its second poll lands fresh;
the header fetches once on open. Polling masks this; single-fetch surfaces expose it.
**Fix shipped:** quotes + current-session bars use `cache:'no-store'`; the evaluator keeps a 30s
*in-memory* TTL (bounds staleness without breaking the 200-ticker fan-out against Finnhub's 60/min).
Added `quoteAgeMs()` + `STALE_QUOTE_THRESHOLD_MS` reading Finnhub's `t` field — **which every quote
has carried all along and nothing read, the root reason this was undetectable for weeks.**
**Guarded by tests:** `lib/actions/finnhub-quote.test.ts` (7 assertions against the real
`getStockQuote`) pins the two properties that matter — the fetch must not opt into the Data Cache, and
the in-memory damper must expire so a long-lived instance can't serve a day-old quote. Verified to
**fail** when the original `fetchJSON(url, 30)` is reintroduced, so it's a real regression guard.
**Two open items to review:** (1) the evaluator *logs* `STALE QUOTE <ticker>` but still evaluates — a
stale price is fail-unsafe in both directions (act on it and a stop fires at the wrong level; skip it
and the stop doesn't fire at all); (2) **watch Finnhub 429s for a day after deploy** — the evaluator
lost the shared/persistent Data Cache in favor of a 30s per-instance one, so a cold lambda now fans out
fully every tick. Reasoning says volume is ~flat (SWR refetched in the background anyway, and
`morning-research` is `concurrency:{limit:1}` so analysts are serial) but **this was not measured in
prod.** Rule documented in `CLAUDE.md` → recurring bugs.

### P1-43 — Silent vendor decay: FMP is ~dead on the current plan and several agent tools return nothing
*(Renumbered from a duplicate "P1-42" 2026-08-17 — two sessions filed different gaps under the same number; the levels-as-triggers gap keeps P1-42 since the spec + roadmap cite it.)*
**Status:** open, filed 2026-08-14, **endpoint-audited live.** Found while tracing P1-41. Every FMP
call the app makes was probed against the real key today:

| FMP endpoint | Result |
|---|---|
| `/stable/biggest-gainers`, `/stable/most-actives` | ✅ **200 — the only FMP capability still alive** |
| `/stable/quote`, `price-target-consensus`, `price-target-summary`, `grades-historical`, `analyst-estimates`, `key-metrics`, `earnings`, `economic-calendar` | ❌ **402** (premium / restricted) |
| `/stable/options-chain`, `/stable/upgrades-downgrades` | ❌ **404** (empty) |
| all `/api/v3/*` + `/api/v4/*` still in code (`historical-chart/1min`, `options/chain`, `stock_market/gainers`, `price-target-consensus`) | ❌ **403 Legacy** — retired Aug 31 2025 |

Finnhub, by contrast, is **healthy**: `profile2`, `metric`, `recommendation`, `calendar/earnings`,
`quote` all 200 (only `option-chain` is 403). **Consequences, all silent — these tools fail soft and
report success:** `get_options_flow` is **dead on both paths** (FMP 404 + Finnhub 403);
`get_analyst_coverage`'s FMP endpoints are all 402/404; `get_market_context`'s economic calendar is
402; `get_stock_data` still lists "FMP Analyst Price Targets" as a *source* while getting nothing —
so **the agent may be citing coverage it never received.** Also `getIntradayCandlesFmp` 403s on
**every 30s poll** of the 1D chart before falling back to Alpaca — a guaranteed-dead round-trip on
the hot path (delete it; go straight to Alpaca).
**This inverts the P2 consolidation plan below** — see the correction there. **Fix:** (1) delete the
dead FMP paths rather than leaving them to fail soft; (2) make a vendor call return a *loud* error,
not an empty success, when the plan doesn't serve it — a tool that silently returns nothing is worse
than one that errors; (3) audit what `get_analyst_coverage` actually renders today.

_(P1-26 + P1-29 closed 2026-06-26 — see [`GAPS_HISTORY.md`](./GAPS_HISTORY.md).)_

---

## P2 — Backlog

### Active
- **✅ SHIPPED in #524 (2026-08-18): `targetSizePct` below the `minPositionSize` floor → self-rejecting entries (pairs with P1-40 — and #523 made it ACTIVE).** RARE's thesis carried `targetSizePct = 4%` ≈ $4k on a ~$100k book, under the $5k `minPositionSize` floor — `place_trade` Guardrail 5b rejects the entry by the thesis's own sizing. **Probed live 2026-08-17: 8 WATCHING theses are sub-floor** (Catalyst Event PM: IONS/MIRM/RARE at 4% vs $5k; Secular Compounder: CRWD/GEV/NTNX/SNPS/TXN at 2.5–5% vs $10k) — and IONS + MIRM have FIRED ENTERs. Pre-#523 this was a silent non-trade; post-#523 the gate *compels* resolution, so a sub-floor thesis pushes the agent toward archiving a good name. Interim mitigation shipped (post-merge safety PR): the prompt teaches "size `notional` at the floor when conviction supports it; a sub-floor `targetSizePct` is a plan defect, not a skip reason." Durable fix still open: authoring-time clamp in `record_thesis`/`update_thesis` — needs an equity-aware design (targetSizePct is % of book; the floor is dollars), don't hardcode a book size. Also principal input wanted: Secular Compounder's $10k floor vs its 2.5–4% theses is a config-level tension only Dave can resolve.
- **Discovery-mint executability vet.** *(Sharper half of P1-38, tracked here for the tuning slice.)* Vet each minted `entryPrice` / ENTER level against structure (20d/50d, confirmation) at write time so discovery can't mint a chronically-true-but-unfillable entry. CAPR 7/16 = the case.
- **SHORT closes are invisible to the exit-ledger reads (`side: "SELL"` filter).** `get_theses` counts declined exit proposals with `side: "SELL"` — but closing a SHORT writes a **BUY** order (`closeSide = direction === "LONG" ? "sell" : "buy"`, `closeTrade.actions.ts:186`). So both `unapprovedExitCount` (pre-existing) and `heldThroughFloor` (#518) stay empty on SHORT holdings: a principal who declines a short's protective-ceiling exit three times gets none of that context on the next run, and the direction-aware recent-high math in the bars block is unreachable. Zero live impact today (all current holdings are LONG) — fix before the first live SHORT. Fix: key the query off `intent ∈ {CLOSE, PARTIAL_CLOSE}` rather than `side`. Found in the #518 review 2026-08-16.
- **`closeReason` mis-tag assertion (ex-C3).** 7/13 protective closes tagged `closeReason=MANUAL` (only ARQT carried `STOP`) → EWTX's floor breach wrongly P1-28-suppressed. Self-corrected to `STOP` from 7/14 (coincident with #490). The #490 risk-exit carve-out keys off this field. Fix: Layer-1 assertion — a close from a protective/trailing fire must carry STOP/TARGET (refuse/auto-tag on mismatch). Verify tagging holds one more window. Run-review Finding C.
- **Completion-gate retry churn (ex-C5).** PEAD 7/15 called `complete_run` ×8 + `record_run_summary` ×7 in one 87s run (Secular 7/14 ×7/×7). Runs complete — token tax, not a correctness bug; new since the Spine's audit obligations. Fix: refusal envelope should name the exact unaddressed thesisIds + the open obligation, so one retry suffices. Run-review Finding D.
- **`Order → TradeDecision → Thesis` is null on every held name (audit-integrity bug).** The relation carries `thesisId` only on the *original open*; every later HOLD/exit decision writes `thesisId: null`, so anything walking that path to a thesis silently finds nothing on exactly the actively-managed names. Surfaced building `list_proposals` (#502) — all 5 live staged exits resolved to no thesis through the relation; had to fall back to `(analyst, ticker)`. **Not the proposal-fatigue cause** (the suppression gate keys on `positionId`, see P1-39 / `PROPOSAL_FATIGUE.md`), but real for audit + any relation-keyed consumer. Fix: populate `thesisId` on every `TradeDecision`, not just the open.
- **`fieldChanges: {}` + `PROPOSAL_*` audit-diff lossiness (undercuts P1-33).** Two fail-soft audit holes: (a) `update_thesis`'s diff builder drops changes — target/stop/trigger edits land with an empty `fieldChanges` (XENE target 80→95 recorded as `{}`); (b) `PROPOSAL_*` `ThesisUpdate` writes are try/catch-swallowed, so `PROPOSAL_REJECTED` covers only **20 of 90** actual rejections (22%). Both falsify P1-33's premise that "every step IS in the DB with exact `fieldChanges`" — you can't render a "floor 64→71" timeline off an empty diff, and any consumer reasoning about rejection history from `ThesisUpdate` is reading a bad picture (incl. possibly `unapprovedExitCount` — see P1-39 open Q1). Fix: repair the diff builder + make the `PROPOSAL_*` write non-swallowing. **Prerequisite for P1-33's trigger-timeline slice.**
- **Dead FMP round-trip on the 1D chart's hot path (small, pure win).** `getIntradayCandles` tries `getIntradayCandlesFmp` **first** on every 30s poll; that endpoint is `/api/v3/historical-chart/1min`, a retired legacy path that returns **403 in ~83ms, every single time**, before the Alpaca fallback does the real work. Delete the FMP branch and call Alpaca directly. One-function change, removes a guaranteed-failing network call from the most-polled surface in the app. (Filed with P1-42.)
- **Extend the "live quote must not be cached" guard beyond `getStockQuote` (pairs with P1-41).** `lib/actions/finnhub-quote.test.ts` now pins the `getStockQuote` path, but the other quote fetches (`research-helpers.finnhub()`'s `/quote` branch, the intraday-bar fetches) are still one-word options a refactor could silently flip, and the failure mode is invisible. Cheapest broad guard is a lint rule: no fetch to a `/quote`-ish URL may carry `next.revalidate` or `force-cache`.
- **Principal Buy/Add button on the position card (feature).** The capability exists (principal-mode `place_trade` via `/chat?analyst=<id>` — used for the MU add), but there's no button on the position/thesis card to do it. UX gap, not a bug. Chip discussed, never built.
- **Docs housekeeping: two archive dirs + trigger-doc sprawl.** After #496, archives are split across `docs/legacy/` (30) and `docs/plans/legacy/` (13) — reconcile to one convention. The trigger space now carries four overlapping docs (`TRIGGERS.md` reference + `TRIGGER_MODEL` + `TRIGGER_LIFECYCLE` + `THESIS_GAME_PLAN`) — consolidation candidate once the model settles. Plus ~90 code-comment `// see docs/plans/<NAME>.md` refs now point at moved (`plans/legacy/`) paths — findable by basename, low priority.
- **Alpaca SIP data upgrade + drop Finnhub (revisit when Alpaca Pro is active).** Filed 2026-07-27. Chart data comes from Alpaca's **free IEX feed** (~2–3% of volume, no pre/post-market, coarse on illiquid names); [#498](https://github.com/dave-sucks/hindsight/pull/498) got it correct + dense on that feed (split-adjust, linear line, hourly 1W/1M). The paid completion, once the principal activates **Alpaca Algo Trader Plus** ($99/mo, funding it via a deposit that crosses the included-tier threshold): **(1)** flip `feed=iex`→`feed=sip` in the 3 candle fetches in `lib/actions/finnhub.actions.ts` (`getStockCandles`, `getStockCandlesBatch`, `getHourlyCandles` — plus `getIntradayCandlesAlpaca`) → full-volume consolidated bars + real pre/post-market on every range (one-liner each). **(2)** Then consolidate. ⚠️ **CORRECTED 2026-08-14 — the original direction here was backwards.** This item used to read "kill Finnhub, keep FMP + Alpaca," justified by FMP "uniquely serving analyst price targets + market movers + economic calendar." A live endpoint audit (see **P1-42**) shows **two of those three are 402 on the current plan** — price targets and economic calendar are dead, and so is everything else FMP does except **market movers**. Finnhub is the healthy vendor (profile/metric/recommendation/earnings-calendar/quote all 200). **So the direction is: keep Finnhub, drop FMP** — or, if the SIP flip happens, **Alpaca (quotes + bars + execution) + Finnhub (fundamentals/earnings/news)** and replace FMP's movers, its one surviving capability. Killing Finnhub as originally written would strand the app on a subscription that serves almost nothing. **Verify each endpoint against the actual key before committing either way — that assumption is exactly what broke here.** (Perplexity/Firecrawl/SEC stay — orthogonal.)
- **`/performance` is deposit-naive.** `analytics.actions.ts` still hardcodes `STARTING_CAPITAL=100k` (the homepage was fixed via `lib/portfolio/contributions.ts`; /performance + the chart's Unrealized-Only / vs-S&P toggles weren't). Reuse the contributions helper. See the recurring-bug entry in `CLAUDE.md`.
- **Narrow the P1-28 cooldown carve-out → folded into [P1-39](#p1-39).** The #445 cooldown exempts `closeReason ∈ {STOP,TARGET}`; the 2026-08-03 data proves this exemption is the primary driver of the fatigue loop (not "low value" as previously marked) now that the Game Plan puts a STOP-tagged floor on every holding. The fix lives in P1-39 (narrow the carve-out to genuine re-cross). Kept here as a pointer only.

### Parked / done (not active items)
- **External thesis ingest** — **shipped ([#460](https://github.com/dave-sucks/hindsight/pull/460)):** mint theses from flat-rate-chat JSON via a thin ingest that reuses the `record_thesis` server logic. (An MCP-tool variant remains a possible future extension.)
- ~~**Trailing stop as a first-class trigger predicate**~~ — **built then removed** ([#458](https://github.com/dave-sucks/hindsight/pull/458)). A `TRAILING_STOP` predicate was added, but the principal wanted a **directional daily % move** ("Movement Amount": up/down X% on the day), not a peak-trailing stop. Shipped that instead as `PRICE_MOVE_PCT` (window `1D`, fires on the cron via the quote's daily % change); `TRAILING_STOP` was fully removed (predicate + all switches + the trailing conversion path). See `docs/TRIGGERS.md`. Recorded so it isn't re-attempted.
- **Activity feed "Sold" → "Rejected"** — **shipped.** Cancelled (rejected/expired) buy proposals render as a `REJECTED` activity item ("Rejected — buy N @ $X"), not a "Sold" card (`lib/actions/portfolio.actions.ts:1085-1093`; confirmed in the live feed). Removed from the board. (Minor residual not tracked: rejected SELL orders on a still-OPEN position aren't surfaced as a feed event yet.)
- **Paused intelligence infra + Sunday `discovery-run.ts` cron** — **paused and parked.** Fine as-is; the principal will revisit / maybe rebuild discovery later. **Not an open decision — don't re-raise each session.**

---

## See also

- [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) — **closed items** (the 4-day live-trading sprint + the thesis-architecture rework). The PRs are the full record.
- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for the thesis system (5 roles + lifecycle).
- [`VISION.md`](./VISION.md) — product north star.
