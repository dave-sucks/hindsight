# Fix Roadmap — get out of the hole

> **What this is:** the ordered, checkbox-per-item execution plan on top of
> [`GAPS.md`](../GAPS.md). GAPS holds the *detailed* diagnosis for each item; this
> file holds *what order we fix them, and how far along we are.* Opened 2026-08-13
> after ~2 weeks of scattered, colliding sessions. **If you're a fresh session:
> read this first, then the linked GAPS entry for whatever lane is next.**

## The rules that keep this from spinning out again

1. **One lane at a time.** No parallel work on the trigger/proposal subsystem —
   that is what caused every merge collision (the #495 drop, duplicate gap-filing).
2. **Each lane = one small PR** + validation evidence (show it works against the
   live DB) + tick the box here + update the GAPS entry's status.
3. **Live-money code is for principal review, never auto-merge.** Migrations are
   fine but must be called out.
4. **Never widen scope mid-lane.** New findings get filed in GAPS, not fixed inline.

## Status snapshot (2026-08-13)

- ✅ **GAPS fully documented** on main (P1-30 → P1-40 + P2 backlog).
- ✅ **#513 merged** — removed the cross-day exit suppression that was going *silent*
  on live positions (MU, CYTK). Exits surface again (~daily).
- 🔎 **Lane 1 built** — [#518](https://github.com/dave-sucks/hindsight/pull/518)
  awaiting principal review (LIVE-money code, never auto-merge). After merge:
  validate the prompt duty on a manual run before the 8 AM cron.
- ⏸️ **Everything below is unstarted.** Next up: **Lane 2**.

---

## 🔴 TIER 1 — Silent live-money bugs (do these first, in order)

These are the ones where the system quietly does the wrong thing with real money and
*tells no one*. Highest priority by far.

- [x] **Lane 1 — Finish the exit fix: trail the floor.** ([P1-39](../GAPS.md) · [`PROPOSAL_FATIGUE.md`](./PROPOSAL_FATIGUE.md))
  - #513 stopped the silence. This completes it: on a held-through floor breach, the
    morning run **trails the floor to just under the recent low** (or honors the
    principal's reject message), so alerts track a live line, not a stale one.
  - **Build:** `HELD_THROUGH_FLOOR` needsAction flag (`needs-action.ts`) → surface it
    in `get-theses.ts` (floor, held-through count, reject message, recent low) → the
    daily-run prompt duty (delicate — **validate on a manual run before the cron**).
  - **Done when:** a held-through name's floor visibly moves on the next run; alerts
    never go silent; validated on MU/CYTK against live data.
  - ✅ **Built in [#518](https://github.com/dave-sucks/hindsight/pull/518)** (2026-08-13,
    awaiting principal review). Validated by replaying MU's real ladder + declined
    proposals: 08-07 (held-through, price under $860) fires the flag; 08-13 (recovered
    to $962) correctly doesn't; systemic tombstones excluded. Post-merge: one manual
    run to validate the prompt duty before the cron.
- [ ] **Lane 2 — ENTER fires, validates, never buys.** ([P1-40](../GAPS.md))
  - Extend the narration→execution gate to the ENTER path: a validated ENTER with no
    paired `place_trade` (and no documented refusal) is a run failure. Also fix the
    `targetSizePct` < floor sizing bug (P2) that compounds it.
  - **Done when:** a fire-and-vanish ENTER trips the gate; RARE-class misses are caught.
- [ ] **Lane 3 — Shape gate vs gain-locked floor.** ([P1-36](../GAPS.md))
  - The `target > entry > stop` gate rejects a floor above cost basis, so MU's stop got
    *lowered* to satisfy it. Relax the gate for HOLDING (allow stop ≥ entry when
    gain-locked), or make trigger rungs the sole home of gain floors.
  - **Done when:** a winner's floor can sit above entry without the gate fighting it.
- [ ] **Lane 4 — Sold-name continuity.** ([P1-35](../GAPS.md) · [`SOLD_NAME_CONTINUITY.md`](./SOLD_NAME_CONTINUITY.md))
  - Protective exits go dark (no recycle) and discovery re-mints sold names blind
    (re-bought XENE at its stop price). Belief-gated recycle + same-ticker guard that
    sees recent RETIRED rows.
  - **Done when:** a stopped name can return to WATCHING with awareness of the exit; a
    re-mint chains to the sold thesis instead of minting blind.

## 🟡 TIER 2 — Waste & noise (cost + clutter, not correctness)

- [ ] **Decline-with-retune / ENTER re-fire tax.** ([P1-37](../GAPS.md)) — a declined/blocked ENTER re-fires forever (RARE reviewed 15+ days; CAPR/CEG composite-deadlock). Retune the rung or dispatch the refresh, don't silently re-arm.
- [ ] **Discovery-mint quality + executability vet.** ([P1-38](../GAPS.md) + P2) — vet minted entry/stop levels against structure so discovery can't mint chronically-true-but-unfillable rungs.

## 🟢 TIER 3 — Trust & control (so you can SEE and CONFIGURE it)

- [ ] **Trigger lifecycle visibility.** ([P1-33](../GAPS.md)) — the chain is in the DB but not on screen; per-trigger timeline + a book-level protection strip. (Depends on the `fieldChanges: {}` audit-diff fix — P2.)
- [ ] **Account / analyst standing rules + settings UI.** ([P1-31](../GAPS.md) / [P1-32](../GAPS.md)) — the editable global triggers (the safety-net layer under the agent's per-name floors).

## ⚪ TIER 4 — Deferred / housekeeping

- [ ] **Signals/news architecture rethink.** ([P1-34](../GAPS.md)) — its own dedicated design session; do not rebuild the pipeline before it.
- [ ] **Close P1-30** (gain protection — validated live, ready to move to GAPS_HISTORY).
- [ ] **P2 backlog** — `closeReason` mis-tag assertion, completion-gate churn, `fieldChanges: {}` + `PROPOSAL_*` audit lossiness, `Order→TradeDecision→Thesis` null relation, docs housekeeping, `/performance` deposit-naive, Alpaca SIP upgrade. See [`GAPS.md`](../GAPS.md) P2.

---

**Fresh-session bootstrap:** the next lane is the first unchecked Tier-1 box. Read its
GAPS entry + linked plan doc, build the one PR, validate against the live DB, tick the
box, update the GAPS status line. One lane. Then stop and hand back.
