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

### P1-30 — Gain-protection is thin: a winner can round-trip to a loss with no sell signal
**Status:** **shipped, pending live validation** (2026-07-12). The Game Plan stack landed:
[#477](https://github.com/dave-sucks/hindsight/pull/477) `GAIN_FROM_ENTRY` + `TRAILING_FROM_HIGH`
predicates · [#481](https://github.com/dave-sucks/hindsight/pull/481) ladder-health +
`UNPROTECTED_GAIN` needsAction · [#480](https://github.com/dave-sucks/hindsight/pull/480) standing
protection minimums (+10% checkpoint / 8% trail / −12% loser review) in every held template +
conversion script (executed — all 11 live holdings verified carrying the rungs) ·
[#483](https://github.com/dave-sucks/hindsight/pull/483) (open) the Spine prompts + warn-gate.
See `docs/plans/THESIS_GAME_PLAN.md` + `docs/plans/TRIGGER_LIFECYCLE.md` (the authority/visibility
contract). **Close after #483 merges + one validated run + the first live trail/checkpoint cycle.**
Original filing follows for context:
A held winner's only automatic downside trigger is its **fixed entry-stop** (e.g. −8% from entry).
A name up 20% can give back the entire gain before that stop fires — **nothing trails the gain.**
Caveat/history: the `TRAILING_STOP` predicate was deliberately removed in [#458](https://github.com/dave-sucks/hindsight/pull/458)
in favor of the daily `PRICE_MOVE_PCT` move — but a daily % move does NOT protect a slow multi-day
bleed from the high. So there is currently **no** trail-from-high or trail-from-set-point,
automatic OR manual. Principal wants (2026-07-06):
- Analyst-wide protection defaults: REVIEW/EXIT on a **>X% down day** (e.g. 4%), on an **X%
  give-back from the peak** (e.g. 8% from high), and on **X% trailing from where the trigger was
  set** (point-in-time trailing).
- This is bringing back trail-from-high (removed in #458) in a form that protects *cumulative*
  gains — reconcile with the daily-%-move decision rather than blindly reverting it.

### P1-31 — Analyst-level (portfolio-level) standing trigger rules, not just per-thesis
**Status:** open, filed 2026-07-06 (principal).
Triggers today are per-thesis. Principal wants **standing rules at the analyst / portfolio level**:
"do X when ANY of my holdings reaches +X% / drops X% in a day / week / trailing / from high." They
auto-apply across the whole book so risk + press behavior is configured once, not per name. Pairs
with the Spine (agent-authored per-thesis ladders in `docs/plans/SCALE_INTO_WINNERS.md` WS0):
standing rules are the floor; the agent fills in smart per-name levels on top.

### P1-32 — Surface + customize triggers / rules / thresholds in settings (UI)
**Status:** open, filed 2026-07-06 (principal).
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
**Status:** open, promoted from candidate 2026-07-21. **Live — it has already moved real money.**
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
run. **Two-layer fix:** (1) narrow the carve-out to fire only on a genuine price re-cross (honor an
expiry/reject as a hold otherwise — #490's real intent); (2) extend `list_proposals` (#502) to the
daily-run/tactical allowlist so the agent dedups against its own queue. Full diagnosis + acceptance test:
[`plans/PROPOSAL_FATIGUE.md`](./plans/PROPOSAL_FATIGUE.md). **Subsumes the ex-P2 "hold + retune affordance"
and "narrow the P1-28 carve-out" items.** Secondary (real but NOT the loop's cause, see the doc): the
`Order→TradeDecision→Thesis` null-on-held relation bug (P2 below) + the `PROPOSAL_*` audit lossiness (folds
into the `fieldChanges: {}` P2 item).

_(P1-26 + P1-29 closed 2026-06-26 — see [`GAPS_HISTORY.md`](./GAPS_HISTORY.md).)_

---

## P2 — Backlog

### Active
- **Discovery-mint executability vet.** *(Sharper half of P1-38, tracked here for the tuning slice.)* Vet each minted `entryPrice` / ENTER level against structure (20d/50d, confirmation) at write time so discovery can't mint a chronically-true-but-unfillable entry. CAPR 7/16 = the case.
- **`closeReason` mis-tag assertion (ex-C3).** 7/13 protective closes tagged `closeReason=MANUAL` (only ARQT carried `STOP`) → EWTX's floor breach wrongly P1-28-suppressed. Self-corrected to `STOP` from 7/14 (coincident with #490). The #490 risk-exit carve-out keys off this field. Fix: Layer-1 assertion — a close from a protective/trailing fire must carry STOP/TARGET (refuse/auto-tag on mismatch). Verify tagging holds one more window. Run-review Finding C.
- **Completion-gate retry churn (ex-C5).** PEAD 7/15 called `complete_run` ×8 + `record_run_summary` ×7 in one 87s run (Secular 7/14 ×7/×7). Runs complete — token tax, not a correctness bug; new since the Spine's audit obligations. Fix: refusal envelope should name the exact unaddressed thesisIds + the open obligation, so one retry suffices. Run-review Finding D.
- **`Order → TradeDecision → Thesis` is null on every held name (audit-integrity bug).** The relation carries `thesisId` only on the *original open*; every later HOLD/exit decision writes `thesisId: null`, so anything walking that path to a thesis silently finds nothing on exactly the actively-managed names. Surfaced building `list_proposals` (#502) — all 5 live staged exits resolved to no thesis through the relation; had to fall back to `(analyst, ticker)`. **Not the proposal-fatigue cause** (the suppression gate keys on `positionId`, see P1-39 / `PROPOSAL_FATIGUE.md`), but real for audit + any relation-keyed consumer. Fix: populate `thesisId` on every `TradeDecision`, not just the open.
- **`fieldChanges: {}` + `PROPOSAL_*` audit-diff lossiness (undercuts P1-33).** Two fail-soft audit holes: (a) `update_thesis`'s diff builder drops changes — target/stop/trigger edits land with an empty `fieldChanges` (XENE target 80→95 recorded as `{}`); (b) `PROPOSAL_*` `ThesisUpdate` writes are try/catch-swallowed, so `PROPOSAL_REJECTED` covers only **20 of 90** actual rejections (22%). Both falsify P1-33's premise that "every step IS in the DB with exact `fieldChanges`" — you can't render a "floor 64→71" timeline off an empty diff, and any consumer reasoning about rejection history from `ThesisUpdate` is reading a bad picture (incl. possibly `unapprovedExitCount` — see P1-39 open Q1). Fix: repair the diff builder + make the `PROPOSAL_*` write non-swallowing. **Prerequisite for P1-33's trigger-timeline slice.**
- **Principal Buy/Add button on the position card (feature).** The capability exists (principal-mode `place_trade` via `/chat?analyst=<id>` — used for the MU add), but there's no button on the position/thesis card to do it. UX gap, not a bug. Chip discussed, never built.
- **Docs housekeeping: two archive dirs + trigger-doc sprawl.** After #496, archives are split across `docs/legacy/` (30) and `docs/plans/legacy/` (13) — reconcile to one convention. The trigger space now carries four overlapping docs (`TRIGGERS.md` reference + `TRIGGER_MODEL` + `TRIGGER_LIFECYCLE` + `THESIS_GAME_PLAN`) — consolidation candidate once the model settles. Plus ~90 code-comment `// see docs/plans/<NAME>.md` refs now point at moved (`plans/legacy/`) paths — findable by basename, low priority.
- **Alpaca SIP data upgrade + drop Finnhub (revisit when Alpaca Pro is active).** Filed 2026-07-27. Chart data comes from Alpaca's **free IEX feed** (~2–3% of volume, no pre/post-market, coarse on illiquid names); [#498](https://github.com/dave-sucks/hindsight/pull/498) got it correct + dense on that feed (split-adjust, linear line, hourly 1W/1M). The paid completion, once the principal activates **Alpaca Algo Trader Plus** ($99/mo, funding it via a deposit that crosses the included-tier threshold): **(1)** flip `feed=iex`→`feed=sip` in the 3 candle fetches in `lib/actions/finnhub.actions.ts` (`getStockCandles`, `getStockCandlesBatch`, `getHourlyCandles` — plus `getIntradayCandlesAlpaca`) → full-volume consolidated bars + real pre/post-market on every range (one-liner each). **(2)** Then **consolidate to 2 data vendors: kill Finnhub, keep FMP + Alpaca.** Alpaca-SIP absorbs quotes/options/news; FMP is the keeper (uniquely serves analyst price targets + market movers + economic calendar); everything else Finnhub does (profile/fundamentals/earnings/recommendations/peers/search) FMP also covers. Reverse (kill FMP) strands targets/movers/econ. The Finnhub removal is a ~8-call-site migration PR — do it **after** the SIP flip, verifying FMP's tier serves each endpoint. (Perplexity/Firecrawl/SEC stay — orthogonal.)
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
