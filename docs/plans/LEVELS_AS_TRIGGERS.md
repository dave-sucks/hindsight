# Levels as triggers — entry, target, stop and review aren't triggers, and should be

> **Daily check after this ships: `docs/prompts/CHECK_LEVELS_DAILY.md`.**
> Run it after the morning runs until it comes back clean twice.
>
> **Status 2026-08-25: L1–L6 shipped, L7–L8 mostly shipped.** The backfill
> has RUN — every level column on a live or watched thesis now fires. See
> "Where this stands" at the bottom.
>
> **Linear:** DAV-195 (umbrella), project "Levels Are Triggers".
> **Status:** diagnosed 2026-08-16 from production data; design resolved with
> the principal 2026-08-24. Everything below the diagnosis is decided.
> **Data-model change on live positions with real money** — step L6 arms
> floors that are inert today and does not run without the principal's
> sign-off on the exact list.
> **Self-contained** — you don't need the conversation that produced it.
>
> Absorbs GAPS **P1-36** and the "flags become triggers" item (RUNNING_WINNER,
> next review, max hold) from the trigger-levels session.
> **Downstream:** DAV-209 (`WATCHLIST_STATES.md`, project *Thesis Lifecycle*)
> is blocked by this. See the handoff section at the bottom.

---

## One-line summary

`Thesis.entryPrice`, `targetPrice`, `stopLoss` and `nextReviewAt` are **columns
the agent edits independently of the trigger list.** They render as levels the
system appears to be watching. Nothing fires on them.

---

## The motivating failure — SNOW, 2026-08-16

A HOLDING thesis, live book, composite 9/10:

```
entry $245.67   target $360   stop $256   nextReviewAt Aug 21

resolved trigger list (9 triggers):
  Review if 55 days elapsed
  Review if Bearish news ≥high urgency
  Review if Price below $320
  Review if Price above $340
  Review if Up 30% from entry
  Exit   if Gives back 3% from the high
  Review if Down 12% from entry
  Add    if Price up 7% over 1D        (account)
  Add    if Price down 7% over 1D      (account)

price levels present in the list: [320, 340]
stop $256 has a trigger?      NO
target $360 has a trigger?    NO
REVIEW_DATE_HIT trigger present? NO
```

**The stop is decoration.** Grep confirms no enforcement path anywhere:
`stopLoss` is written by `place_trade`, displayed on the Price Targets card,
and passed into the tactical/daily prompts — and *nothing evaluates it*. SNOW's
only EXIT is the 3% trail. If the trail were removed the position would have no
floor at all while showing "$256" on screen.

How it got here: the stop was raised to $256 (above the $245.67 entry — a
gain-locking move, exactly the behavior the Game Plan wants) and the matching
trigger was never written. The agent updated the *column* and not the *trigger list*.

---

## Why it's structural, not a one-off

Three separate stores of the same idea:

| Idea | Stored as | Fires? |
|---|---|---|
| "exit at $256" | `Thesis.stopLoss` | ❌ only if a matching `PRICE_BELOW` EXIT trigger also exists |
| "take profit at $360" | `Thesis.targetPrice` | ❌ same |
| "buy at $245.67" | `Thesis.entryPrice` | ⚠️ via the WATCHING template's ENTER trigger, minted once |
| "look again on Aug 21" | `Thesis.nextReviewAt` | ⚠️ read directly by the daily run; `REVIEW_DATE_HIT` was removed from the templates 2026-05-20 |
| "exit after N days" | `Thesis.maxHoldDays` | ⚠️ via a `TIME_ELAPSED` trigger, minted once |

The sync that exists is **one-way and partial**: editing a stop *pill* mirrors
onto `Thesis.stopLoss` + the open `Position` (`applyTriggerValueEdit`,
`lib/actions/thesis-edit.ts`). Nothing goes the other way, and `update_thesis`
can patch `stop_loss` without touching `triggers` at all — which is how SNOW
happened.

RUNNING_WINNER and UNPROTECTED_GAIN belong to the same family and are
resolved in the verdict table below rather than tracked separately.

---

## The model

A thesis holds soft opinion. A trigger says **if X happens, do Y** — buy,
sell, add, trim, or wake me up to reconsider. The agent acts when one fires.

There is no such thing as a stop, a target, or an entry price. There is a
**price level, a side, and an action**:

- "sell if it drops to $256" — price level, downside, EXIT
- "buy at $47" — price level, ENTER
- "$60 — probably take profit, maybe raise the target" — price level, upside, REVIEW

`Thesis.stopLoss` / `targetPrice` / `entryPrice` are the pre-trigger app still
sitting in the database. Every bug in this area is the app trying to keep two
stories straight.

