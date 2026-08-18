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

## Status snapshot (2026-08-17)

- ✅ **Lane 1 merged** ([#518](https://github.com/dave-sucks/hindsight/pull/518)) — triggers fire daily at the principal's line; ratchet rule; `heldThroughFloor` context.
- ✅ **Lane 2 merged** ([#523](https://github.com/dave-sucks/hindsight/pull/523)) — a fired ENTER is resolved only by buy / move-the-bar / stop-watching. **Watch the first crons** (see P1-40's status): IONS + MIRM have fired ENTERs *and* sub-floor sizing.
- ✅ **Trigger cascade merged** ([#511](https://github.com/dave-sucks/hindsight/pull/511)) — account → analyst → thesis levels as data, settings UI, archetype seeding. Closes Tier 3's P1-31/32 **pending the principal's click-through** (both prior P0s there were UI-only, invisible to tests).
- 🔎 **Lane 4a built** — belief-gated recycle, [#524](https://github.com/dave-sucks/hindsight/pull/524) (needs rebase + principal review; small additive migration).
- 📄 **Lane 3 spec written** (`LEVELS_AS_TRIGGERS.md`) — needs the principal's read before ANY code; the backfill arms floors that are currently inert.
- ⚠️ **Post-merge safety PR** (this branch) — re-aligned the daily-run prompt with the #523 gate (the prompt still taught the "transient rejection" path the gate now refuses) + docs. Merge before the next cron.

## ⚖️ Standing ruling — triggers & levels (2026-08-16, principal)

**Read before touching any trigger, level, or proposal code.** This overrides
earlier plan text in `PROPOSAL_FATIGUE.md` §5 and P1-37's "auto-retune" fix path.

1. **A trigger is a standing order. It fires every day its condition is true.**
   Decline or expiry = "I did nothing today" → it fires again tomorrow. Sell-at-$400
   alerts every day the price is under $400. Repeat alerts are the system working;
   **never engineer them away** with suppression, cooldowns, or auto-moving the line.
2. **Protective levels ratchet ONE way.** An agent may RAISE/tighten a floor (more
   protection, more alerts — the Game Plan flow stays). An agent may **never lower,
   widen, or delete** one. Lowering is the principal's manual act.
3. **The principal moves levels in the reject dialog** — reject with a note and/or
   adjust the levels inline. Already built (`ProposalActions.tsx` → editable
   `ThesisTriggersSection`); verified working on held names 2026-08-16.
4. **Agents propose; humans decide levels.** An agent that thinks a floor is wrong
   says so in its proposal rationale and suggests a number. It does not edit.

---

## 🔴 TIER 1 — Silent live-money bugs (do these first, in order)

These are the ones where the system quietly does the wrong thing with real money and
*tells no one*. Highest priority by far.

- [x] **Lane 1 — Finish the exit fix: a better ask, not a moved line.** ([P1-39](../GAPS.md) · [`PROPOSAL_FATIGUE.md`](./PROPOSAL_FATIGUE.md))
  - #513 stopped the silence (exits surface ~daily). Lane 1 completes it **under the
    standing ruling above**: the fires keep coming at the principal's line, and the
    daily ask gets *better* — which day of the breach, their own prior reject words,
    and a suggested level they can apply in one click from the reject dialog.
  - **Built:** `heldThroughFloor` context field on the `get_theses` full row
    (held-through count / reject message / recent low, from the `Order` ledger +
    daily bars) + the prompt's **ratchet rule**. No needsAction kind, no gate change,
    no agent-initiated level edits, nothing suppressed.
  - **Done when:** a held-through name's daily ask is enriched rather than identical,
    and no agent ever lowers a protective level.
  - ✅ **Built in [#518](https://github.com/dave-sucks/hindsight/pull/518)** (reworked
    to the ruling 2026-08-16). History worth knowing: the first build had the agent
    auto-trailing the floor; the principal rejected it — an agent moving your line
    down is silence with extra steps. Don't rebuild that.
  - ℹ️ **Reject-UI level editing was already built** (verified 2026-08-16) — the
    reject dialog renders an inline editable trigger section. Nothing to build.
- [x] **Lane 2 — ENTER fires, validates, never buys.** ([P1-40](../GAPS.md)) — ✅ **merged in [#523](https://github.com/dave-sucks/hindsight/pull/523)** (2026-08-17). The real mechanism (a rationale-only REVIEW satisfied the completion gate) is fixed: a fired ENTER resolves only via `place_trade`, a level change, or ARCHIVED. Prompt re-aligned in the post-merge safety PR. **Close after one clean cron cycle** — watch IONS/MIRM (fired ENTERs + sub-floor sizing; see the escalated P2 sizing item). Originally: **assigned
  to the triggers session** (it traced the real mechanism: a rationale-only REVIEW
  satisfies the gate). Separate PR, after #518 merges, rebase first. **Gate fix only** —
  no auto-level-changing behavior (the ruling above forbids it).
  - Extend the narration→execution gate to the ENTER path: a validated ENTER with no
    paired `place_trade` (and no documented refusal) is a run failure. Also fix the
    `targetSizePct` < floor sizing bug (P2) that compounds it.
  - **Done when:** a fire-and-vanish ENTER trips the gate; RARE-class misses are caught.
- [ ] **Lane 3 — Levels ARE triggers (spec first, then build).** ([P1-36](../GAPS.md) + the
  SNOW finding · `plans/LEVELS_AS_TRIGGERS.md` — **doc owed by the triggers session**)
  - The generalization of P1-36: `stopLoss` / `targetPrice` / `nextReviewAt` / maxHold are
    **parallel columns that fire nothing**. SNOW carries a $256 stop, a $360 target and an
    Aug-21 review with zero rungs behind them — decorative levels on a live name. The shape
    gate fight (MU's floor lowered 940→840 "to satisfy shape discipline") is a symptom of
    the same dual representation.
  - **Spec must answer:** which column becomes a rung, migration of live theses, who writes
    each rung, and how the shape gate behaves once rungs own levels. Data-model change on
    live money — **principal in the room before any code.**
  - **Done when:** every level on a live thesis fires something, and no level exists in two
    places. Interim guard already shipped in #518's prompt: never lower a rung for shape.
- [ ] **Lane 4 — Sold-name continuity.** ([P1-35](../GAPS.md) · [`SOLD_NAME_CONTINUITY.md`](./SOLD_NAME_CONTINUITY.md)) — **Half A built** ([#524](https://github.com/dave-sucks/hindsight/pull/524), belief-gated recycle; needs rebase + review, small additive migration). **Half B** (same-ticker guard on re-mints, `record-thesis.ts`) unblocked now that #523 merged — build after #524 lands.
  - Protective exits go dark (no recycle) and discovery re-mints sold names blind
    (re-bought XENE at its stop price). Belief-gated recycle + same-ticker guard that
    sees recent RETIRED rows.
  - **Done when:** a stopped name can return to WATCHING with awareness of the exit; a
    re-mint chains to the sold thesis instead of minting blind.

## 🟡 TIER 2 — Waste & noise (cost + clutter, not correctness)

- [ ] **ENTER re-fire tax.** ([P1-37](../GAPS.md)) — ⚠️ **needs re-scoping under the 2026-08-16 ruling.** The filed fix ("a declining tactical must retune the rung") is now **illegal** — agents don't move levels. What survives is the real waste: a blocked ENTER spawns a full GPT-5.5 tactical run every 5-min tick (CAPR ~5×, CEG 4× in two days) to reach the same blocked conclusion. Re-scope to **cheap-path the repeat** (the tactical snooze already exists — extend it) and **dispatch the refresh the agent says it needs**, without touching levels. The rung staying armed is now correct behavior, not the bug.
- [ ] **Discovery-mint quality + executability vet.** ([P1-38](../GAPS.md) + P2) — vet minted entry/stop levels against structure so discovery can't mint chronically-true-but-unfillable rungs.

## 🟢 TIER 3 — Trust & control (so you can SEE and CONFIGURE it)

- [ ] **Trigger lifecycle visibility.** ([P1-33](../GAPS.md)) — the chain is in the DB but not on screen; per-trigger timeline + a book-level protection strip. (Depends on the `fieldChanges: {}` audit-diff fix — P2.)
- [x] **Account / analyst standing rules + settings UI.** ([P1-31](../GAPS.md) / [P1-32](../GAPS.md)) — ✅ **merged in [#511](https://github.com/dave-sucks/hindsight/pull/511)** (2026-08-17): the cascade, `/settings/triggers` + analyst Triggers tab, defaults as `Account.triggers` data, archetype seeding. **Close after the principal's click-through** — nobody has seen most of it render.

## ⚪ TIER 4 — Deferred / housekeeping

- [ ] **Signals/news architecture rethink.** ([P1-34](../GAPS.md)) — its own dedicated design session; do not rebuild the pipeline before it.
- [ ] **Close P1-30** (gain protection — validated live, ready to move to GAPS_HISTORY).
- [ ] **P2 backlog** — `closeReason` mis-tag assertion, completion-gate churn, `fieldChanges: {}` + `PROPOSAL_*` audit lossiness, `Order→TradeDecision→Thesis` null relation, docs housekeeping, `/performance` deposit-naive, Alpaca SIP upgrade. See [`GAPS.md`](../GAPS.md) P2.

---

**Fresh-session bootstrap:** the next lane is the first unchecked Tier-1 box. Read its
GAPS entry + linked plan doc, build the one PR, validate against the live DB, tick the
box, update the GAPS status line. One lane. Then stop and hand back.
