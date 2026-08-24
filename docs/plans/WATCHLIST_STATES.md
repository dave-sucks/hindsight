# Watchlist states — soft vs active is derived, not a status

> **What this is:** the resolved design for how a watchlist item evolves — when
> it gets reviewed, when it stops, and what distinguishes a name you're about
> to buy from a name you're just keeping an eye on.
>
> **Status:** design, ruled by the principal 2026-08-23. One open decision
> (§7). No code yet.
>
> **Depends on:** [`LEVELS_AS_TRIGGERS.md`](./LEVELS_AS_TRIGGERS.md) — this spec
> assumes price levels and review dates are real triggers. Build that first;
> this is meaningless without it.
>
> **Supersedes** the "bench tier" framing in the first draft of DAV-209. There
> is no new tier and no new status. See §2 for why that was rejected.

---

## 1. The motivating failure

On 2026-08-23, seven watchlist items were archived by hand. All seven had rotted
in the same way — the *price levels* on them had gone stale while the item sat
on the list looking healthy:

| | What was wrong |
|---|---|
| KLAC | buy $262, stock $184 — 30% through its own stop |
| SNPS | buy $524.74, stock $397.87 — through the stop, no conviction in 98 days |
| NTNX | buy $47.12, stock $67.64 — already past its own target, never bought |
| CRWD | stop $205 sat **above** the $195 buy on a long |
| NVDA | plan numerically fine; nobody assigned a conviction in four months |
| ON / PANW | orphaned on disabled analysts, review dates months overdue |

Underneath it, a second failure. Discovery kept finding good names and had
nowhere to put them. Of 92 PASS records since June 1, **15% were rejected for
capacity or redundancy, not quality** — *"PASS only due to discovery cap —
strong re-evaluation candidate"* (TOST), *"capped out of dispatch slots"* (NVT),
*"passed as lower-conviction version of ETN's theme"* (HUBB). Only **3% were
actually off-mandate.**

Both failures are the same shape: **the system has two doors and needs three
things.**

- **Door 1 — a full thesis.** Core belief, ≥2 assumptions, ≥2 invalidation
  conditions, entry/target/stop. Expensive. Capped at 5 per discovery run.
- **Door 2 — PASS.** `record-thesis.ts:1198` states it plainly: *"terminal at
  write (status=PASSED) and lives as institutional memory only — no review
  cadence, no entry trigger, no wake-up."*

Nothing in between. So a strong-but-unslotted name gets filed in the same drawer
as one rejected for broken fundamentals, and anything that *should* be a light
watch gets forced up into the priced tier where it rots.

A comment at `record-thesis.ts:360` describes the middle door as though it
exists — *"a WATCHING thesis can be … PASS (we looked, decided no, want to keep
eyes on it for change-of-mind)"*. The code at line 1169 **rejects that exact
combination.** Someone designed this tier; the implementation forbids it.

---

## 2. Why this is not a new status

The obvious fix — add a `BENCH` status — was considered and **rejected.**

A status you set is a fact you have to keep in sync, and it can lie. We already
have proof: ETN carried a valid-looking plan with `nextReviewAt = 2027-06-14`.
Its status said one thing and its behavior said another, and nothing reconciled
them. A second status enum would give us a second thing to drift.

More fundamentally: **"active" is not a property of the stock. It's a property
of how much attention the item is consuming.** That should be *derived* from the
thing that actually consumes attention, not asserted alongside it.

**Everything on the watchlist is one concept — a watchlist item — using one set
of triggers and one status (`WATCHING`).** The rest is derived.

---

## 3. The discriminator

Not cadence. **Whether the item carries a priced plan.**

```sql
CASE
  WHEN status IN ('RETIRED','PASSED')            THEN 'archived'
  WHEN "entryPrice" IS NOT NULL
   AND "stopLoss"  IS NOT NULL                   THEN 'active'
  ELSE                                                'soft'
END
```

A plan exists iff it has **an entry and a stop** — the two fields that make it
executable, and the two that rot.

