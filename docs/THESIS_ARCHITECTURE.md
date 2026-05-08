# Hindsight — Thesis Architecture

> **What this is:** the live reference for how the thesis system works. Sourced from the 2026-05-08 architecture pass that landed in [#239](https://github.com/dave-sucks/hindsight/pull/239). Update this doc whenever a thesis-system component changes. For target state, read [`VISION.md`](./VISION.md). For known gaps, read [`GAPS.md`](./GAPS.md).
>
> **Last verified:** 2026-05-08

---

## 1. What a thesis is

> **A thesis is the analyst's durable, structured belief about a single ticker** — what's true, what must remain true, what would prove it wrong, and what we'll do about it.

It's the load-bearing object in the system: the unit the trigger evaluator fires against, the unit the daily run reviews, the unit the trade evaluator grades, and the only thing that explains why a Position is being held.

Distinct from the supporting cast:

- **Position** — what we OWN (qty, avgCost, P&L). A consequence of an ACTIVE thesis. A thesis can exist without a position (WATCHING) but a position should never exist without a thesis.
- **Signal** — a normalized piece of evidence from the world. Theses cite signals (`sourceSignalIds`); signals don't own theses. One thesis cites many signals over time via the `ThesisUpdate` activity log.
- **Watchlist entry** — historically a separate `AnalystWatchlistItem` row. Today it's also a `Thesis(status=WATCHING)` row. The two-store coexistence is a known transitional pattern; the durable model is the Thesis.

**Cardinality rule:** at most one ACTIVE-or-WATCHING thesis per (analyst, ticker, direction). Direction flips create a new row with the parent SUPERSEDED. INVALIDATED/CLOSED/SUPERSEDED rows are immutable history.

---

## 2. The four-part contract

Every thesis lives inside a four-part contract. Doesn't matter if it's a 5-minute scalp or a 5-year compounder — the same four sections exist, just with different shapes.

1. **WATCH** — why this ticker is on the radar. What we're waiting for. The IF.
2. **ENTER** — what specifically would make us buy/short. At what level. In what size. The THEN.
3. **HOLD** — the premise. Why we keep holding. What we tolerate (noise) vs react to (real change). How often we look.
4. **EXIT** — what closes the position. Price level / time / event / broken belief.

In the code, these four parts are encoded across **structured triggers** (the actionable predicates) plus **structural belief fields** (the durable claim) plus **horizon** (the discriminator that gives every other field its shape). Triggers are the implementation primitive; the four-part contract is the conceptual frame for reading the system.

---

## 3. Lifecycle

```
                       record_thesis
                            │
              ┌─────────────┴────────────┐
              ▼                          ▼
        ┌──────────┐              ┌────────┐
        │ WATCHING │              │ ACTIVE │
        │  • LONG  │              └────────┘
        │  • SHORT │                  ▲ │
        │  • PASS  │                  │ │ update_thesis (refine)
        └──────────┘                  │ ▼
              │                  same row
              │
              │ update_thesis(change_status: "ACTIVE",
              │                target_price, stop_loss)
              │ + place_trade
              └────────────────────────────► ACTIVE

  any active state  ─update_thesis(change_status: INVALIDATED)─►  INVALIDATED
  any active state  ─update_thesis(change_status: CLOSED)──────►  CLOSED
  active            ─record_thesis(direction flip, parent_id)──►  SUPERSEDED
```

Per-transition contracts:

| From → To | Trigger | What changes | Gates |
|---|---|---|---|
| (none) → ACTIVE | `record_thesis(status=ACTIVE)` | Identity + belief + operational state + triggers all set | shape, belief, provenance, no-PASS-on-held, researched-before, ROUTED_SIGNAL validation, ENTER-trigger guard, conditional requireds |
| (none) → WATCHING | `record_thesis(status=WATCHING)` OR `manage_watchlist ADD` | Same as ACTIVE; direction can be PASS | Same gates; ENTER-trigger required for LONG/SHORT |
| Refine ACTIVE / WATCHING | `update_thesis` with patch fields | Only what the agent passes | zero-trigger, goalpost-move, shape, structural-unchanged-reason |
| "Reviewed" no-op | `update_thesis` with rationale only | Nothing | zero-trigger blocks on broken theses |
| WATCHING → ACTIVE (PROMOTION) | `update_thesis(change_status: "ACTIVE", target_price, stop_loss)` paired with `place_trade` | Status flips, target/stop recomputed | Existing must be WATCHING; both new levels required |
| Any → INVALIDATED | `update_thesis(change_status: "INVALIDATED")` | Status, invalidatedAt, invalidReason | Belief fields freeze |
| Any → CLOSED | `update_thesis(change_status: "CLOSED")` (after `close_position`) | Status, closedAt, closeReason | Belief fields freeze |
| Active → SUPERSEDED | `record_thesis(parent_thesis_id, direction flipped)` | Parent goes SUPERSEDED (or INVALIDATED on PASS) | Direction-flip branch |

The **promotion path** (WATCHING → ACTIVE) is new in #239. Pre-this-PR there was no schema-legal way to flip a WATCHING thesis to ACTIVE at the same row — the tactical prompt instructed `update_thesis(change_status: "ACTIVE")` but the enum rejected it. Theses stayed WATCHING with open positions.

---

## 4. The horizons

Every thesis carries `horizon` — the discriminator that gives every other field its shape. Four values:

| Horizon | What it is | Hold | Default review cadence | Exit policy |
|---|---|---|---|---|
| **CATALYST** | Trade built around a binary event (FDA decision, M&A close, named earnings, court ruling) | Days around event | Daily | Hold to event resolution OR 30d past `catalystDate` |
| **TRADE** | Momentum/pattern setup with a tight stop | Days-to-weeks, bounded by `maxHoldDays` | Daily | Stop, target, or maxHoldDays — whichever fires first |
| **TARGET** | Swing trade with a defined upside number | Weeks-to-months | Weekly | Stop, target, or thesis invalidation. No time stop. |
| **COMPOUNDER** | Long-term hold based on durable business quality | Months-to-years | Quarterly | Broken thesis only. Ignore intra-quarter noise. |

**Where DAY fits:** there's no `DAY` horizon enum value today. Intraday Momentum Scalper uses `horizon=TRADE` + the EOD-flatten cron for the no-overnight rule. This is intentional — adding a first-class DAY horizon is non-trivial and the composition works. Revisit only if intraday becomes a bigger surface.

The constants live in [`lib/agent/horizon-policy.ts`](../lib/agent/horizon-policy.ts) — `HORIZON_REVIEW_DAYS`, `HORIZON_REVIEW_CADENCE`, `HORIZON_EXIT_POLICY`. `record_thesis` imports the day constants for `nextReviewAt` math; the daily-run prompt imports the cadence + policy strings for per-thesis hint rendering. Writer and reader stay aligned.

---

## 5. Per-horizon shape (the matrix)

The horizon doesn't just label the trade — it constrains the shape of every other field. Concrete cells:

### CATALYST/WATCHING/LONG (biotech-event scenario)
- `catalyst_date` REQUIRED
- `target_price` = pre-event accumulation level (the ENTER trigger threshold)
- `stop_loss` = invalidation level
- Default triggers: PRICE_ABOVE(target) → ENTER (cd=1), OR(8-K, 10-Q, 10-K) → REVIEW (cd=1), EARNINGS_BEAT/MISS → REVIEW (cd=7), 14d hygiene
- `key_assumptions` must include something falsifiable about the event
- `invalidation_conditions` must include "event canceled / event already played"

### CATALYST/ACTIVE/LONG
- ENTER fired and the agent promoted
- Triggers: PRICE_BELOW(stop) → EXIT (cd=0); OR(filings) → REVIEW; "30d past catalystDate" exit (today via prompt; price-monitor enforcement still open — see GAPS P0-5b)

### TRADE/ACTIVE/LONG (swing breakout)
- `max_hold_days` REQUIRED (no default; agent declares the window)
- Triggers: PRICE_BELOW(stop) → EXIT (cd=0), PRICE_ABOVE(target) → EXIT (cd=0), TIME_ELAPSED(maxHoldDays) → REVIEW
- `core_belief` is setup-specific ("$NVDA breaks $185 base on volume")

### TARGET/ACTIVE/LONG (the 6-month / +150% / -5% anchor)
- `target_price` = entry × 2.5; `stop_loss` = entry × 0.95
- Triggers: PRICE_BELOW(stop) → EXIT (cd=0), PRICE_ABOVE(target) → REVIEW, EARNINGS_BEAT/MISS → REVIEW (cd=7), 30d hygiene
- `max_hold_days` not set (TARGET is open-ended)
- Per-horizon alert thresholds (looser than TRADE) — design specified in `horizon-policy.ts` constants; **runtime enforcement still open in price-monitor / trade-exit (GAPS P0-5b/c)**

### TARGET/WATCHING/SHORT
- ENTER trigger is PRICE_BELOW(target) — mirror of LONG
- Note: support-REVIEW path is LONG-only today; SHORT mirror remains a known gap (GAPS P2-x)

### COMPOUNDER/ACTIVE/LONG (megacap secular)
- Wider stop (-15% to -20%)
- `key_assumptions` are secular drivers (capex, demand, regulatory, moat)
- `invalidation_conditions` are structural breaks (regulatory, business-model, CFO departure, two consecutive guidance cuts)
- 90d hygiene cadence
- Per-horizon alert thresholds (looser still) — see same caveat as TARGET

### COMPOUNDER/WATCHING/LONG
- ENTER trigger uses 7d cooldown (patient — short-term spikes through the breakout level are noise on a multi-year hold)

### TARGET/WATCHING/PASS (institutional memory)
- `target_price` = the level that, if hit, would invert the original rejection
- ENTER triggers don't apply (PASS isn't entry-gated); REVIEW triggers fire when the price hits the dismissed level or earnings flip an assumption
- `invalidation_conditions` double as flip-criteria: if any flip the other way, the agent mints a new directional thesis and this PASS goes SUPERSEDED

