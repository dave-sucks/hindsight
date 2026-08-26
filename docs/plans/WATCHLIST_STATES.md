# Watchlist states v2 — cadence is the feature

> **Status:** ruled by the principal 2026-08-25, after the Levels-Are-Triggers
> merge (#553/#554). **Supersedes v1's discriminator** — v1 derived soft/active
> from the `entryPrice`/`stopLoss` columns; those are now a derived cache of
> the trigger list, so the states derive from triggers directly.
> **Linear:** DAV-209 (umbrella). **Depends on:** the merged Levels work —
> `REVIEW_CADENCE`, `DEMOTE`, armed floors/targets all exist now.
>
> The principal's one-line ruling, verbatim in spirit: *"What requires AI
> review boils down to: does it have a review cadence trigger or not. That's
> the feature for a watchlist item that gets managed."*

---

## 1. The goals (the problem statement, from the principal)

1. A user can watch **anything**, cheaply.
2. **Not** infinite items reviewed daily by AI for no reason.
3. A system for **elevating** a stock (soft → managed → held).
4. **Anything can be awoken** when a trigger hits.
5. Built on the **existing trigger infra** — no second system to maintain.

## 2. The two axes

Every watchlist question separates into two independent axes, both already
expressible as triggers after the Levels merge:

| Axis | Question | Mechanism | Cost |
|---|---|---|---|
| **Attention** | does AI review it on a clock? | resolved `REVIEW_CADENCE` trigger | tokens + daily-run time — the scarce resource |
| **Commitment** | is there a plan that fires? | `ENTER` / `EXIT` price triggers | zero until a level is hit |

**The states are derived, never stored:**

| | Wake triggers (price/event) | `REVIEW_CADENCE` | Plan (`ENTER`/`EXIT`) | Position |
|---|---|---|---|---|
| **Soft watch** | ≥1 required | none | none | — |
| **Managed watch** | any | **yes** | usually | — |
| **Holding** | any | yes (inherited OK) | yes | OPEN |
| **Archived** | not evaluated | — | — | — |

- A **soft watch** costs nothing standing. It wakes only when one of its
  triggers fires; the fire defers to the next daily run (the REVIEW-batching
  path — never a tactical spawn), where the analyst decides: elevate,
  re-price, or drop.
- A **managed watch** is what "the AI is working this name" means: reviewed on
  its cadence, thesis maintained, plan kept honest. This is the thing the
  review budget counts.
- Elevation and demotion are **trigger edits**, not status changes.

## 3. Invariants

1. **Every WATCHING item carries ≥1 reachable wake condition** — a price
   level, an event trigger, or a cadence. Zero wakes = invisible = rot
   (ETN/NVDA). Enforced at the add flow: you cannot save a watch item without
   answering "what brings this back to me?"
2. **Plan ⇒ cadence.** If ENTER/EXIT price triggers exist, a resolved
   `REVIEW_CADENCE` must too — a priced plan is always watched. (Resolves
   v1's §7 open decision as Option A, now expressible purely as a trigger
   rule.) To stop watching a plan, demote it first.
3. **WATCHING does not inherit cadence.** The account-level cadence floor
   applies to HOLDING only. A watch item is reviewed iff it carries its own
   explicit cadence trigger. This is what makes the soft tier representable
   at all — see Hole 1.

## 4. Transitions (all trigger edits)

| Move | What changes | Who |
|---|---|---|
| **Add to watchlist** | mint WATCHING item + ≥1 wake trigger. Instant auto-context (facts only — what it does, next earnings, fence match, prior history from our own book). No opinion, no plan | user or agent |
| **Elevate ("Research")** | dispatch thesis-writer → prices the plan (ENTER/EXIT triggers) + sets explicit cadence. Spends a review-budget slot | user button or agent proposal |
| **Demote (auto)** | `DEMOTE` fires when a floor/target breaks unheld → plan triggers cleared, item stays, note lands on next daily run | system (shipped in Levels) |
| **Demote (manual)** | delete the plan triggers in the popover — already works today | user |
| **Buy** | existing place_trade path; WATCHING→HOLDING; entry becomes fact | approval-gated |
| **Archive** | RETIRED + retiredReason; triggers stop being evaluated | user or agent |

## 5. The holes (= the build list, in order)

| # | Hole | Fix | Size |
|---|---|---|---|
| **W1** | **Soft tier unrepresentable.** The cadence seed put a 7d floor on the account (inherited by everything) and explicit per-horizon cadences on all HOLDING **and WATCHING** theses. Everything is currently "managed" | Resolver rule: WATCHING doesn't inherit `REVIEW_CADENCE` (invariant 3). Zero behavior change today — existing watches already carry explicit cadences from the seed | S |
| **W2** | **Agents can't mint a bare watch.** `record_thesis` requires LONG/SHORT/PASS + full belief gate; PASS+WATCHING rejected at ~line 1169 | Unpriced mint path: direction nullable, belief gate applies only when a plan is being written, PASS+WATCHING rejection removed. **Coordinate with the PASS dedup guard** (other session, post-08-25 incident) — key it so PASS→soft-watch conversion doesn't collide | M |
| **W3** | **No elevation flow.** | "Research" button on a watch row → thesis-writer dispatch (existing machinery). Prep for the add-flow auto-context (facts-only triage on add) | M |
| **W4** | **Cap counts mints, not attention.** `DISPATCH_CAP=5` throttles idea flow (DAV-211) while the scarce thing is review slots | Cap = max items per analyst with a resolved cadence. Soft watches uncapped. Overflow from discovery = soft watch with a wake, not a terminal PASS | S |
| **W5** | **List UI shows labels, not content.** | Row = ticker · one-line reason · plan line (if priced) · next wake. Empty context visible as empty — no computed "depth" badge | M |
| **W6** | **PASS reason codes** (DAV-215) | Ships independently, any time. The 08-25 incident's 20 reason-less PASS rows are the exhibit | S |

Order: **W1 → W2 → (W3 ∥ W4) → W5.** W6 whenever.

## 6. Already exists — do not rebuild

- `DEMOTE` action + firing floors/targets on watch items (Levels L5).
- REVIEW-batching: REVIEW fires never spawn tacticals; they write
  `TRIGGER_FIRED` and defer to the daily run. Load-bearing for a large soft
  pool — cannot be relaxed. (The signal path's BREAKING carve-out is the one
  re-entry risk when Signals returns — noted on DAV-196.)
- `REVIEW_CADENCE` cascade + `lastReviewedAt` clock + cooldowns (L7).
- Manual demote via trigger deletion in the popover.
- Wholesale-replace protection (`dropRedundantInherited`) and the ratchet
  rules — unchanged.
- A human-alert channel later hangs off the existing `TRIGGER_FIRED` event;
  nothing here blocks or requires it.

## 7. Open decisions (parked, not blocking)

- **Watch-without-analyst.** Triggers evaluate per analyst; an unassigned item
  is inert. If wanted: an "inbox" that nudges toward assignment, with
  auto-context suggesting the fence match — assignment is a triage output,
  not an add-time requirement. Defer until W1–W5 land.
- **Cadence granularity as the cost dial.** A 90d cadence is technically
  "managed" but costs ~nothing. If the binary ever feels wrong, the budget in
  W4 can weight by frequency instead of counting items. Start binary.
