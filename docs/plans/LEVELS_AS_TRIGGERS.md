# Levels as triggers — entry, target, stop and review are not rungs, and should be

> **For:** the session that makes price levels and review cadence first-class
> triggers. **Status:** spec only — no code. **Data-model change on live
> theses with real money; needs the principal in the room before any of it.**
> Diagnosed 2026-08-16 from production data.
> **Self-contained** — you don't need the conversation that produced it.
>
> Absorbs GAPS **P1-36** and the "flags become rungs" item (RUNNING_WINNER,
> next review, max hold) from the trigger-levels session.

---

## One-line summary

`Thesis.entryPrice`, `targetPrice`, `stopLoss` and `nextReviewAt` are **columns
the agent edits independently of the trigger ladder.** They render as levels the
system appears to be watching. Nothing fires on them.

---

## The motivating failure — SNOW, 2026-08-16

A HOLDING thesis, live book, composite 9/10:

```
entry $245.67   target $360   stop $256   nextReviewAt Aug 21

resolved ladder (9 rungs):
  Review if 55 days elapsed
  Review if Bearish news ≥high urgency
  Review if Price below $320
  Review if Price above $340
  Review if Up 30% from entry
  Exit   if Gives back 3% from the high
  Review if Down 12% from entry
  Add    if Price up 7% over 1D        (account)
  Add    if Price down 7% over 1D      (account)

price levels present in the ladder: [320, 340]
stop $256 has a trigger?      NO
target $360 has a trigger?    NO
REVIEW_DATE_HIT rung present? NO
```

**The stop is decoration.** Grep confirms no enforcement path anywhere:
`stopLoss` is written by `place_trade`, displayed on the Price Targets card,
and passed into the tactical/daily prompts — and *nothing evaluates it*. SNOW's
only EXIT is the 3% trail. If the trail were removed the position would have no
floor at all while showing "$256" on screen.

How it got here: the stop was raised to $256 (above the $245.67 entry — a
gain-locking move, exactly the behavior the Game Plan wants) and the matching
rung was never written. The agent updated the *column* and not the *ladder*.

---

## Why it's structural, not a one-off

Three separate stores of the same idea:

| Idea | Stored as | Fires? |
|---|---|---|
| "exit at $256" | `Thesis.stopLoss` | ❌ only if a matching `PRICE_BELOW` EXIT rung also exists |
| "take profit at $360" | `Thesis.targetPrice` | ❌ same |
| "buy at $245.67" | `Thesis.entryPrice` | ⚠️ via the WATCHING template's ENTER rung, minted once |
| "look again on Aug 21" | `Thesis.nextReviewAt` | ⚠️ read directly by the daily run; `REVIEW_DATE_HIT` was removed from the templates 2026-05-20 |
| "exit after N days" | `Thesis.maxHoldDays` | ⚠️ via a `TIME_ELAPSED` rung, minted once |

The sync that exists is **one-way and partial**: editing a stop *pill* mirrors
onto `Thesis.stopLoss` + the open `Position` (`applyTriggerValueEdit`,
`lib/actions/thesis-edit.ts`). Nothing goes the other way, and `update_thesis`
can patch `stop_loss` without touching `triggers` at all — which is how SNOW
happened.

Related invisible-flag cases in the same family (fold in here rather than
tracking separately):

- **RUNNING_WINNER** — a pure position predicate (`progress ≥ 0.75 OR gain ≥
  12% → REVIEW`) computed per morning read, invisible on the thesis. Should be
  a rung. (`lib/agent/winner-signal.ts`)
- **UNPROTECTED_GAIN** — **stays computed, not a rung.** Its condition reads
  *the other rungs*; it is a linter on the ladder, not a rung in it. Render it
  visually distinct. (`lib/agent/ladder-health.ts`)

---

## Target model

**One store. A level exists because a rung says so.**

```
Thesis.triggers  ←  the only home for "at what price / when"
Thesis.stopLoss / targetPrice / entryPrice / nextReviewAt / maxHoldDays
                 ←  DERIVED for display + prompt context, never authored directly
```

Concretely:

