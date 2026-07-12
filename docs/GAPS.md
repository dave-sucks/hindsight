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

_(P1-26 + P1-29 closed 2026-06-26 — see [`GAPS_HISTORY.md`](./GAPS_HISTORY.md).)_

---

## P2 — Backlog

### Active
- **`/performance` is deposit-naive.** `analytics.actions.ts` still hardcodes `STARTING_CAPITAL=100k` (the homepage was fixed via `lib/portfolio/contributions.ts`; /performance + the chart's Unrealized-Only / vs-S&P toggles weren't). Reuse the contributions helper. See the recurring-bug entry in `CLAUDE.md`.
- **Narrow the P1-28 cooldown carve-out (optional stopgap, ex-P1-29 (a)).** The #445 cooldown exempts `closeReason ∈ {STOP,TARGET}`, so an agent-decided TARGET exit the principal keeps rejecting isn't dampened. One-line change: don't blanket-exempt a STOP/TARGET close that has a recent USER rejection. **Low value now** — P1-29's #457 fix means the agent reads the directive + the principal can edit the target/stop directly, so the root cause of the nagging is addressed. Only bother if residual re-proposals annoy in practice.

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