---

## The eight things, and what happens to each

| # | Thing | Verdict |
|---|---|---|
| 1 | `Thesis.triggers` | **The system.** Everything else becomes a read of it |
| 2 | `Thesis.stopLoss` / `targetPrice` / `entryPrice` | **Computed cache.** One function owns them; nothing else may write them; a write that leaves them disagreeing with the triggers is refused |
| 3 | `Position.stopLoss` / `targetPrice` | **Dropped.** Written in 3 places, read by one line of the digest email. The price monitor stopped reading them when exits moved to triggers |
| 4 | `Thesis.nextReviewAt` + `horizon-policy.ts` | **Both die as authored things.** A review date is a trigger: *review every N days*, counted from the last actual review. Cascades like everything else. `nextReviewAt` survives only as a computed display number |
| 5 | `Thesis.maxHoldDays` | **Dropped, column and all.** It minted one "review after N days" trigger at birth and was never read again. If an analyst wants that, it authors the trigger |
| 6 | `winner-signal.ts` / RUNNING_WINNER | **Deleted, not converted.** The account already carries *review if up 10% from entry*, which fires first in every realistic case. Replaced by putting the gain number on the roster row so the agent can see movement itself |
| 7 | `ladder-health.ts` / UNPROTECTED_GAIN | **Kept.** Not a level — a check *on* the triggers ("you're up 22%, your floor locks in 4%"). Different job. Render it visually distinct |
| 8 | `Thesis.revalidationTriggers` | **Dropped.** The first attempt at triggers, from before the real one. Zero readers outside generated Prisma |

### On the calculated flags

The *purpose* was right: a stock up 200% on day 2 of a 30-day review cycle must
not be invisible. The *implementation* was a hardcoded morning calculation per
scenario. That's now covered by two things that already exist:

- **Account-level triggers** — "if anything is up X%, flag it" is one rule at
  the account, inherited by every thesis. This is the general answer, and it
  replaces the per-scenario flags.
- **The roster row the agent reads** already carries the live price next to the
  plan numbers. Adding gain % and 5-day move makes "something crazy happened
  here" visible without any flag at all.

The agent is supposed to decide what's interesting. It needs good numbers in
front of it, not a growing list of pre-computed opinions.

---

## Price Targets — how it keeps working

This is a real product surface (the card, the chart lines, the roster row) and
it does not lose anything. It stops reading columns and starts reading triggers.

### The canonical levels

Derived from the **resolved** trigger list (account → analyst → thesis, most
specific wins). Shown for LONG; inverted for SHORT.

| Card slot | Read from | Notes |
|---|---|---|
| **Entry** | the `ENTER` trigger's price | While WATCHING this is the plan. Once HOLDING it's what we actually paid (position avg cost) — a fact, not a plan |
| **Floor** | `EXIT` + price-below | The sell-at that protects. This is the one the protective ratchet guards |
| **Target** | `EXIT` or `REVIEW` + price-above | EXIT = sell here. REVIEW = reconsider here (raise the target, trim, or hold) |

**There is NOT one candidate per slot, and the Floor slot is where that
bites.** An earlier draft of this doc claimed the cascade guarantees it —
one trigger per (condition-shape, action) pair — which is true and
insufficient. A hard stop (`PRICE_BELOW`) and a trailing give-back
(`TRAILING_FROM_HIGH`) are *different* shapes, so both survive resolution and
both are floors. That is not an edge case: 5 of 8 held positions carry both
today, and after L6 all 8 will. EME right now has an inherited 8% trail at
$794.76 and a hand-set stop at $753, both breached.

**The rule: the slot shows the level that fires FIRST** — the highest floor on
a long, the lowest on a short — because that is the one that actually binds.
Everything else is drawn as its own chart line. Same rule on the target side,
inverted: the slot shows the *furthest* level, because a target is a
destination rather than a constraint, and the nearer ones are the tiers on
the way.

A trail is placed at the price it currently occupies (`peak × (1 − pct)`), so
it competes on equal terms and is labelled `trailing` to say the number
moves.

Levels beyond the canonical set — a warning REVIEW below the floor, a second
trim level — draw as extra chart lines and don't take a card slot.

### The chart

Draws **every** price-level trigger as a line labelled with what it does.
That's strictly better than today, which draws three numbers, two of which
currently fire nothing.

### Editing

A set/edit control on the card (and on the stock chart) writes the trigger, not
a column. This is a new entry point onto the write path the trigger popover
already uses — `applyTriggerValueEdit` for changing one, `applyTriggerAdd` for
minting one that doesn't exist yet. No new mechanism.

