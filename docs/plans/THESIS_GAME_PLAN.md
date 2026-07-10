# The Thesis Game Plan — conviction management through triggers

> **What this is:** the blueprint for making every thesis a *standing conditional
> playbook* the agent authors, maintains, and acts on — the way a real analyst
> manages a book. This supersedes the finish-line ordering in
> [`SCALE_INTO_WINNERS_HANDOFF.md`](./SCALE_INTO_WINNERS_HANDOFF.md) and absorbs
> GAPS **P1-30** (gain protection), the **Spine** (WS0 in
> [`SCALE_INTO_WINNERS.md`](./SCALE_INTO_WINNERS.md)), and loser-attention.
> Locked with the principal 2026-07-09. **Do not re-litigate the model.**
>
> Non-negotiables from the principal:
> - Everything lives on **Thesis triggers** (condition → action). No parallel systems.
> - Every action stays a **proposal behind the approval gate**. Never auto-fill.
>   A proposal expiring unclicked can be a *deliberate hold* (MU 7/07) — that is
>   the system working, not a bug.
> - Reviews must behave like an analyst: *"up 10% → floor comes up and a trail
>   goes on; +2% more → add; nothing changes right now"* — i.e. **reviews edit
>   the trigger ladder**, they don't just re-attest prose.

---

## 1. The motivating failure — the IONS autopsy (2026-07-09)

Bought $73.83 (2026-06-10), floor set at **$65 on day one**. Ran to $86.24
(+16.8%). Reviewed 7/07 ("no changes"), 7/08 ("no changes"), 7/09 08:04 ("no
changes"). Crashed −24% on 7/09 and fired the **day-one floor** at $64.80 —
a **loss** on a trade that was up 17%, hours after the third rubber-stamp.

Every part of the pipeline worked — cron, predicate, tactical run, proposal.
What failed is that **no level was ever re-earned**. The floor a thesis is born
with reflects entry-day information forever unless something forces an update.

**Acceptance test for this whole plan:** replay IONS under the new system.
`GAIN_FROM_ENTRY +10%` fires mid-June → checkpoint review raises the floor to
~$78–80 and arms a trail. The 7/09 crash fires the trail/floor and banks
**+8–10%** instead of −12%. If a change doesn't move us toward that replay,
it's off-plan.

## 2. The model

**A thesis = belief + target + a Game Plan.** The Game Plan is the trigger
ladder: entry rungs, abandon rung, floor, add rungs, trim rungs, damage rungs,
news rungs — each `(condition, action, rationale)`, all evaluated by the
existing 5-min cron / signal router, all landing as approval-gated proposals.

Principal's canonical example (paraphrased): *watching at $100 — enter at $115
or on a +5% day (breakout starting); abandon below $92 (window missed); we
think it reaches $180. Once held: +5% day → add 50%; reaches $140 → max add,
floor to $120; −4% day → damage check; −6% → full re-evaluate.*

Two principles:

1. **Front-load the plan.** The heavy thinking happens at thesis-write /
   entry, when the research is fresh. Daily runs audit; they are not the
   primary decision engine. Strong triggers > strong crons.
2. **The Ratchet Invariant (the IONS rule).** A holding's floor only moves
   up, and must always be justified by the gain already earned. Enforced
   three ways: **mechanically** (trailing predicates), **structurally** (gates
   that reject an unprotected-winner review), **behaviorally** (prompts).

## 3. Trigger vocabulary — complete after two additions

Existing, all cron-live for 1D/levels: `PRICE_ABOVE/BELOW` (fixed levels),
`PRICE_MOVE_PCT 1D` (day %), `SIGNAL_TYPE`/`EARNINGS_*`/`GUIDANCE_CHANGE`/
`FILING` (news), `TIME_ELAPSED`/`REVIEW_DATE_HIT` (time), `AND`/`OR`.

New in **PR-A** (both deterministic, cron-evaluable, any action):

| Predicate | Shape | Semantics |
|---|---|---|
| `GAIN_FROM_ENTRY` | `{ pct, direction: UP\|DOWN }` | Cumulative % vs position `avgCost` (LONG: `(price−avg)/avg`; SHORT inverted). UP = gain milestone ("we're up 10%" → checkpoint). DOWN = drawdown-from-entry ("down 12%" → loser attention). Fires once per milestone (long default cooldown; the acting agent replaces it with the next rung). |
| `TRAILING_FROM_HIGH` | `{ pct }` | Give-back off the position's tracked peak (`Position.peakPrice`, maintained hourly by price-monitor; LONG: `price ≤ peak×(1−pct/100)`; SHORT uses the low-water mark, inverted). The mechanical ratchet — no agent memory needed. Replaces the #458-removed `TRAILING_STOP` *deliberately*: #458 removed peak-trailing because the ask then was daily-%; this brings it back for cumulative protection alongside (not instead of) daily-%. |

Notes: `GAIN_FROM_ENTRY` and `TRAILING_FROM_HIGH` are HOLDING-only (no
position → return false, missed-trigger failure mode). Both are
DIRECT-eligible (deterministic price predicates; DIRECT stays EXIT-only).
Multi-day `PRICE_MOVE_PCT` windows (5D/30D) remain daily-run-only (no candles
on the cron) — acceptable; the new predicates cover the cumulative cases.

## 4. The three decision moments (who sets, who edits, what cadence)

### Moment 1 — Thesis build (writer / discovery / external ingest): AUTHOR
The full Game Plan is written with the research. WATCHING: ≥1 entry rung
(level and/or breakout-%), an abandon rung, target rationale. On entry (or a
HOLDING mint): floor, first add rung(s), damage rung(s), a trail or gain
checkpoint. **Gate:** a thesis without a complete plan doesn't pass (extends
the existing "WATCHING must keep ≥1 ENTER trigger" guard).

