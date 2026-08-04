# Proposal fatigue — the exit queue re-asks forever

> **What this is:** the definitive, code-traced diagnosis of the re-proposal loop.
> **150 of 210 exit proposals (71%) were never approved**, and the system keeps
> re-generating the same exits — MU alone **49 times across 22 days over 3+
> months**. Two separate sessions measured it from outcome data (2026-08-03); this
> doc adds the piece they flagged as missing — **tracing the actual suppression
> gate** — which changes the fix. Companion to GAPS **P1-39**. Subsumes the ex-P2
> "hold + retune affordance" and "narrow the P1-28 carve-out" items.
>
> **The one thing to get right:** the principal *intentionally* lets some
> proposals expire — that is a deliberate hold, **not** the bug. The bug is the
> system re-asking, ignoring that hold.

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

## 5. The fix — two layers, designed around the principal's behavior

1. **Gate:** narrow the carve-out from "STOP/TARGET always flows" to **"flows only
   on a genuine price re-cross."** A protective level held through — by reject *or*
   expiry — should dampen exactly like a discretionary close, **unless price
   materially re-crossed the level.** That re-cross case is #490's real intent
   (re-arm a gain-lock when price crosses back through), *not* "re-ask every day
   while price sits below." This is the piece that makes the system honor the
   expiry-as-hold signal for protective exits too.
2. **Agent:** extend `list_proposals` to the daily-run + tactical allowlist so the
   agent sees "already pending on MU, declined 2× recently" and doesn't re-propose.

Both are needed: layer 1 stops the mechanical re-fire; layer 2 stops the agent
re-deriving the intent in the first place.

## 6. Acceptance test

Replay MU: held through the floor three mornings running (expiries). Under the fix,
the protective exit **dampens** — no re-ask — until price genuinely re-crosses the
level or the thesis materially changes; and the daily-run agent, seeing the
pending/declined history, does not re-derive the exit. MU's 49-proposal / 22-day
tail collapses to ~one proposal per genuine re-cross. If a change doesn't move
toward that, it's off-plan.

## 7. Open questions

1. Where does `unapprovedExitCount` read from — `Order` or `ThesisUpdate`? If the
   latter, it undercounts at 22% coverage, so the agent's own fatigue signal is
   wrong (fix the fail-soft `PROPOSAL_*` write, or read from `Order`).
2. What defines "materially re-crossed" — a full cross above then back below? A %
   beyond the level? Tie it to the level's own predicate.
3. Sequence: layer 1 (gate) is the cheap high-value fix and can ship first; layer 2
   (agent queue visibility) is the durable half. Ship 1, measure, then 2.