### Why the columns stay as a cache

~15 readers — digest email, prompts, roster rows, trade page, chart,
plan-sanity, ladder-health. Making each of them resolve the full cascade means
two extra queries in places that today read one number. So the columns stay,
with a hard invariant: **one function computes them, nothing else writes them,
and a write that leaves them disagreeing with the triggers is refused.** That
makes them a cache rather than a second source of truth. Deleting them
entirely is a mechanical follow-up if we want it later.

---

## Tickets, in order

| # | Ticket | What | Rough delta |
|---|---|---|---|
| ~~L1~~ | Level ⇄ trigger core | ✅ `price-levels.ts`. Also fixed a live hazard: two floors in one bucket resolved by array order, so half the time the weaker one fired | done |
| ~~L2~~ | Price Targets reads triggers | ✅ Card says what each level DOES; chart draws every level. Killed the trade page's fabricated ±10% band | done |
| **L3** | Derive-on-write | ✅ `update_thesis`, `record_thesis`. ⬜ `place_trade`, `manage_position` — **the reference shape is what `applyTriggerValueEdit` already does**: trigger + Thesis cache + Position cache + PositionEvent + audit row + source stamp, one transaction | partial |
| ~~L4~~ | Floors and targets actually fire | ✅ by L3 + L6. The 5D/30D windows were DELETED rather than built — they never had a price series and evaluated false for their whole existence | done |
| ~~L5~~ | DEMOTE | ✅ Had to land BEFORE L3's watchlist floors, or 19 names would each spawn an agent run asking to sell something never bought | done |
| ~~L6~~ | Backfill | ✅ **RAN 2026-08-25.** 44 mints / 25 theses / 25 audit rows. 0 unarmed floors, 0 unarmed targets, 0 new sells on live positions. Idempotent | done | — |
| ~~L7~~ | Reviews are one cadence trigger | ✅ Deleted `REVIEW_DATE_HIT`, the `next_review_at` arg, BOTH auto-bump blocks, three dead horizon-policy exports, the dedupe script | done |
| **L8** | Delete the duplicates | ✅ RUNNING_WINNER (−432), `maxHoldDays`, `revalidationTriggers`. ⬜ `Position.stopLoss`/`targetPrice` — **five readers, not one**; three are agent-facing (`run-input`, `get_portfolio_context`, `list_positions_all`) so they need repointing, not deleting | partial |

**Linear:** none of L1–L8 exist as issues yet. DAV-195 is the umbrella for
all of them; DAV-200 (labels on partial sales) is the only other open issue in
the project and is unaffected. DAV-193 / DAV-201 / DAV-203 are Done and their
behaviour is preserved — L3's ratchet assertion and L7's review-clock work must
not regress them.

**Order:** L1 → (L2 ∥ L3) → L4 → L5 → **L6 stop** → L7 → L8.

L4 before L6 because the backfill is what arms these on existing rows — the
firing code has to exist first. L8 last because RUNNING_WINNER can't be deleted
until targets actually fire.

Net across the whole project: roughly **−700 lines**.

---

## Rules that don't move

- **A trigger is a standing order** (ruling 2026-08-16). It fires every day its
  condition holds; a decline means "did nothing." Agents may tighten a
  protective level, never loosen or remove one. No agent-side auto-retuning.
- **Sale labelling** keys off the condition kind (`protectiveExitCloseReason`).
  New canonical levels must preserve the mapping or the cooldown exemption
  misfires.
- **`update_thesis.triggers` replaces the whole list.** A cache recomputed from
  a replaced list must not lose a level the agent didn't resend — pairs with
  `dropRedundantInherited`.
- **Don't rebuild entry direction (buy-the-dip vs buy-confirmation) as a
  setting.** Removed 2026-08-16, see `ENTRY_TRIGGER_SEMANTICS.md`. It's an
  account/analyst-level ENTER trigger.
- **Correction to the parent spec:** it lists `Position.stopLoss`/`targetPrice`
  under "Don't break — read by the price monitor." That is out of date. The
  price monitor only tracks the running high-water mark now; those columns are
  read by one line of the digest email. They're being dropped.

---

## What the watchlist work needs from this (DAV-209)

- **There are two demotions and they share a verb, not a trigger.** DAV-209
  defines demotion as *"null out entry/stop/target, keep the item and its
  triggers — a field write, not a status change."* That's a person or an agent
  setting a watch down on demand, and it stays yours. L5 is the **automatic**
  one: what the system does when a floor or target fires on something we don't
  own. Both end in the same place — the ENTER/EXIT triggers go and the cached
  columns recompute to null — so L5 ships the shared write and DAV-209 calls
  it. Under this model your "null out entry/stop/target" *is* "remove the
  ENTER and EXIT triggers"; don't write the columns directly.
