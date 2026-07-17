# The Trigger Model — the conceptual shape (canonical)

> **What this is:** the unifying mental model for everything trigger-shaped in
> Hindsight, locked with the principal 2026-07-15. [`TRIGGER_LIFECYCLE.md`](./TRIGGER_LIFECYCLE.md)
> is the *operational contract* (who sets what, when, visibility);
> **this doc is the *shape*** — what a trigger IS, what is and isn't one, and
> the target model that productization (provenance, popover, PR-E cascade,
> PR7 instant-adds) must converge toward. When a build decision conflicts
> with this shape, flag it — don't quietly diverge.

---

## 1. The primitive: `(condition, action, mode, timing)`

Every trigger is four fields:

| Field | Meaning | Today's implementation |
|---|---|---|
| **condition** | The IF — a machine-evaluable predicate over price, position P&L, time, or an external event | `TriggerPredicate` union (incl. `GAIN_FROM_ENTRY`, `TRAILING_FROM_HIGH`) |
| **action** | The THEN — ENTER / ADD / TRIM / EXIT / REVIEW | `TriggerAction` |
| **mode** | **Instant** (action fully pre-specified; stage it deterministically — still approval-gated) vs **Agent** (wake judgment to validate/decide) | `fireMode: DIRECT \| TACTICAL` — but DIRECT is currently EXIT-only (gap, see §5) |
| **timing** | Agent-mode only: **now** (tactical run, ~5 min) vs **batched** (next daily run) | Hard-wired by action today: REVIEW batches, everything else is now (gap: not yet a per-trigger choice) |

The principal's canonical pair, proving mode is orthogonal to action:
- *"I know I want to buy more at $115"* → `(price ≥ 115, ADD, Instant)`
- *"At $115 something in my thesis may be proven — review and decide whether to buy"* → `(price ≥ 115, ADD, Agent, now)`

Same condition, same action — different mode. That's the whole model.

## 2. REVIEW is not a special case

REVIEW is simply **the action whose payload is "summon judgment" instead of
"place an order."** Consequence: **REVIEW is the one action that is always
Agent-mode** (a deterministic "review" is a contradiction — reviewing IS the
judgment); its only sub-choice is timing (now vs batched; today always
batched, except BREAKING-urgency signals). ENTER/ADD/TRIM/EXIT can be either
mode. The daily run being "a review of the book" is the same verb at
portfolio scope — consistent, not conflated.

## 3. Three distinct layers (do not blur them)

The current `needsAction` enum blurs three genuinely different things:

1. **Trigger rules** — the `(condition, action, mode, timing)` records above.
   Durable, visible on the thesis, editable.
2. **The attention inbox** — the *worklist over* triggers, computed at read
   time: `TRIGGER_FIRED` ("a rung crossed and hasn't been handled") and
   `TRIGGER_MATCHING_NOW` ("this condition is true at this moment" — the
   safety net for missed/cooled fires). These are to triggers what *unread*
   is to email — state about rules, not rules.
3. **Lifecycle obligations** — debts created by human/system actions, not
   market conditions: `PROMOTED_AWAITING_RESOLUTION`. Belongs to the thesis
   state machine, never to the trigger array.

**Classification of today's flags:**
- `REVIEW_DUE` → already a trigger in disguise (`REVIEW_DATE_HIT` /
  `TIME_ELAPSED`). ✅ correct shape. ("Add every 30 days" is the same shape
  with action=ADD — legal today.)
- `RUNNING_WINNER` → a pure position predicate (`progress ≥ 0.75 OR gain ≥
  12% → REVIEW, batched`). **Should eventually be a visible trigger**, not an
  invisible computed flag (§5).
- `UNPROTECTED_GAIN` → **NOT a trigger — a ladder linter.** Its condition
  reads *the other triggers* (gain vs what the tightest floor locks). It is a
  health check on the trigger set, same family as the `complete_run`
  warn-gate. Keep it computed and visually distinct from rungs.
- `TRIGGER_FIRED` / `TRIGGER_MATCHING_NOW` → inbox (layer 2), never rungs.
- `PROMOTED_AWAITING_RESOLUTION` → lifecycle (layer 3), correctly unique.

**Multiplicity:** a thesis can have several live conditions at once (up 10%
AND review-due AND unprotected). `needsAction` collapsing to ONE flag by
precedence is an attention-UI simplification, not the truth — the daily run
should resolve the thesis's whole live set holistically; precedence only
picks what to lead with.

## 4. The two reference grids (values verified against code 2026-07-13)

