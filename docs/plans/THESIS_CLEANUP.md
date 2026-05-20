# Hindsight — Thesis Surface Cleanup (tracker)

> **What this is:** delta + PR tracker for the Thesis schema, UI, and
> prompt-field cleanup done in prep for
> [Phase 1 of THESIS_RESEARCH_V2.md](./THESIS_RESEARCH_V2.md) (the
> deep-research thesis-writer agent). This is a **living tracker** — not
> a planning doc — covering both shipped work and the still-to-do
> consolidation that the V2 rollout makes possible.
>
> **Audit basis:** [`docs/plans/THESIS_SCHEMA_AUDIT.md`](./THESIS_SCHEMA_AUDIT.md).
> The deltas below are the differences between that audit and what this
> cleanup actually executes.

---

## 0. Status snapshot (2026-05-18)

| Phase | Goal | PRs | State |
|---|---|---|---|
| **Phase 1 — Cleanup** | Drop dead schema fields. Add render paths for fields that were silently fetched and ignored. Trim wasted agent-arg tokens. | PR-1 · PR-2 · PR-3 · PR-4 | **Shipped** |
| **Phase 1.5 — UI exposure** | Surface canonical fields that exist on the row but aren't shown in the sheet (confidence, provenance, sources, parent chain). | PR-6 | **Shipped 2026-05-18** |
| **Phase 1 finale — column drops** | DROP COLUMN for the 6 legacy fields once a soak proves nothing's reading them. | PR-5 | **Pending (gated on ≥7d soak)** |
| **Phase 2 — Consolidation** | Collapse fields that overlap once V2 fills in `researchSections`. Documented now; not executed until V2 ships and we see the data quality. | PR-7 · PR-8 | **Documented only — not started** |

---

## 1. Target end state (post-Phase-2)

This is what the Thesis row WILL look like after every phase below lands.
The minimal, decision-grade field set — atomized just enough for the LLM
to reason mechanically, no more.

### Identity & Lifecycle
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `id`, `ticker`, `sector`, `researchRunId`, `userId`, `accountId` | FKs + ticker | System (Prisma defaults + writer args) | Everything |
| `createdAt`, `updatedAt` | Timestamps | Prisma | UI, analytics |
| `direction` (PENDING / LONG / SHORT / PASS) | The analyst's view | record_thesis · update_thesis (PENDING-promotion only) | Everywhere |
| `status` (WATCHING / ACTIVE / CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED) | Where in lifecycle | record_thesis · update_thesis · place_trade · close_position | Everywhere |
| `parentThesisId` | Chain pointer when a thesis supersedes an earlier one (direction flip) | record_thesis (`parent_thesis_id` arg) | UI chain chip; trade-evaluator for history |
| `invalidatedAt`, `invalidReason` | Set on INVALIDATED transition | update_thesis(change_status='INVALIDATED') | UI terminal-status Alert (added PR-2) |
| `closedAt`, `closeReason` | Set on CLOSED or ARCHIVED transition | close_position · update_thesis(change_status='CLOSED'/'ARCHIVED') | UI terminal-status Alert |
| `nextReviewAt` | When housekeeping should re-look | record_thesis (derived from horizon) · update_thesis (REVIEWED-bump) | get_theses needsAction · overdue-review cron · UI Schedule |

### Trade structure (the decision)
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `horizon` (CATALYST / TRADE / TARGET / COMPOUNDER) | Exit policy + trigger template kind | Agent (record_thesis) | Daily-run prompt, trigger evaluator, trade evaluator, UI |
| `entryPrice` · `targetPrice` · `stopLoss` | The trade levels | Agent (record_thesis) | Triggers, place_trade, position monitor, UI |
| `catalystDate` | When horizon=CATALYST | Agent | Trigger defaults (filing OR / earnings REVIEW) |
| `maxHoldDays` | When horizon=TRADE | Agent | TIME_ELAPSED trigger |
| `targetSizePct` (0-100) | % of portfolio at full position | Agent | place_trade sizing math, UI Schedule |
| `scalingPlan` | Optional scale-in/out ladder | Agent | UI; future manage_position automation |
| `composite` (in `scoring`) | Setup quality grade /10 | Agent (record_thesis 4-dim self-grade) | **place_trade hard gate (composite ≥ 7)** · UI |