Why gate on this and not on review frequency: cadence is a knob anyone can turn,
and a plan is a fact. If "active" meant "reviewed weekly," an agent could make
forty names active by editing dates. Entry-and-stop can't be faked into
existence — either you committed to a price or you didn't.

It also produces the right failure mode for free. **A soft watch cannot go
stale, because there is nothing on it to go stale.** That isn't a rule anyone
enforces; it's a consequence of the shape.

### What each state looks like

| | **Archived** | **Soft watch** | **Active watch** |
|---|---|---|---|
| `status` | `RETIRED` (+`retiredReason`) or `PASSED` | `WATCHING` | `WATCHING` |
| `direction` | as it was | `null`, or `LONG`/`SHORT` if a view exists | `LONG` / `SHORT` — required |
| `entryPrice` | — | **null** | **required** |
| `stopLoss` | — | **null** | **required** |
| `targetPrice` | — | null | required |
| `coreBelief` | — | optional, one line | **required** |
| `keyAssumptions` | — | optional | **required, ≥2** |
| `invalidationConds` | — | optional | **required, ≥2** |
| `conviction` | — | optional | **required** |
| `nextReviewAt` | ignored | far out (30–90d), or null if a level covers it | **required, ≤30d** |
| `closedAt` | set | null | null |
| Triggers evaluated? | **no** | yes | yes |
| Trigger actions allowed | — | `REVIEW` only | `REVIEW`, `ENTER` |
| Daily review cost | zero | zero | one review slot |

---

## 4. Trigger actions gate on fields — the pattern already exists

`ENTER` requires an entry price. That isn't policy, it's arithmetic — there's no
level to fire at without one.

This is the established pattern in the codebase, not a new idea.
`trigger-evaluator.ts:641`: `GAIN_FROM_ENTRY` and `TRAILING_FROM_HIGH` need an
entry cost and a water mark, and *"absent (WATCHING) → they return false."*
Predicate availability already follows field presence. Gating `ENTER` on
`entryPrice` applies the same rule one step earlier.

**Soft watch** — every trigger has action `REVIEW`:
- `PRICE_LEVEL` — "review if it hits $540"
- `REVIEW_AT` — "review monthly"
- `EVENT` — "review on the next earnings date"

**Active watch** — the above, plus `ENTER` at the entry price. Protective rungs
(`GAIN_FROM_ENTRY`, `TRAILING_FROM_HIGH`) stay dormant until the name is held,
exactly as they do today.

---

## 5. Transitions — four moves, none of them a delete

| Move | What changes | When |
|---|---|---|
| **Promote** soft → active | Write entry/stop/target, core belief, assumptions, invalidations, conviction. Set review ≤30d | A review fires and the answer is "yes, price this" |
| **Demote** active → soft | **Null out entry/stop/target.** Keep the item, the triggers, the history | Plan falsified, or 30 days unacted |
| **Archive** either → off-list | `status = RETIRED`, `retiredReason`, `closedAt` | No longer want it in the universe |
| **Revive** archived → soft | New `WATCHING` row | Something changed |

**Demotion is the move that doesn't exist today** — a watch name can currently
only be promoted (bought) or killed (archived), never set down. Note that it's a
field write, not a status change, which is what makes it cheap enough to
actually happen.

It also re-explains the 08-23 cleanup correctly, and differently for each name:

- **KLAC** — plan falsified. Correct move was **demote**, not archive. Clear the
  levels, keep watching. We were harsher than the model requires.
- **NVDA** — carried a plan nobody believed for four months. **Demote** long ago.
- **ETN** — plan is fine; the review date is unreachable. **Not a state problem
  at all.** Fix the trigger.

Three names, three different failures. "Archive the stale stuff" treated them
identically. This model tells them apart.

---

## 6. The two invariants

Everything hangs off these. Neither is a status.

1. **Every `WATCHING` item has at least one *reachable* wake condition.** Either
   a `nextReviewAt` inside a sane horizon, or a price level the stock could
   plausibly reach from here. Zero wake conditions = invisible = rot. This is
   what ETN (review in 2027) and NVDA (four months ungraded) violated.

   *Reachable* matters as much as *present*: KLAC's stop at $225 with the stock
   at $184 is a trigger that already fired and can never fire again in the
   direction that counts.