| Today's column | Becomes |
|---|---|
| `stopLoss` | the canonical `EXIT + PRICE_BELOW` rung (LONG; mirrored for SHORT) |
| `targetPrice` | the canonical `(REVIEW\|EXIT) + PRICE_ABOVE` rung |
| `entryPrice` | the canonical `ENTER` rung — direction per the analyst's entry mode |
| `nextReviewAt` | a `REVIEW_DATE_HIT` rung (re-instated), or `TIME_ELAPSED` for a cadence |
| `maxHoldDays` | the `EXIT + TIME_ELAPSED` rung |
| RUNNING_WINNER | a real `REVIEW` rung at the account level |
| entry *direction* (buy the dip vs buy confirmation) | an ENTER rung at the account/analyst level — needs a predicate comparing price to the thesis's own `entryPrice`, since a dollar level can't live above the thesis. Was briefly built as an `entryTriggerMode` setting and removed 2026-08-16; see `ENTRY_TRIGGER_SEMANTICS.md`. **Do not rebuild it as a setting.** |

The columns stay as a **read model** — the Price Targets card, the chart lines,
the digest and the prompts all read them, and there is a lot of code doing so.
Deriving them on write is far cheaper than chasing every reader.

### What this unlocks

- "Review this analyst's names every day" becomes an **analyst-level rung**,
  which the cascade already supports (`lib/agent/triggers/levels.ts`). Today
  review cadence is a per-thesis date with no level above it.
- A raised stop can't silently fail to arm — raising it *is* editing the rung.
- The thesis sheet stops lying: every level on screen is something that fires.

---

## Sequencing

1. **Derive-on-write.** `update_thesis` / `place_trade` / `manage_position`
   stop accepting a bare `stop_loss` etc.; a level change writes the rung and
   the column is recomputed from the ladder in the same transaction. Add a
   Layer-1 assertion: a thesis with a `stopLoss` and no matching EXIT rung is
   refused at write.
2. **Backfill.** Every HOLDING/WATCHING thesis whose columns have no matching
   rung gets one minted from the column. **SNOW-shaped rows are the majority
   case — expect this to arm floors that are currently inert, which changes
   live behavior on the next cron tick. Principal must approve the list before
   it runs.**
3. **`nextReviewAt` → rung**, re-instating `REVIEW_DATE_HIT`. Note the 2026-05-20
   removal reason: auto-attaching it made the 5-min cron spawn a TACTICAL run
   on every overdue WATCHING thesis (28 of 35 tactical runs on 2026-05-18, zero
   state changes). Re-instate it as **REVIEW-batched to the daily run only** —
   never a tactical spawn.
4. **RUNNING_WINNER → rung.** Straightforward once 1–3 are in.

---

## Don't break

- **The one-way mirror already in `applyTriggerValueEdit`** keeps Thesis +
  Position in sync when a pill is edited. Under derive-on-write it becomes the
  *only* path, not a special case — but `Position.stopLoss` / `targetPrice` are
  read by the price monitor and must keep being written.
- **`closeReason` STOP/TARGET tagging** (`protectiveExitCloseReason`) keys off
  predicate kind. Minting new canonical rungs must preserve the mapping or the
  P1-28 cooldown exemption mis-fires.
- **`update_thesis.triggers` is wholesale-replace.** A derived column recomputed
  from a replaced array must not lose a level the agent didn't resend. Pair with
  `dropRedundantInherited` semantics already in `lib/agent/triggers/levels.ts`.
- **The standing-order ruling (2026-08-16).** A trigger fires every day its
  condition holds; a decline means "did nothing." Agents may RAISE/tighten a
  level, never LOWER or loosen one — lowering is the principal's manual act in
  the reject UI. Nothing in this rework may introduce agent-side auto-retuning.
- **Read the CLAUDE.md "RECURRING BUGS" section and `docs/PRINCIPLES.md`**
  before moving any rule between layers.

---

## Verification queries

```sql
-- SELECT ONLY. Theses whose stop has no matching EXIT rung.
select t.ticker, t."stopLoss", t.status,
       jsonb_path_query_array(t.triggers, '$[*].predicate.kind') as kinds
from "Thesis" t
where t.status in ('HOLDING','WATCHING')
  and t."stopLoss" is not null
  and not exists (
    select 1 from jsonb_array_elements(t.triggers) r
    where r->>'action' = 'EXIT'
      and r->'predicate'->>'kind' in ('PRICE_BELOW','PRICE_ABOVE')
      and (r->'predicate'->>'level')::numeric = t."stopLoss"
  );
```