### Grid 1 — standing triggers stamped on every HOLDING (`defaults.ts`)

| Rung | Condition | Action → route | Cooldown | Evaluated by |
|---|---|---|---|---|
| Hard stop | price below stop | EXIT → tactical | 0 (re-fires) | 5-min cron |
| Add on strength | +7% day | ADD → tactical | 3d | 5-min cron |
| Add on pullback | −7% day | ADD → tactical | 3d | 5-min cron |
| Gain checkpoint | +10% from entry | REVIEW → next morning | 7d (per-kind default) | 5-min cron |
| Trail ratchet | −8% off the high | EXIT → tactical | 0 (re-fires) | 5-min cron |
| Loser review | −12% from entry | REVIEW → next morning | 7d | 5-min cron |
| Target (TARGET horizon) | price ≥ target | REVIEW → next morning | 7d | 5-min cron |
| Target (TRADE horizon) | price ≥ target | EXIT → tactical | 0 | 5-min cron |
| Earnings beat/miss | surprise | REVIEW → next morning | 7d | ⚠️ signal path (severed — P1-34) |
| Filing (8-K/Form 4) | filed | REVIEW → next morning | 1d | ⚠️ signal path (severed) |
| Bearish news | routed signal | REVIEW → next morning | 1d | ⚠️ signal path (severed) |
| Time hygiene | N days elapsed | REVIEW → next morning | ~80% of window | 5-min cron |

Set by code templates → stamped at mint, at the buy fill
(`place-trade.ts:898` re-seed), and via the 2026-07-12 conversion script.
Agent-authored rungs win per (predicate, action) bucket; principal edits win
over everything.

### Grid 2 — attention flags (computed per morning read; NOT stored triggers)

| Flag | Layer (§3) | Fires when | Forces |
|---|---|---|---|
| PROMOTED_AWAITING_RESOLUTION | lifecycle | principal promoted to live | decide today (re-enter / defer / kill) |
| TRIGGER_FIRED | inbox | a rung fired, unhandled | act on that rung |
| TRIGGER_MATCHING_NOW | inbox | condition true at read time | act on it |
| UNPROTECTED_GAIN | **linter** | gain ≥ 8% AND floor lags ≥ 6pts | fix the ladder (or attest why not) |
| RUNNING_WINNER | trigger-in-disguise | ≥ 75% to target OR gain ≥ 12% | press / hold / take |
| REVIEW_DUE | trigger-in-disguise | nextReviewAt reached / directive | re-underwrite |

Fire-route correction worth repeating: floor/trail EXITs default to
**tactical** (fast agent validates, then proposes) — the *arming and firing*
is mechanical (peak tracked, predicate evaluated with no agent), and DIRECT
(skip the agent entirely) is per-trigger opt-in.

## 5. Convergence gaps (what "building it correctly" means)

1. **Extend Instant mode beyond EXIT** (old PR7): pre-planned deterministic
   ENTER/ADD/TRIM rungs — the mode axis completed. Risk asymmetry respected:
   instant ADD stays approval-gated with a conviction floor.
2. **Trigger provenance** — a `source: DEFAULT | ANALYST_RULE | AGENT |
   PRINCIPAL` field stamped at write. The unlock for every visibility
   feature: per-pill origin labels on the thesis, the self-documenting
   popover ("when this fires… won't re-alert for… set by…"), honest
   #486-style defaults surfaces.
3. **Fold RUNNING_WINNER into a visible trigger** so the whole ladder is
   uniform and self-documenting; keep UNPROTECTED_GAIN a linter.
4. **Timing as a real per-trigger field** (now vs batched) instead of
   hard-wired by action.
5. **The cascade (PR-E / P1-31/32):** account standing rules → analyst
   overrides → template → agent-authored → principal. Most-specific wins;
   `mergeTriggers` already implements the bottom of this — the cascade adds
   two levels above it, not a rebuild. Defaults stay **visible and
   overridable** (labeled via provenance), not hard-locked — "the analyst
   manages with nuance" is the product's soul; a fully-locked rules engine
   is not the goal.

## 6. Productization sequence (visibility → control)

1. **#486** — defaults visible in analyst settings (read-only card). *Built.*
2. **Provenance field + self-documenting trigger popover** — every trigger
   explains itself at the point of use. *(Next build.)*
3. **Thesis-sheet origin labels** — "front and center on the thesis: this
   reviews at +10% BECAUSE it's a default."
4. **PR-E** — the cascade goes editable (account/analyst standing rules).
5. **PR8** — the activity feed shows fires → decisions → outcomes.