2. **If `entryPrice` is set, `nextReviewAt` must be ≤30 days.** A priced plan is
   always watched. To stop watching it, demote it first. This makes the ETN
   failure mode *unrepresentable* rather than merely detectable.

---

## 7. Open decision — the principal rules

**A soft watch with a plan attached but no near-term wake.** You priced it, then
set the review a quarter out. Under the §3 rule it reads as soft (no near wake),
but it still carries levels that can rot and nothing looks at them for three
months.

- **Option A — forbid it.** Levels require a wake inside 30 days; a plan is
  always watched. *(Recommended — it's the ETN failure with a different date,
  and an invariant is easier to enforce than a drift is to detect.)*
- **Option B — allow it**, and let plan-sanity (DAV-188) catch the drift when it
  eventually wakes.

Invariant 2 above assumes Option A. If Option B is chosen, drop it.

---

## 8. Where the cap goes

Today the cap counts **mints** — `DISPATCH_CAP = 5` in
`lib/agent/system-prompts/discovery.ts:46`, hard-enforced at the tool layer.
That's why good candidates hit a wall and fall into a terminal PASS.

**Do not raise it.** Five *priced plans* per run is already at the edge of what
gets maintained; raising it to 20 produces 20 rotting plans faster.

Move it to the scarce resource — **review attention.** Cap the number of items
per analyst with a wake inside 7 days. Then an agent that runs out doesn't
discard the name; it writes a soft watch with a price trigger. The sentence
changes from *"I'm out of slots, PASS"* to *"I'm out of review budget, so this
goes on the list with a wake at $540."* That's a budget an agent can reason
about honestly, and it caps what costs money rather than what costs nothing.

**Target shape:** active watches ≈ 2× position slots (PEAD 8–12, Compounder 8 —
it was carrying 18, or 4.5×). Soft watches 20–40, cost nothing.

---

## 9. What changes in code

**Already works — don't rebuild:**
- `RETIRED`/`PASSED` are excluded from trigger evaluation (the evaluator filters
  to `HOLDING`/`WATCHING`).
- `WATCHING` items are already evaluated and already carry promotion triggers.
- Disabled analysts already can't fire triggers (`trigger-evaluator.ts:530`).
- `nextReviewAt` and horizon-derived defaults exist.
- The "stopped watching" memory record ships in #549.

**Needs changing — all in [`record-thesis.ts`](../../lib/agent/tools/record-thesis.ts):**

1. `direction: z.enum(["LONG","SHORT","PASS"])` (line 67) has no unpriced
   option — **agents literally cannot mint a soft watch today.** Add the path.
2. The structural-belief gate (core belief + ≥2 assumptions + ≥2 invalidations)
   must apply only when entry/stop are present, not to every `LONG`/`SHORT`.
3. The rejection at line 1169 blocking PASS + `WATCHING` goes away — that
   combination becomes the ordinary soft watch.
4. `DISPATCH_CAP` moves from counting mints to counting items with a wake inside
   7 days. Soft watches stop consuming it.

**Sequencing:** the PASS reason code (§10) ships first and independently. The
rest waits on `LEVELS_AS_TRIGGERS.md` being built.

---

## 10. Ship the PASS reason code first

Independent of everything above, and nearly free: **record *why* a PASS
happened** — capacity, redundancy, entry quality, fundamentals, off-mandate.

Right now all five collapse into one record. It sharpens the #549 memory layer
immediately: *"you passed on TOST because you were out of slots"* is a
completely different message to a future agent than *"you passed on ACN because
the structure is broken."* Today they render identically.

It also makes the §8 cap change measurable — you can count how many names are
being lost to capacity before you decide what the review budget should be.

---

## 11. How you'd tell them apart in the UI

Active watches show a price line: entry, stop, target, distance to entry. Soft
watches show a reason and one wake condition.

**If a row has no numbers on it, it costs you nothing today.** Same tell in the
UI, in the queries, and in what the agent sees.
