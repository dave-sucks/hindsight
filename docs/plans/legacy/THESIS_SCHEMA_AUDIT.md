> **SHIPPED/SUPERSEDED — see [`../../THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md); kept as build history.**

# Hindsight — Thesis Schema Audit

> **Status (as of 2026-05-16):** Complete. Synthesis-prompt update bundled into
> this PR. Phase 1 session is wiring `thesis-writer`; this audit landed first
> so Phase 1's agent prompt can be written against a complete spec rather than
> the partial mapping in [`THESIS_RESEARCH_V2.md`](../THESIS_RESEARCH_V2.md).
>
> **What this is:** a full inventory of every field on the `Thesis` Prisma
> model + every `record_thesis` tool arg, mapped to (a) who fills it and
> (b) what input feeds the decision. Identifies the gaps where the current
> synthesis prompt produces narrative but doesn't surface the decision-fields
> the agent has to fill into `record_thesis`.
>
> **Companion change in this PR:** [`lib/agent/thesis-research/build-synthesis-prompt.ts`](../../../lib/agent/thesis-research/build-synthesis-prompt.ts)
> gains a new `## Decision Fields (Recommended)` section so the deep-research
> model produces schema-shaped recommendations the agent can directly copy
> into the tool call.
>
> **Related docs:**
> - [`docs/plans/THESIS_RESEARCH_V2.md`](../THESIS_RESEARCH_V2.md) — the parent plan
> - [`docs/THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) — live thesis-system reference
> - [`docs/PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle

---

## 1. Why this audit was needed

Looking at an existing Snowflake WATCHING thesis card in production, the rendered surface includes way more fields than the [Phase 0 synthesis prompt](../../../lib/agent/thesis-research/build-synthesis-prompt.ts) explicitly produces:

- **Belief layer** — Core Belief box, Key Assumptions list, Invalidation Conditions
- **Scoring** — 4-dim composite (Trend / RS / Entry / Catalyst Freshness) with notes per dim
- **Triggers** — ENTER IF (price), REVIEW IF (5 distinct predicates with cooldowns)
- **Horizon shape** — COMPOUNDER → 30d review cadence, multi-year hold, "exits only when invalidation triggers fire"
- **Schedule** — Next review date, Target size %
- **Activity log** — ThesisUpdate rows

The Phase 0 synthesis prompt produces **research** (snapshot / catalysts / fundamentals / earnings / bull / bear / consensus / insider). The Phase 1 agent has to translate that into **decisions** (direction / horizon / target / stop / confidence / belief / triggers). Without explicit recommendations in the synthesis output, the agent has to invent them — which is exactly the layer-mixing the [three-layer principle](../../PRINCIPLES.md) warns against.

The fix: synthesis produces both. Narrative for human readers + `reasoning_summary` / `thesisBullets` / `riskFlags`. Decision Fields block as soft-form recommendations the agent can copy into `record_thesis` with minimal interpretation.

---

## 2. Full Thesis field inventory

Three buckets: **agent provides** (judgment), **system derives** (computed at write), **lifecycle** (mutated by later updates / non-write paths).

### Bucket A — Agent provides (judgment, can't be auto-computed)

| Field | Required for | Source for agent | Synthesis covers? |
|---|---|---|---|
| `direction` (LONG/SHORT/PASS) | All | Synthesis bull-vs-bear weight + analyst context | **Gap** — no explicit recommendation |
| `horizon` (CATALYST/TARGET/TRADE/COMPOUNDER) | LONG/SHORT | Trade-structure judgment | **Gap** — no explicit recommendation |
| `confidenceScore` (0-100) | All | Composite of evidence quality + setup | **Gap** — no quantified score |
| `entryPrice` | LONG/SHORT | Snapshot current price | Implicit in `## Snapshot` |
| `targetPrice` | LONG/SHORT | Resistance level / breakout / analyst PT | **Gap** — synthesis mentions levels but no explicit recommendation |
| `stopLoss` | LONG/SHORT | Support level / R:R math | **Gap** — same |
| `coreBelief` | LONG/SHORT (1 sentence) | Synthesis bull case → distilled load-bearing claim | **Gap** — Bull Case is multi-bullet; Core Belief is one sentence |
| `keyAssumptions` (≥2) | LONG/SHORT | Falsifiable premises | **Gap** — Bull Case ≠ assumptions; assumptions are premises that must REMAIN TRUE for Core Belief to hold |
| `invalidationConds` (≥2) | LONG/SHORT (≥1 for PASS) | What kills the trade | **Partial** — Bear Case lists risks, but Invalidation is the specific trip-wires that end the position |
| `catalystDate` (ISO) | `horizon=CATALYST` | A specific dated event | **Partial** — Catalysts & Events lists dates but doesn't single out THE catalyst for the trade |
| `maxHoldDays` | `horizon=TRADE` | Setup-specific window (5-7 tight, 10-14 swing) | **Gap** — no recommendation |
| `holdDuration` (DAY/SWING/POSITION) | Optional, derived from horizon | Maps from horizon | Auto-derived |
| `targetSizePct` (0-100) | Optional | Sizing intent based on conviction × R/R | **Gap** — no recommendation |
| `scalingPlan` (ladder) | Optional | Scale-in/out structure | **Gap** — no recommendation |
| `signalTypes[]` | All | Normalized signal types that informed thesis | **Partial** — could be inferred from synthesis bullets |
| `sector` | Optional | From structured data | Already in data block |
| `reasoningSummary` | All (2-3 sentences) | High-level synthesis | Covered by `## Snapshot` + `## Recent Catalysts` collapse |
| `thesisBullets[]` | All (3-5) | Bull-case substance | Covered by `## Bull Case` |
| `riskFlags[]` | All (2-4) | Bear-case substance | Covered by `## Bear Case` |
| `fundamentals` (JSON block) | Optional | Numeric snapshot | Already in data block |
| `triggers[]` (custom on top of horizon defaults) | Rare | Specific numeric/event predicates | **Gap** — synthesis mentions thresholds (e.g. "Q1 guidance below $X = breakdown") but doesn't recommend trigger predicates |
| Composite scoring (`scoring` 4-dim block) | Optional | Trend / RS / Entry / Catalyst Freshness | **Gap** — synthesis doesn't break this out |

### Bucket B — System derives (computed at write time)

| Field | How |
|---|---|
| `status` | Derived from `(direction, sourceKind, runMode)`. Discovery LONG/SHORT → WATCHING. PASS → ARCHIVED. `place_trade` flips WATCHING → ACTIVE. `close_position` flips ACTIVE → CLOSED. |
| Default `triggers[]` | [`defaultTriggersForHorizon()`](../../../lib/agent/triggers/defaults.ts) emits the standard set per `(horizon, direction, state)`. WATCHING LONG auto-gets `PRICE_ABOVE(target) → ENTER cd=1d`. HELD LONG auto-gets `PRICE_BELOW(stop) → EXIT cd=0` + `PRICE_ABOVE(target) → REVIEW cd=0`. CATALYST adds filing-OR + earnings REVIEW. TRADE adds `TIME_ELAPSED(maxHoldDays)`. TARGET adds 30d hygiene. COMPOUNDER adds 90d hygiene. |
| `nextReviewAt` | Default from `HORIZON_REVIEW_DAYS`. CATALYST=1d, TRADE=1d, TARGET=7d, COMPOUNDER=30d. |
| Cooldown defaults | [`defaultCooldownDaysForPredicate()`](../../../lib/agent/triggers/defaults.ts) backfills any agent-supplied trigger missing `cooldownDays`. EARNINGS_* = 7, FILING = 1, price = 1, etc. |
| `modelUsed` | Hard-coded to `"gpt-4o"` today in [`record-thesis.ts:852`](../../../lib/agent/tools/record-thesis.ts). **NEEDS UPDATE for Phase 1 thesis-writer** — should be `"claude-sonnet-4-6"` (or whatever wins the bake-off). Flag for Phase 1 session. |
| `researchData` | JSONB. Phase 1 thesis-writer passes raw data block; persisted as-is. |
| `researchSections` | JSONB. Phase 1 thesis-writer passes parsed sections; persisted as-is. |
| `researchUpdatedAt` | Set to `Date.now()` on any write that includes `researchData`. |
| `sourceSignalIds` validation | When `sourceKind="ROUTED_SIGNAL"`, every ID must exist in this analyst's `AnalystSignalRoute` rows for today's ET trading day. |

### Bucket C — Lifecycle / non-write paths

| Field | Set by |
|---|---|
| `parentThesisId` | Direction flips — `record_thesis` chains via parent_thesis_id arg |
| `invalidatedAt`, `invalidReason` | `update_thesis(change_status='INVALIDATED')` |
| `closedAt`, `closeReason` | `close_position` or `update_thesis(change_status='CLOSED')` |
| `fullResearch` | Legacy JSONB — used for `fundamentals` + `scoring` snapshot today. Superseded by `researchData`/`researchSections` in V2. |
| `thoughtTrace` | Legacy JSONB — per-ticker event log for replay. Not actively written by agent. |
| `revalidationTriggers` | Deprecated — superseded by `triggers[]`. |
| `ThesisUpdate` rows | Every state change writes one. Types: CREATED / UPDATED / TRIGGER_FIRED / REVIEWED / ACTED / INVALIDATED / CLOSED / SUPERSEDED / STATUS_CHANGED. Phase 1 adds RESEARCH_REFRESHED (string, no enum migration). |

---

## 3. What the synthesis prompt produces today

The [Phase 0 synthesis prompt](../../../lib/agent/thesis-research/build-synthesis-prompt.ts) produces 9 markdown sections:

| Section | Schema field it feeds (or could feed) |
|---|---|
| `## Snapshot` | `reasoningSummary` (part 1), `entryPrice` (the current price reference) |
| `## Recent Catalysts (last 1-2 weeks)` | `reasoningSummary` (part 2) |
| `## Fundamentals` | `fundamentals` JSON block, supporting context for `coreBelief` |
| `## Latest Earnings (5 bullets)` | `thesisBullets` (when bullish), `riskFlags` (when missed) |
| `## Catalysts & Events (3-5 dated bullets)` | `catalystDate` candidates (when CATALYST horizon) |
| `## Bull Case (3-5 cited claims)` | `thesisBullets`, distilled to `coreBelief` |
| `## Bear Case (3-5 cited claims)` | `riskFlags`, candidates for `invalidationConds` |
| `## Analyst Consensus` | Supporting context |
| `## Insider & Technical Setup` | `targetPrice`/`stopLoss` candidates from cited support/resistance |

What's **explicitly produced** today: research narrative, bull case, bear case, with citations.

What's **NOT explicitly produced** today: any direct schema recommendations. The agent has to infer all of:
- Direction
- Horizon
- Entry / target / stop
- Confidence score
- Core belief (single sentence)
- Key assumptions (falsifiable premises)
- Invalidation conditions (specific trip-wires, distinct from "risks")
- Composite score (4-dim)
- Custom triggers beyond horizon defaults
- catalystDate / maxHoldDays / targetSizePct

That's a lot of inference. The Phase 1 thesis-writer agent's job becomes "read the research narrative → invent all these fields." Sometimes the model will do this well; often it'll write thin/vague decisions because the synthesis layer didn't pre-format them.

---

## 4. The fix — Decision Fields block

Add a single new section to the synthesis prompt: `## Decision Fields (Recommended)`. This block produces schema-shaped recommendations the model derives from its own research. The agent reads them and can directly copy into `record_thesis`, overriding with a documented rationale only when judgment differs.

The section's contents:

```
## Decision Fields (Recommended)

**Direction:** LONG | SHORT | PASS — one-line why
**Horizon:** CATALYST | TARGET | TRADE | COMPOUNDER — one-line why
  - If CATALYST: catalyst_date = <ISO date> and the specific event
  - If TRADE: max_hold_days = <N> and why this window
**Entry / Target / Stop:**
  - Entry: $X (current price reference)
  - Target: $Y (cite the level — breakout / consensus PT / etc.)
  - Stop: $Z (cite the level — support / -N% / etc.)
  - R:R: <ratio>:1
**Confidence:** N/100 — one-line justification

**Core Belief (1 sentence):**
<The ONE load-bearing claim that, if it stops being true, the thesis is broken.
Distinct from "bull case" — this is the single sentence the trade hinges on.>

**Key Assumptions (3+ falsifiable premises that must REMAIN TRUE):**
- <Premise 1 — specific and falsifiable>
- <Premise 2 — specific and falsifiable>
- <Premise 3 — specific and falsifiable>

**Invalidation Conditions (3+ specific trip-wires — distinct from Bear Case):**
- <Specific thing that ends the trade — e.g. "Q2 EPS miss >5%">
- <Specific thing that ends the trade — e.g. "Gross margin <70%">
- <Specific thing that ends the trade — e.g. "CFO departure">

**Composite Score: N/10**
- Trend Strength (0-3): <score> — <one-line note>
- Relative Strength (0-3): <score> — <one-line note>
- Entry Quality (0-2): <score> — <one-line note>
- Catalyst Freshness (0-2): <score> — <one-line note>

**Target Size:** N% of portfolio — one-line why

**Suggested Custom Triggers (beyond horizon defaults):**
- <Optional. Specific REVIEW/EXIT predicates worth adding. Use predicate kinds
  from lib/agent/triggers/types.ts. Example: EARNINGS_MISS minSurprisePct: 3
  → REVIEW (rationale: "guidance miss on next print kills the AI-acceleration
  thesis"). Skip this section if horizon defaults are sufficient.>
```

Why each field matters:

- **Direction** — was previously implicit; making it explicit lets the agent skip a redundant inference step
- **Horizon + catalyst_date + max_hold_days** — these are the load-bearing fields for the trigger templates. The synthesis already identifies catalysts; just pin one as THE catalyst when applicable
- **Entry / Target / Stop with R:R** — synthesis mentions levels; now it commits to specific numbers with a math check
- **Confidence** — quantifies the soft "we think this is high conviction" into a number the system can use for `minConfidence` gating
- **Core Belief** — distillation of Bull Case into the ONE sentence; required by `record_thesis` structural-belief gate
- **Key Assumptions vs Invalidation Conditions vs Bear Case** — three different things. Bear Case = risks (what could go wrong). Key Assumptions = premises that must hold (positive framing). Invalidation Conditions = specific trip-wires that end the trade (decision rule). All three matter. Making them distinct in the prompt forces the model to distinguish them
- **Composite Score** — the analyst's quality-grade for the setup. Drives ADD/ROTATE vs WATCH vs PASS rules downstream
- **Target Size** — sizing intent based on conviction × R/R
- **Custom Triggers** — most theses don't need any; the horizon defaults cover the standard cases. But when a thesis has a specific assumption like "gross margin must stay above 70%," that's worth a custom EARNINGS-tied REVIEW trigger

---

## 5. Required Phase 1 agent prompt notes

When the Phase 1 session writes the `thesis-writer` mode prompt, the workflow should explicitly read the Decision Fields block:

```
You are {analystName}, writing one thesis on $TICKER.
{analystPrompt}

Workflow:
  1. Call write_thesis_research(ticker, analyst_context, mode).
     Wait for the full research synthesis.
  2. Read the returned research carefully. The synthesis ends with
     a ## Decision Fields (Recommended) block — these are the model's
     schema-shaped recommendations. Treat as the default; override
     only with documented rationale.
  3. Call record_thesis with:
     - direction, horizon, confidence_score, entry_price,
       target_price, stop_loss → copy from Decision Fields
     - core_belief, key_assumptions, invalidation_conditions →
       copy from Decision Fields
     - reasoning_summary → 2-3 sentence collapse of Snapshot +
       Recent Catalysts
     - thesis_bullets → top 3-5 bullets from Bull Case
     - risk_flags → top 2-4 bullets from Bear Case
     - signal_types → inferred from sourcing
     - scoring → copy from Composite Score block
     - target_size_pct → copy from Decision Fields
     - catalyst_date / max_hold_days → copy when applicable
     - triggers → copy custom triggers from Decision Fields
       (horizon defaults will auto-merge)
     - sources_used → from research citations
     - researchData + researchSections → the full block + sections
       from write_thesis_research
  4. complete_run.

Override discipline:
  - If you disagree with a Decision Fields value, document why in the
    rationale field. The synthesis model is your first-pass analyst;
    you're the PM with final authority. But every override needs a
    one-line reason in the persisted thesis.
```

Also: update [`record_thesis.ts:852`](../../../lib/agent/tools/record-thesis.ts) `modelUsed` to be derived from `ctx.runId`'s mode, not hard-coded to `"gpt-4o"`. Phase 1 includes this small change.

---

## 6. What's intentionally NOT changing

- **No new schema fields.** Every field discussed here already exists on `Thesis`. This audit just pre-formats them in the synthesis output.
- **No new Layer-1 gates.** The existing structural-belief, ENTER-trigger, R:R, and provenance gates stay as the enforcement layer. The synthesis-prompt change is purely additive (Layer 2 — pre-digesting state for the agent).
- **No new tools.** The 5 data tools from [PR #277](https://github.com/dave-sucks/hindsight/pull/277) + the existing `record_thesis` + `update_thesis` are enough.
- **`fullResearch` JSONB stays for now.** It's the legacy holder for `fundamentals` + `scoring` snapshot. Phase 1 doesn't need to migrate off it. Eventually the `scoring` block can move to `researchSections` and `fullResearch` can be deprecated.

---

## 7. Open decisions for the Phase 1 session

1. **Where does the agent put the override rationale?** Three options:
   - On the `update_thesis` rationale field (later, when overriding)
   - In the `reasoning_summary` field at mint time
   - In a dedicated `rationale` field on `record_thesis` (doesn't exist today; would be additive)
   - **Recommendation:** put it in `reasoning_summary` at mint time. No new field needed.
2. **Should `update_thesis` refresh the `researchData` automatically when the agent passes new research?** Yes — set `researchUpdatedAt = now()` whenever the patch includes `researchData`. Phase 1 includes this small change.
3. **What does `update_thesis` do if the Decision Fields recommend a direction flip (LONG → SHORT)?** Current behavior: direction-change is rejected by `update_thesis` (must go through `record_thesis` with `parent_thesis_id` chain). Phase 1 should NOT change this — keep direction flips on the canonical chain path.

---

## See also

- [`docs/plans/THESIS_RESEARCH_V2.md`](../THESIS_RESEARCH_V2.md) — parent plan
- [`docs/THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) — lifecycle, state machine, scenarios
- [`docs/PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle
- [`lib/agent/tools/record-thesis.ts`](../../../lib/agent/tools/record-thesis.ts) — write tool with all gates
- [`lib/agent/triggers/defaults.ts`](../../../lib/agent/triggers/defaults.ts) — per-horizon trigger templates
- [`lib/agent/triggers/types.ts`](../../../lib/agent/triggers/types.ts) — predicate union
- [`lib/agent/thesis-research/build-synthesis-prompt.ts`](../../../lib/agent/thesis-research/build-synthesis-prompt.ts) — updated in this PR