---

## 6. Fields

The Thesis row has three logical sections: **durable belief**, **operational state**, **provenance**. The split matters because each section has a different write discipline.

### Durable belief — set at create, refined rarely

| Field | Required | Notes |
|---|---|---|
| `coreBelief` | LONG/SHORT | ONE sentence stating WHAT will happen and why. The load-bearing claim. Distinct from `reasoningSummary` (current-state framing, refreshed often). |
| `keyAssumptions` | LONG/SHORT (≥2) | Falsifiable premises that must remain true. Generic prose insufficient. |
| `invalidationConds` | LONG/SHORT (≥2) | Concrete things that would prove the belief wrong. Generic risks insufficient. On PASS theses, double as flip-criteria. |

The **structural-belief gate** (`record_thesis`) and the **structural-unchanged-reason gate** (`update_thesis`) enforce the discipline. Substantive non-belief patches without touching at least one belief field are rejected unless `structural_unchanged_reason` is supplied.

### Operational state — mutated freely

| Field | Notes |
|---|---|
| `horizon` | NOT NULL by convention; CATALYST/TRADE/TARGET/COMPOUNDER. |
| `entryPrice`, `targetPrice`, `stopLoss` | Required for LONG/SHORT. Validated via [`thesis-shape.ts`](../lib/agent/thesis-shape.ts) (LONG: target > entry > stop). |
| `confidenceScore` | 0-100. Calibration tracking. |
| `triggers` | JSONB array of structured predicates. See [`triggers/types.ts`](../lib/agent/triggers/types.ts). Auto-merged with horizon defaults from [`triggers/defaults.ts`](../lib/agent/triggers/defaults.ts). |
| `catalystDate` | REQUIRED when `horizon=CATALYST`. |
| `maxHoldDays` | REQUIRED when `horizon=TRADE` (no silent default). |
| `nextReviewAt` | Derived from horizon if not supplied. Drives the overdue-review cron + `REVIEW_DATE_HIT` trigger. |
| `targetSizePct`, `scalingPlan` | Optional. Position sizing intent + scale-in/out ladder. |

