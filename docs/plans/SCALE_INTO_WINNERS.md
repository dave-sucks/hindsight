# Plan — Scale Into Winners (press / hold / take + re-entry)

> **What this is:** the multi-PR plan to make the agent *manage conviction* — add to
> winners, raise targets, take partial profits, and re-enter names it sold — instead of
> running one-shot bets (enter once → sell at a lowball target → forget). The app's goal
> is **profit per idea**, not ticker count. A great version trades the same ~10 names for a
> year and compounds. Today it churns.
>
> **Status:** planning, opened 2026-06-29. No PRs yet. Decisions below are settled with the
> principal except where marked **OPEN**.
>
> **Read first:** [`PRINCIPLES.md`](../PRINCIPLES.md) (three-layer), [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md)
> (lifecycle + 5 roles), and `docs/TRIGGERS.md` (firing matrix — being written alongside the
> market-hours-gate PR; this plan depends on it as the canonical trigger reference).

---

## Status table

| # | Workstream | Layer | Status | Depends on |
|---|---|---|---|---|
| 0 | **Active trigger authorship (the spine)** — writer/daily/tactical actively set+edit the ladder | L1+L2+L3 | not started | runs through all below |
| 1 | Caps redesign (2× per name, add-path) | L1 gate | ✅ in review ([#467](https://github.com/dave-sucks/hindsight/pull/467)) | — |
| 2 | Default trigger ladder on holdings (ADD / REVIEW / MOVE_STOP + % up/down) | L2 + builder | not started | `docs/TRIGGERS.md` |
| 3 | `RUNNING_WINNER` attention (5th `needsAction` kind + P&L join) | L2 | not started | — |
| 4 | Tactical add-evaluation branch (press/hold/take + checklists) | L2 result + L3 prompt | not started | 1 |
| 5 | Re-entry of sold names (profit-take → WATCHING, daily-run re-enter) | lifecycle + L1 | not started | — |
| 6 | Review-due requires a targeted data pull | L1/L3 | not started | — |
| 7 | Extend DIRECT fire-mode to ADD/TRIM (instant pre-planned rungs) | tactical + L1 | not started | fireMode synced into branch |

---

## The diagnosis (why everything is green but underwhelming)

Two compounding leaks, both verified against prod data 2026-06-29.

### Leak 1 — the target is a *ceiling*, not a *checkpoint*

Every winner is sold at a number picked on day one, before it was known to be a winner.

| Name | Entry | Target set | What it actually did |
|---|---|---|---|
| **MU** (live, held) | $884 | **$900 (+1.8%)** | Peaked **$1,236 (+39.8%)**; hit a $1,089 trigger 6/15 → proposed sell (lapsed) → ran to $1,236 → round-tripped through the $790 stop |
| **CRDO** (live, closed) | $216 | $270 (+25%) | Sold at target $275 → kept running to **$302**; ~10% left the day after the sale |
| ~30 closed paper winners | — | +6% to +15% | Almost all `closeReason=TARGET`, sold right at a low target. The target *was* the exit |

### Leak 2 — there is no "press the winner" move in the run loop

A thesis is a one-shot bet: enter once, exit once. Even with MU up 40% and the thesis
strengthening, the only verbs the loop offered were "sell at target" / "sell at stop."

### Mechanical root cause (all verified, code-cited)

1. **The morning agent looks away from quiet winners by design.** Attention is gated by
   `needsAction` (`lib/agent/needs-action.ts:67-106`), which has exactly 4 kinds:
   `PROMOTED_AWAITING_RESOLUTION`, `TRIGGER_FIRED`, `TRIGGER_MATCHING_NOW`, `REVIEW_DUE`.
   A winner with no fired trigger and a future review date → `needsAction = null` →
   `actionability = "ACTIVE_HOLD"` (`lib/agent/resolved-thesis.ts:198-199`) → and the prompt
   *tells the agent to skip it*: "Theses with `needsAction == null` don't need to be touched…
   Yesterday's thesis stands." (`lib/agent/system-prompt.ts:253`).
2. **The data exists but nothing joins it or flags it.** P&L / % gain / distance-from-peak
   live only in `get_portfolio_context` (`get-portfolio-context.ts:172-188`); `get_theses`
   has the thesis but **no gain math** (`get-theses.ts:194-264`). Nothing computes
   "winner running / near target / room to add" anywhere.
3. **No ADD trigger is ever authored.** No default trigger builder emits `ADD` (only
   EXIT/REVIEW for holdings); the agent is never told to set one. So the (working) ADD
   execution path has no fuel.
4. **Sold names go DEAD and fall off the radar.** `close_position` → `RETIRED/SOLD`
   (`close-position.ts:244-250`) → `actionability="DEAD"` (`resolved-thesis.ts:184-186`) →
   excluded from the default book (`get-theses.ts:149` returns only HOLDING/WATCHING/PROMOTED).
   With Discovery paused, **the system currently cannot re-enter a name it sold.**
5. **Reviews don't require looking.** A plain `REVIEW_DUE` can be closed with a rationale-only
   REVIEWED row and **zero fresh data** (`system-prompt.ts:235,243-244`; staleness is
   "advisory, not enforcing," `get-theses.ts:589-591`).
6. **Caps are tuned for one-shot entries.** `place_trade` caps each entry at 1× `maxPositionSize`
   (`place-trade.ts:424`); `add_to_position` caps total at 1.5× (`manage-position.ts:684`).

---

## What already works (do not re-investigate)

Verified 2026-06-29. The hard parts exist — this plan is connective tissue, not a rebuild.

- **ADD / TRIM / MOVE_STOP execution path is fully wired.** Trigger fires for every action
  except REVIEW (no EXIT-only gate) → `app/thesis.trigger.fired` → `tactical-run` carries the
  action verbatim → routes ADD → `manage_position.add_to_position` (real Alpaca buy, polls fill,
  re-blends avgCost) / TRIM → `partial_close`. (`trigger-evaluator.ts:515-543`,
  `tactical-run.ts:255-306`, `intraday-tactical.ts:248-250`, `manage-position.ts:762-867,435`.)
  An ADD trigger that fires **executes end-to-end today** — it was simply never set.
- **% triggers are LIVE for 1-day moves.** `PRICE_MOVE_PCT { window:"1D" }` passes the cron's
  `isPriceSidePredicate` filter and is evaluated off `latestQuote.changePct` (Finnhub daily %
  vs prior close) — no candles needed (`evaluate.ts:310-329`). Proven empirically (VRT "down 1%"
  fired 2026-06-29). UP fires at `changePct ≥ pct`, DOWN at `≤ −pct`. Fire-mode TACTICAL
  (agent decides) or DIRECT (no-agent), both approval-gated. Cooldown prevents same-day re-fire.
  - **Caveat that shapes this plan:** the % is **daily move vs prior close, not cumulative gain
    from entry.** So % triggers catch single-day pops/dumps; they do **not** catch a quiet
    cumulative winner (MU +40% over a month). That cumulative case is what workstream #3 exists for.
- **`update_thesis` does surgical partial patches.** All fields optional except `thesis_id` +
  `rationale` (`update-thesis.ts:81-86`). A triggers-only or target-only patch is valid — no full
  rewrite. A **triggers-only edit does NOT trip the structural-belief gate** (that gate's
  `touchesQuant` is scoped to target/stop/confidence only, `:1484-1488`). **Raising a target**
  needs a one-line `structural_unchanged_reason` or a paired belief edit — i.e. the "re-attest
  belief before moving the goalpost" discipline is already enforced for free. **Footgun:**
  `triggers` is wholesale-REPLACE, not merge (`:254-257`) — to add one, resend the full array +
  the new trigger; the L2 work must surface the current ladder so an edit can't silently drop one.
  Guards that still apply to a trigger edit: WATCHING longs/shorts must keep ≥1 ENTER trigger;
  can't strip a committed thesis to zero triggers.
- **DIRECT fire-mode is EXIT-only today.** An ADD/TRIM with `fireMode:"DIRECT"` is coerced to
  TACTICAL at creation (`thesis-edit.ts:569-571`) and guarded at runtime (`tactical-run.ts`
  requires `action==="EXIT"`) — there is **no instant-add path yet** (→ PR7). DIRECT still routes
  through the approval gate (`closeOpenPosition(..., "price_monitor", ...)`): it skips the *agent*,
  not the *gate*. Direct-eligible predicates = PRICE_ABOVE/PRICE_BELOW/TRAILING_STOP/PRICE_MOVE_PCT.
  **⚠️ `fireMode` (PR #462) is NOT in this worktree branch** — it's in git history (`d2cb11a`/
  `e5b030d`). Sync before any fireMode work. (The "worktree stale-drift gotcha.")
- **Digest, daily-run loop, trigger editing (`update_thesis`), `get_portfolio_context` P&L** —
  all built by the principal.

---

## The framework

**Reframe the target: the first target is a decision point, not an exit.** Hitting it (or a
strength/pullback move arriving) triggers a *re-underwrite*, and the agent chooses:

- **PRESS** — thesis is *stronger* than at entry → add size, raise the target, **raise the stop**
  (so the bigger position can't round-trip into a loss — the MU lesson). = `ADD` + `update_targets`.
- **HOLD** — intact but no new edge → trail stop, maybe modest target bump, don't add. = `MOVE_STOP`.
- **TAKE** — momentum exhausting or R/R now poor → trim or close. = `TRIM` / `EXIT`.

**This is NOT a new concept.** Press/Hold/Take == the existing `ADD / TRIM / MOVE_STOP / REVIEW /
EXIT` trigger vocabulary, finally *authored and maintained*. The target stops being a single
sell-number and becomes a **ladder the agent edits every run** — e.g. for a holding:
`Add-if breaks $893 · Review-if $780 · Trim-if $1,050 · Move-stop-to $830`.

### Two add styles (both — per principal)

**Add into strength** (price up, on a % UP trigger or at a target checkpoint) — confirm *all*:
1. Catalyst playing out — beat-and-raise, estimate revisions up, target hikes (thesis getting *more* true).
2. Healthy structure — new high after a pause, higher lows, above rising 20/50-day, volume expanding up.
3. Not a chase — not already +>10% on the day; RSI strong but not blow-off.
4. Real room left — next-dollar R/R still ≥ ~2:1 to a *justified* (re-underwritten) target.

**Add into a pullback** (price down on a % DOWN trigger) — confirm *all*:
1. **Drop is market/sector-wide, not company-specific** (SPY + sector red; no bad company news). ← make-or-break.
2. No thesis damage — no guidance cut, no estimate cuts, no broken catalyst, no invalidated assumption.
3. Holds logical support (prior breakout level / rising 50-day) rather than slicing through it.
4. Genuine discount to the recent range — improves average + R/R.

**When to TAKE instead of add (either path):** target reached with no new edge; structure breaking
(lower highs, loses 50-day on volume); next-dollar R/R < ~2:1; any assumption invalidated (exit
regardless of P&L).

### Discipline (universal, enforced as gates)

1. Each strength rung is **smaller** than the last (pyramid, don't balloon the average).
2. **Every add raises the stop** — a pressed winner must never round-trip to a loss.
3. Hard ceiling: **2× a normal position** per name (principal's call). At 2×, ride — don't add.
4. Raising a target requires re-attesting the belief — **keep the structural-belief gate**
   (`update-thesis.ts:93,399-400`). It's what separates "pressing strength" from greed.

### Role ownership (unchanged seams)

- **Thesis-writer** re-underwrites the *research* (fresh target/stop/belief) — never pulls the trigger.
- **Daily run / tactical run** makes the press/hold/take *decision* and executes via `manage_position`.
- **Discovery** stays out. No new lifecycle state needed — `HOLDING` already covers a position
  being built; size is the orthogonal `targetSizePct` / `scalingPlan` dimension.

---

## Active trigger authorship — the spine (the linchpin, workstream 0)

The prettiest trigger system is worthless if the agents don't actively wield it — which is the
status quo. Making trigger-authoring a core, *enforced* behavior is the connective principle
through every PR below; it is not a single PR.

**Three reactivity tiers the agent picks per trigger when it authors one:**
- **DIRECT** — no agent, instant proposal. Pre-planned high-conviction rungs ("if it breaks $893,
  just stage the add"). Near-zero cost. *(Today: EXIT-only → PR7.)*
- **TACTICAL** — spins up the ~15-step agent to re-check before acting. "Something moved, use judgment."
- **REVIEW** — defers to the next daily run, no intraday order. "Flag it, don't act."

**Three review depths — answers "does it rewrite the whole thesis?" No:**
- DIRECT trigger → no research, just stages the action.
- Tactical / daily review → light research + **surgical `update_thesis`** (a few fields + edit the
  trigger ladder) + `manage_position`. Never rewrites the 15+ sections.
- Full re-underwrite (all sections) → only by dispatching a **THESIS_WRITER**, only when research
  is genuinely stale.

**What it takes to make agents active authors (all three layers — this is the spine):**
- **L3 prompt:** trigger-laddering as a first-class GOAL in thesis-writing AND every review —
  "every holding carries a live add/trim/exit ladder; every review re-checks and adjusts it."
  Goal, not procedure (PRINCIPLES.md forbids mechanics in the prompt).
- **L2 data (makes triggers SMART, not arbitrary — the most overlooked piece):** hand the agent
  (and pre-compute candidate levels from) recent swing highs/lows, support/resistance, 20/50-day,
  ATR/volatility, distance-to-target — so it sets "$893" off structure, not a round number. Plus
  surface the CURRENT trigger array clearly so an edit-and-resend can't silently drop a trigger
  (the wholesale-replace footgun).
- **L1 gate:** refuse to close out a run that leaves a HOLDING with no forward trigger — enforce
  activeness structurally, not in prose.

---

## PR sequence

Each PR is independently shippable and testable.

### PR1 — Caps redesign (L1)
Replace the 1× entry / 1.5× add split with a single **per-name ceiling = 2× `maxPositionSize`**,
applied to *total position value after the add* on the `add_to_position` path
(`manage-position.ts:681-694`) and consistent default fallbacks (the 500/2500/5000 drift noted in
research). Optionally a portfolio-level concentration guard (max % of equity per name) — **OPEN**,
default off until requested. Entry via `place_trade` stays at 1× (a fresh bet ≠ a proven winner).

### PR2 — Default trigger ladder on holdings (L2 builder)
When a thesis becomes HOLDING (and on writer refresh), seed a maintained ladder instead of
EXIT-only: a **% UP** trigger (strength-add candidate), a **% DOWN** trigger (pullback-add
candidate), a REVIEW at a "something's happening" level below target, and a MOVE_STOP rung. Tune
defaults per horizon (CATALYST/TRADE/TARGET/COMPOUNDER). Fire-mode = TACTICAL (agent decides),
not DIRECT. This gives the working execution path its fuel. Reference `docs/TRIGGERS.md` for
predicate × path semantics; do not duplicate the matrix here.

### PR3 — `RUNNING_WINNER` attention (L2)
Add a 5th `needsAction` kind (e.g. `RUNNING_WINNER`) computed server-side: position up ≥ X% **and**
near/through first target **and** thesis not stale **and** room under the 2× cap. Requires joining
P&L (cost basis + qty) into thesis resolution so `get_theses` can compute gain — today P&L lives
only in `get_portfolio_context`. This is the slow-path that catches the *cumulative* winner the
1-day % triggers miss. Prompt: a `RUNNING_WINNER` row routes to the press/hold/take evaluation.

### PR4 — Tactical add-evaluation branch (L2 result + thin L3)
Give the tactical/daily prompt a press/hold/take branch for ADD-action and `RUNNING_WINNER`,
carrying the strength-add / pullback-add checklists above as the agent's judgment frame (not
procedure). Pre-compute the inputs the checklist needs (is today's drop market-wide vs
company-specific? next-dollar R/R? distance from peak?) as result-shape, so the agent consumes
rather than derives. ~3 lines of L3 philosophy: "winners are where the money is; a meaningful move
or a target hit on a held name is a press/hold/take decision, not hold-by-default."

### PR5 — Re-entry of sold names (lifecycle + L1)
On a profit-take where conviction is intact, route the thesis to **WATCHING with a re-entry
trigger** instead of `RETIRED/SOLD` → DEAD. Let the daily/tactical run re-enter a WATCHING
(formerly-held) name (relax the "can't mint coverage without Discovery" rule for re-entry of a
name with thesis history). Re-entry buy stays trigger-fired + approval-gated (no uncontrolled
churn). This is the "does it ever revisit a stock it sold" fix + the correct use of WATCHING.
**Decision baked in (OPEN to override):** auto-move to WATCHING on profit-take when conviction
intact; re-entry remains approval-gated. Alternative considered: ask the principal "keep watching
vs let go" at sale — rejected as friction in the wrong place.

### PR6 — Review-due looks before it signs (L1/L3)
On `REVIEW_DUE` for a holding with a material position, require a targeted `get_stock_data` pull
(it already returns news) before a REVIEWED row — one cheap call per reviewed name. This is the
cost-efficient answer to the paused intelligence pipeline: pull *targeted* news at the review
point, not a background firehose. (Optional later: a narrow event feed — earnings/8-K/sector — so
external news can *trigger* a review, e.g. "competitor's drug failed → raise MU's limit.")

### PR7 — Extend DIRECT fire-mode to ADD/TRIM (instant pre-planned rungs)
Today DIRECT is EXIT-only — `tactical-run.ts` guards `action==="EXIT"` and `thesis-edit.ts:569-571`
coerces a DIRECT ADD/TRIM to TACTICAL. Extend the creation coercion + runtime branch so a
price-eligible (PRICE_ABOVE/BELOW/MOVE_PCT) **ADD or TRIM** can fire DIRECT — instant proposal, no
agent — for pre-planned rungs the agent already underwrote. **Risk asymmetry to respect:** a DIRECT
exit *reduces* risk (safe to automate); a DIRECT add *increases* it. So gate DIRECT-add behind
approvals-ON (always a human click) and/or a conviction floor; never let it auto-fill. Still routes
through `maybeAwaitApproval`. **Depends on fireMode being synced into this branch first** (worktree
drift — fireMode lives in `d2cb11a`/`e5b030d`, not the working tree).

---

## Decisions

- **Concentration ceiling:** 2× a normal position per name. ✅ (principal)
- **Add style:** both — strength (% UP / target) and pullback (% DOWN, market-wide only). ✅ (principal)
- **Trigger model:** hybrid — pre-planned ladder, each rung gated by a mini re-underwrite; driven
  by *both* the % triggers (single-day moves) and the target/`RUNNING_WINNER` checkpoint
  (cumulative). ✅
- **Re-entry behavior:** profit-take with intact conviction → WATCHING + re-entry trigger;
  re-entry approval-gated. ⚠️ **OPEN** — principal to confirm vs an approve-to-keep-watching prompt.
- **Portfolio-level concentration cap (% of equity/name):** ⚠️ **OPEN** — default off until requested.

## Open questions / dependencies

1. `docs/TRIGGERS.md` (other session, market-hours-gate PR) is the canonical firing matrix —
   PR2 depends on it landing first.
2. `RUNNING_WINNER` thresholds (gain %, target proximity) need tuning against the real book —
   start conservative, calibrate from run reviews.
3. The pre-market gate (other session) interacts with morning % fires — confirm ordering before PR2.
4. Re-entry: should a re-entered name reuse the old thesis (with a SUPERSEDED chain) or mint fresh?
   Lean: fresh thesis, `parentThesisId` → the retired one, for clean institutional memory.
5. PR7 (DIRECT add) is **blocked on syncing `fireMode` into this branch** — it's in git history
   (`d2cb11a`/`e5b030d`, PR #462), not the working tree. Rebase/merge before starting PR7.