### Belief (the durable claim)
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `coreBelief` (1 sentence) | The load-bearing claim — distinct from current-state framing | Agent at mint, refined rarely | **Tactical agent (verbatim into context on trigger fire)** · **Trade evaluator (grades against this on close)** · UI |
| `keyAssumptions` (≥2) | Falsifiable premises that must remain true | Agent at mint | **Daily-run (checks against fresh signals)** · trade evaluator · UI |
| `invalidationConds` (≥2 for LONG/SHORT, ≥1 for PASS) | Specific trip-wires that END the trade | Agent at mint | Daily-run (signal classification) · trade evaluator (post-mortem grading) · UI (added PR-2) |

### Composite scoring (the 4-dim setup grade)
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `scoring` (top-level Json, since PR-1) | `{ trendStrength, relativeStrength, entryQuality, catalystFreshness, composite }` — each dim is `{ score, note }`; composite folds in as peer key | Agent (record_thesis) | Daily-run prompt (`composite ≥ 7` gate) · Discovery prompt (composite ≥ 3 watchlist-mint gate) · UI |

### Triggers (mechanical predicates)
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `triggers` (Json discriminated union) | Structured ENTER / REVIEW / EXIT predicates with cooldown days, lastFiredAt | record_thesis (defaults merged with agent extras) · update_thesis | **Trigger evaluator (cron — deterministic, no LLM)** · daily-run needsAction · UI |

### Deep research (the V2 artifact)
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `researchData` (Json, ~3-5KB) | Raw structured-data block (financials, peers, insider, earnings history, etc.) the synthesis model consumed | Thesis-writer agent (V2 Phase 1) | Thesis-writer refresh path · debugging |
| `researchSections` (Json) | Parsed 9-section synthesis with inline citations: Snapshot · Recent Catalysts · Fundamentals · Latest Earnings · Catalysts & Events · Bull Case · Bear Case · Analyst Consensus · Insider & Technical | Thesis-writer agent | UI accordion (added PR-2) · trade evaluator (post-mortem context) |
| `researchUpdatedAt` | When the research blob was last refreshed | Thesis-writer agent | Daily-run staleness gate (`>7d → dispatch refresh before place_trade`) · UI |

### Provenance
| Field | What it is | Set by | Read by |
|---|---|---|---|
| `sourceKind` (ROUTED_SIGNAL · WEB_SEARCH · WATCHLIST_REVIEW · POSITION_REVIEW · USER_ADDED · BUILDER_SEED · EDITOR_SEED) | Where the idea came from | record_thesis (inferred or supplied) · server actions for non-agent paths | UI provenance chip (Phase 1.5) · hit-rate analytics |
| `sourceRationale` | One-line "how did I get to this ticker" | Agent (when sourceKind is WEB_SEARCH/WATCHLIST_REVIEW/POSITION_REVIEW) | UI tooltip on the sourceKind chip |
| `sourceSignalIds` | FK array into Signal table — the actual signals that informed this thesis | Agent (when sourceKind=ROUTED_SIGNAL, validated against AnalystSignalRoute for today) | Trade evaluator (credits originating Monitors on close) · UI (link to signals — Phase 1.5) |
| `sourcesUsed` | Web URLs / reports cited at mint (different from sourceSignalIds: those are internal Signal rows) | Agent | UI Sources strip (Phase 1.5; already rendered on `/stocks/[symbol]`) |
| `signalTypes` (taxonomy tags) | "MOMENTUM" / "EARNINGS_BEAT" / "SECTOR_ROTATION" / etc. | Agent | UI tag chips (already shown); trade evaluator for grading |

### Fields that EXIT in Phase 2 (consolidation — documented, not yet executed)
| Field | Why dropped (eventually) | What replaces it |
|---|---|---|
| `confidenceScore` (0-100) | Overdetermined with `scoring.composite`. Both currently gate `place_trade` (confidence ≥ minConfidence AND composite ≥ 7). Picking one removes the "two scales saying the same thing" problem. | `scoring.composite` becomes the single conviction signal. `minConfidence` becomes `minComposite`. |
| `reasoningSummary` | Overlaps with `researchSections.snapshot` (current-state framing, refreshed often). | The Snapshot section of `researchSections`. |
| `thesisBullets` | Overlaps with `researchSections.bullCase` (the bull bullets, cited). | `researchSections.bullCase`. |
| `riskFlags` | Overlaps with `researchSections.bearCase` (the bear bullets, cited). | `researchSections.bearCase`. |