### Provenance

| Field | Notes |
|---|---|
| `sourceKind` | ROUTED_SIGNAL / WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW. |
| `sourceSignalIds` | When `sourceKind=ROUTED_SIGNAL`, must be non-empty AND every ID must come from this analyst's routed inbox today (validated against `AnalystSignalRoute`). Drives the Monitor ROI tracer. |
| `sourceRationale` | Required for non-ROUTED_SIGNAL kinds. |

### Lifecycle bookkeeping

`status`, `parentThesisId`, `invalidatedAt`/`invalidReason`, `closedAt`/`closeReason`, `createdAt`/`updatedAt` — standard.

### Activity log — `ThesisUpdate`

One row per state change. Type: CREATED / UPDATED / TRIGGER_FIRED / REVIEWED / ACTED / INVALIDATED / CLOSED / SUPERSEDED / STATUS_CHANGED. Carries `fieldChanges` diff, `priceAtTime`, `positionAtTime`, `triggerId`, `signalIds`, `runId`, `tradeId`. The activity log IS the thesis chain — `parentThesisId` exists only for direction flips.

---

## 7. Producers + gates

### `record_thesis` — mints new theses

Required: ticker, direction, horizon, confidence_score, reasoning_summary, thesis_bullets, risk_flags, signal_types. Plus:
- LONG/SHORT: entry/target/stop satisfying shape, **core_belief, ≥2 key_assumptions, ≥2 invalidation_conditions**, provenance
- horizon=CATALYST: **catalyst_date**
- horizon=TRADE: **explicit max_hold_days**