- **"Active watch" is derived, not a field.** An item is actively watched iff
  it carries an ENTER trigger with a price. Don't add a status column for it.
- **A large soft-watch pool is safe.** Review cadence is a trigger whose action
  is REVIEW, and REVIEW triggers never spawn a tactical run — they log and the
  next daily run picks them up in batch. That is what makes the May 2026
  tactical-run explosion structurally impossible rather than policy-prevented,
  and it cannot be relaxed.
- **Never write a level column.** Write the trigger; the column recomputes.


---

## Where this stands (2026-08-25)

**Shipped:** L1, L2, L4, L5, L6, L7, and most of L8. Two PRs — the build, and
the deletions stacked on it.

**Left:**

1. `place_trade` and `manage_position` onto the shared write path. Match
   `applyTriggerValueEdit`; don't re-derive the shape.
2. Drop `Position.stopLoss` / `targetPrice`, after repointing the three
   agent-facing readers at the trigger-derived value.

**Two things to know before touching this again:**

- **A backfill must never delete.** Removing the 5D window left four stored
  rungs unparseable. The parser drops what it can't read — correct — but a
  script that writes the parsed list back makes that permanent. Two of the
  four were on a live position. `scripts/backfill-level-triggers.ts` now
  carries unreadable rungs through verbatim; copy that if you write another.
- **A branch's Prisma client can be ahead of production.** The first backfill
  attempt died on its first write because `update()` selects the whole row
  back and this branch knows `lastReviewedAt`, which production won't have
  until the L7 migration deploys. Nothing was written. Any script on these
  branches that writes to production has the same hazard until #554 merges.

**Not in this project, and where the money actually is:** EME and MU fired
correctly every day since 8/18 — the proposals EXPIRED or were REJECTED.
Armed levels work. This project fixed decoration. The live-money leak is
approval-side (**DAV-213**) and nobody is on it.


---

## Plain-language glossary

Written because the build used invented words in conversation and nobody
should have to decode them later. The product words are: **stocks,
watchlist, holdings, theses, triggers, analysts, runs, buy price, floor,
target.**

| What was said | What it means |
|---|---|
| DEMOTE | **Take the plan off a watchlist stock.** Remove its buy price, floor and target; keep the stock on the list; flag it for tomorrow's run to re-price or drop |
| armed | The price **does something** now. Before, it was text on a screen |
| the first tick | The next time prices are checked — every 5 minutes while the market is open |
| cadence | **How often a thesis gets reviewed** |
| the backfill | Turning the prices already written on your theses into real triggers. It invented no numbers |
| projected level | A floor that **moves** — the 8% give-back rule sits 8% under the stock's high, so its price changes as the stock rises |
| the ladder / a rung | The thesis's trigger list, and one trigger in it |

### The whole thing in six lines

- A **floor** on a stock you hold → puts a sell in your approval queue.
- A **target** on a stock you hold → flags it; tomorrow's run decides. Never auto-sells.
- A **floor or target** on a watchlist stock → takes the plan off it, keeps watching.
- A **buy price** on a watchlist stock → proposes the buy.
- **Review timing** is a trigger now: *review every N days*, from the last real review.
- Every number on the Price Targets card is one of the above. Nothing on it is decoration.

---

## Post-merge, in order

1. **Confirm the deploy actually ran.** Merging is not deploying, and this is
   the only failure with no error message: if the deploy is dropped, the
   review timing never seeds and the morning runs quietly review nothing.
   `CHECK_LEVELS_DAILY.md` check 1 is the two commands.
2. **Run the daily check after tomorrow's runs**, then daily until clean twice.
3. Expect a handful of watchlist plans to come off on day one. That is the
   KLAC/NTNX backlog clearing.

## Follow-ups, none blocking

- Review triggers carry `fireMode: "TACTICAL"` but never wake an agent — the
  evaluator defers every review to the morning run before it could. Inert but
  misleading; someone will read it and conclude the wrong thing.
- Drop `Position.stopLoss` / `targetPrice` after repointing `run-input.ts`,
  `get_portfolio_context` and `list_positions_all` at the thesis value.
- A thesis promoted between horizons keeps the review timing it was minted
  with.
- **Before DAV-196 (Signals):** a `BREAKING`-urgency signal review still wakes
  an agent immediately, bypassing the batch-to-morning rule. Dormant while
  routing is paused; with DAV-209's larger watchlist it is the one path where
  the May 2026 agent-run explosion could return.