These four are **kept for now** because:
1. The current production data (709 theses) has them populated; `researchSections` is null on every row.
2. The V2 agent's quality bar for `researchSections.bullCase/bearCase/snapshot` needs to be validated before we trust them to replace four-fields-worth of content.
3. The agent prompts + UI + trade-evaluator all currently read these fields. The fold-in is a coordinated change, not a single PR.

Phase 2 fires once we have ~30 days of V2 theses we can side-by-side with the legacy fields.

---

## 2. Why some atomization survives — the LLM-vs-analyst tradeoff

A human analyst writes "Buy NVDA PT $250, risk = AI capex deceleration" and a human reader infers everything from context. An LLM on a 24/7 trigger loop **can't infer** — it needs explicit structure. The fields that earn their keep:

| What | Why atomized |
|---|---|
| `coreBelief` separate from `reasoningSummary` | Trade evaluator grades exits against the **durable** belief, not the current-state framing. Without atomizing, post-mortems become vibes. |
| `keyAssumptions[]` as a separate list | Tactical agent checks "does this signal flip an assumption?" mechanically. Premises in a paragraph aren't enumerable. |
| `invalidationConds[]` separate from `riskFlags` | Same reason — these are decision rules, not narrative risks. The cron's trigger evaluator + the daily-run agent both need explicit kill criteria. |
| `triggers[]` as discriminated-union predicates | Cron evaluator fires deterministically with no LLM call. Has to be structured. |
| 4-dim `scoring` (vs a single conviction number) | Forces the agent to explicitly think about trend / RS / entry / catalyst. Single-number conviction makes "I like this" too easy. |

What's not justified — and what Phase 2 cleans up:

| What | Why redundant |
|---|---|
| `confidenceScore` AND `scoring.composite` | Both gate place_trade. Both measure overall conviction in the trade. No real analyst grades 4 dimensions AND assigns a separate conviction number. |
| `thesisBullets` AND `researchSections.bullCase` | V2 bull case is richer + cited. Bullets become a redundant abbreviation. |
| `riskFlags` AND `researchSections.bearCase` | Same shape. |
| `reasoningSummary` AND `researchSections.snapshot` | Same content, different lengths. V2 Snapshot is more rigorous. |

---

## 3. Deltas vs the original schema audit

| Item | THESIS_SCHEMA_AUDIT.md | This cleanup |
|---|---|---|
| `thoughtTrace` | "Legacy — not actively written" | **Drop** (zero readers verified) |
| `revalidationTriggers` | "Deprecated — superseded by `triggers[]`" | **Drop** (zero references) |
| `fullResearch` | "Stays for now. Eventually `scoring` can move to `researchSections`" | **Migrate + drop.** Promote `scoring` to top-level `scoring Json?` column (kept distinct from `researchSections`, which is narrative synthesis) |
| `modelUsed` | "Hard-coded — derive from ctx" | **Drop entirely.** Zero readers. Model telemetry lives on `ResearchRun.mode` |
| `source` | (not flagged) | **NEW: Drop.** Legacy "AGENT"/"MANUAL"/"EDITOR" — superseded by `sourceKind` |
| `holdDuration` | (not flagged) | **NEW: Deprecate → derive from `horizon` → drop** via `holdDurationFromHorizon()` helper |
| `record_thesis` `hold_duration` arg | (not addressed) | **NEW: Dropped** — wasted agent tokens (agents kept passing horizon values to it) |
| `invalidationConds` render | (not addressed) | **NEW: Added section** between Key Assumptions and Composite Score |
| `researchSections` render | (not addressed) | **NEW: Added accordion** below Composite Score (gated on non-null) |
| Terminal-status reasons | (not addressed) | **NEW: Added Alert** near StatusPill for CLOSED/INVALIDATED/ARCHIVED |
| Redundant target/stop in ThesisSheet | (not addressed) | **NEW: Consolidated.** Removed the dot-separated intent line from `WatchingRow`. |
| `ThesisStatus.ARCHIVED` missing from TS | (not addressed) | **NEW: Added to type + display registry.** Was a real bug post-watchlist-collapse. |
| `confidenceScore` chip on sheet | (not addressed) | **NEW (Phase 1.5)** — surfaced in header next to Composite Score |
| Provenance row | (not addressed) | **NEW (Phase 1.5)** — sourceKind chip + sourceRationale tooltip + signal-count |
| Sources strip on sheet | (not addressed) | **NEW (Phase 1.5)** — mirrors `/stocks/[symbol]` favicon strip |
| Parent thesis chip | (not addressed) | **NEW (Phase 1.5)** — when `parentThesisId` is set |
| `confidenceScore` removal | (not addressed) | **Phase 2 (documented only)** — collapsed onto `scoring.composite` post-V2 |
| `thesisBullets` / `riskFlags` / `reasoningSummary` removal | (not addressed) | **Phase 2 (documented only)** — folded into `researchSections.{bullCase, bearCase, snapshot}` post-V2 |