Gates: shape, **belief**, provenance, no-PASS-on-held, researched-before, ROUTED_SIGNAL validation, same-direction reject (redirects to update_thesis), DAY-only cross-analyst overlap, ENTER-trigger guard, **CATALYST-needs-catalystDate**, **TRADE-needs-maxHoldDays**.

### `update_thesis` — patches existing theses

Required: thesis_id, rationale (≥10 chars). Optional: any field on the row, plus `change_status` (ACTIVE / INVALIDATED / CLOSED), `triggers` (wholesale replace), `signal_ids`, `trigger_id`, `trade_id`, `structural_unchanged_reason`.

Gates:
- **Terminal-status block** — can't update INVALIDATED/CLOSED/SUPERSEDED.
- **Zero-trigger guard** — review-only updates on theses with no triggers are rejected; agent must add triggers OR close via `change_status: "INVALIDATED"`.
- **Goalpost-moving guard** — refuses to raise `target_price` on a WATCHING thesis whose entry condition is currently met. Bypassed for `change_status: "ACTIVE"` (legitimate target raise on promotion).
- **Shape gate** — post-patch (entry, target, stop) satisfies direction-relative ordering.
- **Structural-unchanged-reason gate** — patches that change confidence/target/stop without belief changes AND without `structural_unchanged_reason` are rejected. Bypassed on any `change_status` transition.
- **ACTIVE promotion requires** `existing.status === "WATCHING"` and recomputed `target_price` + `stop_loss`.

### `manage_watchlist` — watchlist mutations + parallel WATCHING thesis

Adds/removes/updates `AnalystWatchlistItem` rows AND mints/supersedes a parallel `Thesis(status=WATCHING)` on the same ticker. This dual-store coexistence is transitional — the Thesis is the durable store; the watchlist table is the legacy mirror. Collapse pending.

---

## 8. Consumers