### Moment 2 — Trigger fire → tactical run (~5 min from the move): ACT + RE-LADDER
The tactical agent's job on every fire is **two things**: (1) the decision —
press / hold / take / dip-add / damage-exit — as a proposal; (2) **leave the
ladder correct for the new price**: every add raises the floor, every fired
checkpoint gets replaced by the next one, stale rungs get retuned. The
press/hold/take brain shipped in #470; the re-ladder duty is the missing half.

### Moment 3 — Daily run: AUDIT
Demoted from decision-engine to auditor. Per holding it receives a
precomputed **ladder-health block** (gain% vs floor-locked-%, distance to each
rung, days since last ladder edit) and must fix violations. **Gate:**
"Reviewed — no changes" is structurally rejected on a holding whose floor
doesn't reflect its gain (`UNPROTECTED_GAIN`) — the review either patches the
ladder or explicitly attests why not. This single gate makes another IONS
impossible.

Cadence summary: 5-min cron = all price rungs (reactivity). Tactical = act +
re-ladder within minutes. Daily = audit + strategic re-underwrite + batched
REVIEW fires. Writer dispatch = full re-underwrite when research is stale.

## 5. How the agent decides (the frames — prompt + precomputed data)

- **Gain checkpoint (`GAIN_FROM_ENTRY UP` fires):** is the thesis *stronger*
  than at entry (estimates/PTs up, catalyst confirming, structure healthy,
  next-dollar R/R ≥ ~2:1)? → **PRESS**: add (smaller rung), floor up, target
  up (belief re-attested). Intact but no new edge → **HOLD**: ratchet the
  floor only. Weakening / R-R thin / assumption broken → **TAKE**: trim/exit.
- **Day-% up:** chase check (not +>10% already today, not blow-off) →
  press-eval as above.
- **Day-% down / drawdown:** market-or-sector-wide with thesis intact →
  dip-add candidate; company-specific → damage: trim/exit, never average down.
- **Target reached:** checkpoint, not ejector seat — re-underwrite raise-vs-take.
- **Drawdown-from-entry (`GAIN_FROM_ENTRY DOWN`):** loser attention — decide
  hold-vs-cut *before* the hard stop decides for us.

## 6. The work — PR sequence

| PR | Scope | Files (primary) | Status |
|---|---|---|---|
| **A** | The two predicates end-to-end: types, Zod, evaluator (+ctx: `position.avgCost/peakPrice`, `thesis.direction`), cron piping, per-kind cooldowns, format/editable/UI labels, DIRECT-eligibility, tests | `lib/agent/triggers/{types,schema,evaluate,defaults,format,editable}.ts`, `lib/inngest/functions/trigger-evaluator.ts`, `lib/agent/triggers/live-evaluate.ts`, `components/agent/sheets/ThesisTriggersSection.tsx` | **in progress 2026-07-09** |
| **B** | Ladder-health block in `get_theses` + `UNPROTECTED_GAIN` needsAction kind (gain% − floor-locked-% > threshold) — the IONS detector, feeds daily + tactical | `lib/agent/tools/get-theses.ts`, `lib/agent/needs-action.ts`, `lib/agent/winner-signal.ts` | queued |
| **C** | **The Spine** (delicate live-prompt work): game-plan authorship in writer prompt; re-ladder duty in tactical prompt; audit framing + UNPROTECTED_GAIN gate in daily prompt; run-close gate (warn-mode first). **Validate on a manual run before the cron rides it.** | `lib/agent/system-prompt.ts`, `lib/agent/system-prompts/intraday-tactical.ts`, thesis-writer prompt, `record-run-summary.ts` gate | queued |
| **D** | Convert the 2026-07-09 hand-backfilled static floors to `TRAILING_FROM_HIGH` ratchets; analyst-level standing minimums (P1-31: "any holding +10% must carry a trail"); settings UI (P1-32) | backfill script/SQL, `lib/agent/triggers/defaults.ts`, settings UI | queued |

Sizing note (surfaced 2026-07-09): live caps are $6k/name (PEAD, Catalyst PM)
with the 2× add-ceiling → $12k/name headroom; ~$40k idle cash. Raising caps is
a principal decision, exposed in P1-32's settings work. Rung-level size hints
("add 50%", "max add") ride in trigger `rationale` prose for now; a structured
`sizeHint` field is a candidate follow-up once the loop is proven.

## 7. Interim state (already live)

2026-07-09: all 11 live holdings (IONS excluded — exit proposal was pending)
hand-backfilled with full ladders via SQL (`bf79-*` trigger ids): gain-locking
floor, add-on-breakout, trim, target-review (target = checkpoint; SNOW's
auto-exit@310 → review@305), ±day-% rungs (±4–8% by volatility), loser rungs
on MLTX (bleed-review, reclaim-review, no add). Stops mirrored to Positions;
ThesisUpdate audit rows written. This is the hand-written v1 of what PR-C
automates; PR-D upgrades its static floors to trails.

## 8. What "watch the runs" means (the validation loop)

After each morning/tactical run until PR-C lands, check:
1. Did reviews **engage** the ladder (rung edits in `fieldChanges`) or
   rubber-stamp ("no changes" on a ±% mover)?
2. Did % fires produce **ADD/press proposals** (first ever would be DELL >455,
   XENE >73, or any +5–8% day)?
3. Did any fire's handler **skip the re-ladder** (add without floor-raise)?
Findings feed PR-C's prompt wording. The IONS replay (§1) is the acceptance
test for the whole plan.
