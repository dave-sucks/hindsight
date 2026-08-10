# Proposal fatigue — the exit queue re-asks forever

> **What this is:** the definitive, code-traced diagnosis of the re-proposal loop.
> **150 of 210 exit proposals (71%) were never approved**, and the system keeps
> re-generating the same exits — MU alone **49 times across 22 days over 3+
> months**. Two separate sessions measured it from outcome data (2026-08-03); this
> doc adds the piece they flagged as missing — **tracing the actual suppression
> gate** — which changes the fix. Companion to GAPS **P1-39**. Subsumes the ex-P2
> "hold + retune affordance" and "narrow the P1-28 carve-out" items.
>
> **The one thing to get right (corrected 2026-08-04 with the principal):** the
> principal *intentionally* lets some proposals expire — that is a deliberate
> hold, **not** the bug. And the fix is **NOT to suppress alerts** — going quiet
> on a stop is unacceptable ("what if it collapses to $3.00 next week"). The bug
> is that **nothing reviews a decline and re-draws the floor**, so the same stale
> line pings forever. The cure is the floor *moving*, never the system going
> silent. An earlier suppression-based fix (PR #504) was **closed as the wrong
> lever** — see §5.

---

## 0. The evidence (measured, live DB — 2026-08-03)

- **210 exit proposals ever created; 150 (71%) never approved.**
- Per-name re-proposal (intent ∈ CLOSE/PARTIAL_CLOSE):

  | sym | proposals | rejected | expired | filled | days | span |
  |---|---|---|---|---|---|---|
  | MU | 49 | 35 | 9 | 4 | 22 | 04-27 → 08-03 |
  | NVDA | 33 | 19 | 10 | 4 | 6 | 04-30 → 06-04 |
  | ZETA | 9 | 4 | 5 | 0 | 7 | 07-14 → 07-28 |
  | SNOW | 8 | 2 | 4 | 1 | 8 | 05-28 → 08-03 |
  | MNKD | 7 | 3 | 3 | 0 | 6 | 07-22 → 08-03 |

- Two shapes: **cross-day re-proposal** (MU, 22 days) + **same-day bursts**.
- Audit lossiness: `ThesisUpdate PROPOSAL_REJECTED` rows = 20 vs 90 actual Orders
  (**22% coverage**); `PROPOSAL_EXPIRED` 55 vs 78 (71%).
- Caveats (from the measuring sessions, kept honest): MU/NVDA history predates the
  2026-05-27 analyst-config cutover — some early volume is legacy-era. The clean
  signal is the **July/Aug tail** (ZETA/MNKD/SNOW/EWTX/XENE). Counts are
  CLOSE/PARTIAL_CLOSE only; buys/adds not analyzed.

## 1. What is NOT the bug — the principal's intentional expiries

Letting a proposal lapse **is** the hold signal (the MU-2026-07-07 non-negotiable:
an expiring proposal can be a deliberate hold, and that's the system working). The
design already agrees: the P1-28 cooldown arms off `EXPIRED` **as well as**
`REJECTED`, precisely because the principal mostly ignores-to-expiry rather than
clicking reject. The failure is that this hold signal is **ignored for exactly the
names that re-propose.**

## 2. The root cause — traced in code, not inferred

The suppression gate ([`lib/proposals/maybe-await-approval.ts`](../../lib/proposals/maybe-await-approval.ts))
keys entirely on `positionId` and carries a deliberate carve-out (line ~289):

```
isRiskExit = closeSource === 'price_monitor'
          || closeReason === 'STOP'
          || closeReason === 'TARGET'
if (!isRiskExit) { ...cross-day cooldown... }   // risk exits skip the cooldown
```

Its own comment justifies it: *"the spammy proposals are all closeReason/closeSource
null; genuine stops/targets carry STOP/TARGET tags, so this split is correct."*

**That assumption was true — and the Game Plan broke it.** Pre-#480, protective
exits were rare, so "STOP/TARGET always flows" was safe. Post-#480, **every holding
carries a protective floor/trail**, so nearly every exit is STOP-tagged — and the
carve-out now leaks the *entire protective-exit stream* past the cooldown, ignoring
rejections and expiries alike. MU is asked 49 times because the gate is explicitly
told never to dampen it. **The gate is working exactly as written; the world it was
written for changed.**

## 3. Refuted / secondary hypotheses (from the outcome-only diagnosis)

- **`Order → TradeDecision → Thesis` is null on held names → breaks dedup.** Real
  relation bug (the relation carries `thesisId` only on the original open; later
  HOLD decisions write `thesisId: null`), but the suppression gate keys on
  `positionId`, **never on that relation** — so it is **not** the fatigue cause.
  It IS real for audit and any consumer that walks it. Filed separately (GAPS P2).
- **Same-day dedup "isn't holding".** Mostly by-design: the #379 fold only applies
  while a prior close is `AWAITING_APPROVAL`; once one resolves, a fresh fire
  legitimately makes a new proposal. There's a known same-tick race (a partial
  unique index on `(positionId) WHERE intent='CLOSE' AND status='AWAITING_APPROVAL'`
  would close it), but it is minor, not the driver.
- **Audit lossiness (REJECTED 22%).** The `PROPOSAL_*` `ThesisUpdate` writes are
  fail-soft (try/catch + `console.warn`). The gate reads from `Order`, not
  `ThesisUpdate`, so this does **not** cause the loop — but any consumer that
  trusts `ThesisUpdate` for rejection history is reading a badly incomplete
  picture. Same family as the `fieldChanges: {}` audit bug.

## 4. The durable root cause

The daily-run / tactical agent has **no read path to its own pending queue.** It
gets `unapprovedExitCount` (a count) on `get_theses`, not the queue — so every run
it re-derives the exit from scratch. A perfect gate only tombstones the duplicate
*Order*; the agent keeps generating the *intent*. `list_proposals` (#502) exists
but is **principal-chat only.**

## 5. The fix — the floor MOVES; alerts never stop (corrected 2026-08-04)

> **Rejected approach (PR #504, closed):** narrowing the gate so a held-through
> protective exit goes quiet unless the breach "materially worsened." That is
> still *silence* on a stop, and the principal ruled it out hard: the system must
> never stop alerting on a floor breach — a name can collapse the next day. The
> gate is **not** where this is fixed.

The cure is analyst behavior: watch the stop hold, then **re-draw it lower** — so
the alert stops repeating at a *stale* line and only re-fires on a *new* one. The
alert channel is left alone; what changes is that a decline now *lands* as a review.
The principal's three cases (§ below) all reduce to one rule: **a decline (reject
or expiry) is not "go away" — it's "review this and adjust the plan."**

Three run-side pieces (no gate change, no suppression, no migration):

1. **Signal — `HELD_THROUGH_FLOOR` needsAction** (`lib/agent/needs-action.ts`):
   fires on a HOLDING when a protective (STOP) proposal was declined/expired
   recently AND price is still under the floor. Carries the floor level, the
   held-through count, the principal's reject message (if any), and the recent low.
2. **Surface it** (`lib/agent/tools/get-theses.ts`): compute the recent
   declined/expired protective closes per position (from `Order`) + the recent low,
   and feed them into the flag so the morning run sees the full picture.
3. **Duty (prompt)** (`lib/agent/system-prompt.ts`, delicate — validate on a manual
   run first): for any `HELD_THROUGH_FLOOR` holding the run **must** either
   **move the floor** — default: to just under the recent low (a normal
   `update_thesis` trigger edit); the principal's reject message overrides the
   target — **or** explicitly re-underwrite why the line stays, which itself names
   the next level. It may **never** leave the floor unchanged.

**What the principal wanted, mapped:**
- *Floor hits at open, +6% by 9:45* → each genuine re-hit still alerts (gate
  untouched; #490 re-cross already handles intraday). ✅
- *Reject: "hold, but re-propose if it drops more"* → the message rides into the
  next run as the `HELD_THROUGH_FLOOR` context; the run edits the trigger to match. ✅
- *Stare, it drops, you forget* → you still get the daily reminder (gate untouched)
  AND the run trails the floor down so it's not the same stale ping. ✅ Never silent.

## 6. Acceptance test

Replay MU: floor at $860, held through three mornings (expiries). Under the fix the
daily alerts keep coming (never silent), and the **morning run trails the floor**
down toward the recent low each morning it's held through — so within a couple of
runs the alerts track a live line instead of pinging $860 forever. If the name then
breaks the new lower floor, that's a fresh, meaningful alert. The 49-proposals /
22-days pattern ends because the *line moved*, not because anything went quiet. If
a change reduces alerts by suppression rather than by moving the floor, it's off-plan.

## 7. Open questions / follow-ons

1. **"Recent low" window** — since the position opened? Trailing N days? Start with
   "lowest low since the last floor edit" and tune.
2. **Agent queue visibility (the durable follow-on).** Even with the floor moving,
   the daily-run/tactical agent still has no read path to its own pending queue
   (only `unapprovedExitCount`, a count). Extending `list_proposals` (#502) to the
   daily-run allowlist lets it *see* "already pending, declined 2×" and reason about
   it directly. Not required for the floor-trail fix, but the natural next layer.
3. **Audit lossiness** (`PROPOSAL_*` 22% coverage, the `fieldChanges: {}` bug) still
   applies — tracked in GAPS P2; fix so `unapprovedExitCount` and the held-through
   count read a complete picture.