The schema audit's Bucket A / Bucket B / Decision Fields synthesis-prompt block stays unchanged — those are about the synthesis prompt, which Phase 1 of V2 implements.

---

## 4. PR sequence

### Phase 1 — Cleanup (shipped)

| PR | Scope | Risk | Status |
|---|---|---|---|
| **1** | Schema additive — `scoring Json?` column. record_thesis writes to it. ThesisSheet reads it with `fullResearch.scoring` fallback. Backfill SQL applied 2026-05-18 (139 rows backfilled, full parity with legacy path). | Low | **Shipped 2026-05-18** |
| **2** | UI fixes — render `invalidationConds`, terminal-status Alert, `researchSections` accordion (gated on Phase 1 data), drop the redundant intent line from `WatchingRow`, add `ThesisStatus.ARCHIVED` to the type + display registry, add `holdDurationFromHorizon()` helper. | Low | **Shipped 2026-05-18** |
| **3** | `get_theses.include_research: boolean` (default false). Phase 1 thesis-writer will pass `true`. Also: `scoring` added to the default select so the agent can see composite scores during review. | Low | **Shipped 2026-05-18** |
| **4** | Drop `hold_duration` arg from `record_thesis` zod. Stop writing `fullResearch` from `record_thesis`. Derive `holdDuration` on the card-data assembly side (`update_thesis.thesisToCardData`, `thesis-row.tsx`, `trades/[id]/page.tsx`) so the legacy column can be dropped. Server actions + `record_thesis` still write to the NOT-NULL `source`/`modelUsed`/`holdDuration` columns; those writes stop with the column drop in PR-5. | Low-Medium | **Shipped 2026-05-18** |

### Phase 1.5 — UI exposure (in progress)

| PR | Scope | Risk | Status |
|---|---|---|---|
| **6** | Expose 4 hidden fields in the ThesisSheet so the user can audit them: (a) `confidenceScore` chip in the header next to Composite Score, (b) Provenance row — `sourceKind` chip + `sourceRationale` + `sourceSignalIds.length`, above the reasoning summary, (c) Sources strip — `sourcesUsed[]` rendered as a Badge row below Bearish View (mirrors `/stocks/[symbol]`), (d) Parent thesis chip — when `parentThesisId` is set, "Replaces #abc12345" chip near the StatusPill. Also extended the `/api/theses/[id]/triggers` response + `TriggersResponse` type to include these fields. All four are gated on data presence so legacy/empty rows degrade cleanly. | Low (additive UI + API response) | **Shipped 2026-05-18** |

### Phase 1 finale — column drops (gated)

| PR | Scope | Risk | Status |
|---|---|---|---|
| **5** | Drop 6 legacy columns: `source`, `modelUsed`, `holdDuration`, `fullResearch`, `thoughtTrace`, `revalidationTriggers`. Remove final writes from `record_thesis` + server actions in the same change. Remove the legacy `fullResearch.scoring` fallback from `/api/theses/[id]/triggers`. | High (irreversible) | **Not started — gated on ≥7d soak after PRs 1-4 + PR-6 ship** |

### Phase 2 — Post-V2 consolidation (documented only)

Both PRs below fire ONLY after V2 Phase 1 has shipped and we've seen ≥30 days of `researchSections` quality across discovery + daily + tactical runs. If V2 quality lags, hold or rework. Listed here so a future session can pick up cold.