| Consumer | Reads | Contract |
|---|---|---|
| **Daily-run prompt** ([`system-prompt.ts`](../lib/agent/system-prompt.ts)) | Live Theses table: ticker, status, direction, **horizon**, confidence, entry/target/stop, **schedule** (review-due / catalyst-in-Nd / max-hold-Xd-left), created. Plus per-thesis line: belief preview + horizon exit-policy hint. | Agent walks each thesis with all the structured shape visible. No `get_theses` round-trip needed for routine review. |
| **Tactical-run prompt** ([`intraday-tactical.ts`](../lib/agent/system-prompts/intraday-tactical.ts)) | Full thesis: id, ticker, direction, horizon, **coreBelief, keyAssumptions, invalidationConds**, entry/target/stop, targetSizePct, scalingPlan, recentUpdates. Plus the firing trigger and signal payload. | Validates trigger → scores against keyAssumptions → executes the action. The canonical structured-belief consumer. |
| **Discovery-run prompt** ([`discovery.ts`](../lib/agent/system-prompts/discovery.ts)) | existingTickers (just symbols). | Mints; never updates. Output theses must satisfy the structural-belief gate. |
| **Trigger evaluator** ([`evaluate.ts`](../lib/agent/triggers/evaluate.ts)) | `triggers[]`, `nextReviewAt`, `createdAt`. | Pure predicate matching. No belief reading — that's the LLM's job in tactical-run. |
| **Trade evaluator** ([`trade-evaluator.ts`](../lib/inngest/functions/trade-evaluator.ts)) | `direction`, `horizon`, **`coreBelief`, `keyAssumptions`, `invalidationConds`**, `sourceSignalIds`, `reasoningSummary`, `signalTypes`, `thesisBullets`. | GPT-4o post-mortem grades against the BELIEF: did each `keyAssumption` hold? Did any `invalidationCondition` come true? "Right outcome, wrong reasons" becomes a documented learning. |
| **Briefing agent** | Run transcript + portfolio. | Doesn't crack open thesis-level belief fields today. Future enhancement. |
| **ThesisSheet UI** ([`ThesisSheet.tsx`](../components/agent/sheets/ThesisSheet.tsx)) | direction, confidence, reasoning, bullets, risks, entry/target/stop, hold_duration, signal_types, fundamentals, status. Plus separate fetch for triggers/horizon/nextReviewAt via `/api/theses/[id]/triggers`. | Renders the trade card. Does NOT yet render coreBelief / keyAssumptions / invalidationConds — that's a separate UI follow-up. |
| **Price monitor + trade-exit** | Position fields only (today). | Hardcoded proximity thresholds (0.8 near-stop, 0.9 near-target, 0.8 near-target email). Horizon-aware enforcement is **not yet shipped** — see GAPS P0-5b/c. |

---

## 9. What's intentionally not done

The redesign considered several larger changes that were deliberately NOT pursued. Recorded so future sessions don't re-add them.

- **Did not rename horizon → style.** Horizon already names the thing; renaming was churn.
- **Did not split Thesis into watch/enter/hold/exit JSON columns.** Triggers + horizon already encode this. The four-part contract is a conceptual frame, not a schema shape.
- **Did not kill PASS direction.** It works as institutional memory; corner-case logic was not worth the simplification cost.
- **Did not add `analystId` FK.** The JOIN-via-ResearchRun pattern is ugly but works. Defer until a query-perf gap actually appears.
- **Did not collapse `manage_watchlist`.** Dual-store works today; collapsing is a separate follow-up.
- **Did not add a DAY horizon.** Intraday Momentum works via `horizon=TRADE` + EOD-flatten cron. Adding DAY is real work for marginal clarity.
- **Did not ship horizon-aware price-monitor / trade-exit.** Constants are in `horizon-policy.ts` but the runtime branching in `price-monitor.ts` and `trade-exit.ts` is not yet wired. That's GAPS P0-5b/c — explicitly open.

The principle: **the system was fundamentally sound, not fundamentally broken.** Triggers were the right primitive; horizon was the right discriminator; the lifecycle states worked; the audit log worked. What was missing was structural-belief discipline, the promotion enum, surfacing in the daily-run prompt, and the trade evaluator reading the belief. Those shipped. The rest stays intentional non-work.

---

## See also

- [`VISION.md`](./VISION.md) Pillar 2 — what "thesis quality" is supposed to look like
- [`GAPS.md`](./GAPS.md) — the open punch list of remaining work (P0-5b/c, the watchlist collapse, the UI Plan section, etc.)
- [`/agent-workflow`](../app/(root)/agent-workflow/page.tsx) — the live operational view, driven by [`workflow-registry.ts`](../lib/agent/workflow-registry.ts)
- [#239](https://github.com/dave-sucks/hindsight/pull/239) — the architecture pass that produced this doc