| PR | Scope | Risk | Status |
|---|---|---|---|
| **7** | Collapse `confidenceScore` onto `scoring.composite`. Drop the column. Rewrite the `place_trade` Layer-1 gate from `confidence ≥ minConfidence AND composite ≥ 7` to `composite ≥ minComposite`. Migrate `AgentConfig.minConfidence` → `AgentConfig.minComposite` (scale conversion: minComposite ≈ minConfidence × 0.1; verify per analyst). Update daily-run prompt to reference one number not two. Drop the confidence chip added in PR-6. | Medium-High | **Pending (post-V2, validation phase)** |
| **8** | Drop `thesisBullets`, `riskFlags`, `reasoningSummary`. Replace UI reads with `researchSections.{bullCase, bearCase, snapshot}`. Update the trade evaluator to grade against `researchSections.bullCase + .bearCase` instead of `thesisBullets + riskFlags`. Update tactical + daily-run prompt context to read from sections. | Medium-High | **Pending (post-V2, after PR-7 lands and soaks)** |

---

## 5. The four UI exposures (PR-6 specifics)

Where each lands on the sheet:

1. **Confidence Score chip** — header of the Composite Score section. Currently shows `Composite Score | 7/10`. Becomes `Composite Score | Confidence 76% · 7/10`. Both gate `place_trade` so they deserve top billing together.
2. **Provenance row** — small row above the Reasoning Summary paragraph. Format: `Sourced via WATCHLIST_REVIEW · 3 signals` where:
   - WATCHLIST_REVIEW is a Badge variant chip
   - hover/tap reveals the `sourceRationale` one-liner
   - "3 signals" links to a popover that lists the Signal IDs (clickable to /intelligence/signals/[id] in a follow-up)
3. **Sources strip** — new section below Bearish View. Label "Sources" + favicon row pulled from `sourcesUsed[]` (provider + url). Mirrors the strip on `/stocks/[symbol]` thesis rows. Hidden when sourcesUsed is empty.
4. **Parent thesis chip** — when `parentThesisId` is set, a small chip right below the StatusPill: `Replaces #abc12345` linking to the parent thesis. Crucial for direction-flip chains (LONG → INVALIDATED → fresh SHORT).

API contract — `/api/theses/[id]/triggers` response needs these new fields:
```ts
{
  // existing fields …
  confidenceScore: number,         // 0-100, agent's overall trade conviction
  sourceKind: string | null,       // ROUTED_SIGNAL | WEB_SEARCH | etc.
  sourceRationale: string | null,
  sourceSignalIds: string[],
  sourcesUsed: SourceItem[],       // [{ provider, title, url, publishedAt? }]
  parentThesisId: string | null,
}
```

`TriggersResponse` in [`ThesisTriggersSection.tsx`](../../components/agent/sheets/ThesisTriggersSection.tsx) extends accordingly.

---

## 6. Migration runtime notes

- **Migration application** — `prisma migrate dev` is broken in this repo ([TD-3](../TECH_DEBT.md)). Apply via Supabase MCP `apply_migration` or `prisma db execute`, then insert into `_prisma_migrations` manually with SHA-256 checksum of the SQL file. PR-1's migration followed this path on 2026-05-18.
- **Production DB** — Supabase project `zomxxtqiszpkqrjrqqat` (Hindsight). Each migration must be reviewed before it runs against prod.
- **Soak between PR-5 and Phase 2** — at least 7 days of clean daily runs (no errors in `record_thesis`, `update_thesis`, the trade evaluator, or any UI surface that reads Thesis) before the column-drop migration fires.

---

## See also

- [`docs/plans/THESIS_SCHEMA_AUDIT.md`](./THESIS_SCHEMA_AUDIT.md) — original field-by-field audit + Decision Fields synthesis-prompt block (this cleanup's basis)
- [`docs/plans/THESIS_RESEARCH_V2.md`](./THESIS_RESEARCH_V2.md) — RAG-based research rewrite; Phase 1 depends on this cleanup; Phase 2 of this doc depends on V2's `researchSections` quality
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — live thesis-system reference
- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle
- [`docs/TECH_DEBT.md`](../TECH_DEBT.md) — TD-3 (broken `migrate dev` workflow)
