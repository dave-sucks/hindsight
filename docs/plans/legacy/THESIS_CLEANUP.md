> **SHIPPED/SUPERSEDED — see [`../../THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md); kept as build history.**

# Hindsight — Thesis Surface Cleanup (tracker)

> **What this is:** delta + PR tracker for the Thesis schema, UI, and
> prompt-field cleanup done in prep for
> [Phase 1 of THESIS_RESEARCH_V2.md](../THESIS_RESEARCH_V2.md) (the
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
| **Phase 1.5 — UI exposure** | Surface canonical fields that exist on the row but aren't shown in the sheet (confidence, provenance, sources, parent chain). | PR-6 | **Shipped** |
| **Phase 1 finale — column drops** | DROP COLUMN for the 6 legacy fields once a soak proves nothing's reading them. | PR-5 | **Pending (gated on ≥7d soak)** |
| **Phase 2 — V2 schema (single-shot cutover)** | Flatten the 9-section research from a blob to 9 first-class columns. Rename + retype the 3 existing narrative fields (`reasoningSummary` → `snapshot`, `thesisBullets` → `bullCase`, `riskFlags` → `bearCase`) so the new rich content overwrites the shitty old content in the same place. Drop the residual duplicates (`confidenceScore`, `signalTypes`, `sourcesUsed`, `researchSections` blob). Migrate readers in the same wave. | PR-9 | **Pending — runs alongside V2 thesis-writer ship** |

---

## 1. The Phase 2 design (PR-9) — the important part

This supersedes the earlier "Phase 2 split into PR-7 + PR-8" plan. After a long
back-and-forth about why we'd write to a `researchSections` blob with 9 nested
sub-keys instead of just flattening, the answer was: **we wouldn't.** Single-shot
cutover, no transitional duplication.

### 1.1 What the V2 thesis-writer actually produces

The deep-research synthesis produces **9 narrative sections**, each with its
own content shape (text-with-citations OR bullets-with-citations):

1. **Snapshot** — 1 paragraph current-state framing
2. **Recent Catalysts** — 1 paragraph 1-2 week catalyst window
3. **Fundamentals** — 1 paragraph + segment breakdown narrative
4. **Latest Earnings** — 5 specific earnings-call-derived bullets
5. **Catalysts & Events** — 3-5 dated upcoming-catalyst bullets
6. **Bull Case** — 3-5 cited bullets
7. **Bear Case** — 3-5 cited bullets (mandatory even on LONG)
8. **Analyst Consensus** — 1 paragraph firm-by-firm synthesis
9. **Insider & Technical** — 1 paragraph insider activity + technical setup

### 1.2 The schema rewrite — 9 sections as 9 columns

The earlier plan (and the V2 plan as written) used a single `researchSections`
Json blob with 9 nested sub-keys. PR-9 flattens this: every section becomes its
own top-level column. Three of them **replace existing narrative fields** by
rename + retype.

**Three retypes** (existing narrative fields get the rich shape):

| Today | Becomes | Shape | What changes |
|---|---|---|---|
| `reasoningSummary` (String) | `snapshot` (Json) | `{ text, citations[] }` | Same field, richer shape with citations |
| `thesisBullets` (String[]) | `bullCase` (Json) | `{ bullets: [{ text, citation }] }` | Same field, citation per bullet |
| `riskFlags` (String[]) | `bearCase` (Json) | `{ bullets: [{ text, citation }] }` | Same field, citation per bullet |

**Six new** (sections that don't have an existing field today):

| New field | Shape | What it is |
|---|---|---|
| `recentCatalysts` | `{ text, citations }` | The 1-2 week catalyst window |
| `fundamentals` | `{ text, citations }` | Financials + segment narrative (NOTE: namespace freed by the `fullResearch` drop in PR-5) |
| `latestEarnings` | `{ bullets: [{ text, citation }] }` | 5 specific earnings-call-derived bullets |
| `catalystsAndEvents` | `{ bullets: [{ text, citation }] }` | 3-5 dated upcoming-catalyst bullets |
| `analystConsensus` | `{ text, citations }` | Firm-by-firm consensus narrative |
| `insiderTechnical` | `{ text, citations }` | Insider activity + technical setup |

**Four additional drops** (the consolidation work that motivated the original Phase 2):

| Field | Why dropped | Replaced by |
|---|---|---|
| `confidenceScore` (Int) | Duplicates `scoring.composite`. Both gate `place_trade`. One conviction number. | `scoring.composite` (the /10 setup grade with 4-dim breakdown) |
| `signalTypes` (String[]) | Just a taxonomy chip, derivable from `sourceSignalIds → Signal.aggregateType`. Not load-bearing for any agent decision. | (nothing — derivable when needed) |
| `sourcesUsed` (Json) | Mint-time analyst-cited URL list. Once V2 writes per-section citations in each of the 9 sections, this is redundant. | Per-section `citations[]` inside each new section |
| `researchSections` (Json blob) | The 9-sections-in-a-blob field added by the V2 plan and rendered as an accordion in PR-2. Replaced by 9 first-class columns. | The 9 individual columns above |

**Surviving research artifacts:**
- `researchData` — raw structured data block the synthesis consumed (audit/debug)
- `researchUpdatedAt` — staleness timestamp

### 1.3 Migration story — no backwards-compat trickery

Single migration, executed alongside the V2 thesis-writer ship:

```sql
-- Rename + retype: reasoningSummary → snapshot
ALTER TABLE "Thesis" ADD COLUMN "snapshot" JSONB;
UPDATE "Thesis"
  SET "snapshot" = jsonb_build_object(
    'text',      "reasoningSummary",
    'citations', '[]'::jsonb
  )
  WHERE "reasoningSummary" IS NOT NULL;
ALTER TABLE "Thesis" DROP COLUMN "reasoningSummary";

-- Rename + retype: thesisBullets → bullCase
ALTER TABLE "Thesis" ADD COLUMN "bullCase" JSONB;
UPDATE "Thesis"
  SET "bullCase" = jsonb_build_object(
    'bullets',
    (SELECT jsonb_agg(jsonb_build_object('text', b)) FROM unnest("thesisBullets") AS b)
  )
  WHERE "thesisBullets" IS NOT NULL AND array_length("thesisBullets", 1) > 0;
ALTER TABLE "Thesis" DROP COLUMN "thesisBullets";

-- Rename + retype: riskFlags → bearCase  (same shape as bullCase)
ALTER TABLE "Thesis" ADD COLUMN "bearCase" JSONB;
UPDATE "Thesis"
  SET "bearCase" = jsonb_build_object(
    'bullets',
    (SELECT jsonb_agg(jsonb_build_object('text', b)) FROM unnest("riskFlags") AS b)
  )
  WHERE "riskFlags" IS NOT NULL AND array_length("riskFlags", 1) > 0;
ALTER TABLE "Thesis" DROP COLUMN "riskFlags";

-- 6 new nullable section columns (no backfill — null until V2 refreshes the thesis)
ALTER TABLE "Thesis"
  ADD COLUMN "recentCatalysts"    JSONB,
  ADD COLUMN "fundamentals"       JSONB,
  ADD COLUMN "latestEarnings"     JSONB,
  ADD COLUMN "catalystsAndEvents" JSONB,
  ADD COLUMN "analystConsensus"   JSONB,
  ADD COLUMN "insiderTechnical"   JSONB;

-- Drop the blob field added by PR-1's V2 schema migration
ALTER TABLE "Thesis" DROP COLUMN "researchSections";

-- Drop the consolidation candidates
ALTER TABLE "Thesis"
  DROP COLUMN "confidenceScore",
  DROP COLUMN "signalTypes",
  DROP COLUMN "sourcesUsed";
```

Legacy theses keep their content (just rewrapped in the new shape with empty
`citations[]`). When V2 refreshes a thesis, it overwrites with the rich
version + citations + populates the 6 new sections.

### 1.4 Why flat over blob

The V2 plan originally proposed storing all 9 sections in a single JSONB column
(`researchSections.snapshot`, `researchSections.bullCase`, etc.). There are
three real reasons that design is defensible:

1. **Atomicity by shape.** All 9 sections come from one synthesis call. A
   single column makes "all 9 or nothing" visible — you can't accidentally
   end up with 5 sections from yesterday's call and 4 from today's.
2. **Extensibility without migrations.** If the section taxonomy evolves
   (someone adds "ESG" or "Geopolitical Exposure"), a blob accepts the new
   key without an ALTER TABLE.
3. **Writer convenience.** Synthesis emits one JSON object; persistence is
   one column write. No mapping between "what the model produced" and
   "where each piece goes."

Each is weak for our specific case:

1. Atomicity can be done with a Prisma transaction writing to 9 columns.
   Not a real differentiator.
2. The 9 sections are the structure of a standard equity research note —
   a stable, decades-old taxonomy. Extensibility for a stable shape is
   speculative value.
3. Developer convenience is a poor design rationale when the cost is
   schema clarity for every reader.

The decisive factor: **3 of the 9 sections directly overlap with 3 existing
fields** (`reasoningSummary` ≈ Snapshot, `thesisBullets` ≈ Bull Case,
`riskFlags` ≈ Bear Case). The blob design makes those overlaps look like
new concepts. The flat design makes them obvious — `bullCase` IS `thesisBullets`,
retyped. You're not adding a parallel system; you're upgrading existing fields
in place.

### 1.5 The writer doesn't care

The thesis-writer agent flow is the same either way: `write_thesis_research`
parses the synthesis into a structured sections object in memory, then the
agent calls `record_thesis` / `update_thesis` to persist. The only difference
is the tool's input schema — one nested arg vs. nine named args.

If anything, flat is easier on the writer:

- **Per-field zod validation.** A malformed `bearCase.bullets` rejects at
  the right level instead of "somewhere inside the blob."
- **Optional sections are clean.** A PASS thesis that doesn't need a Bull
  Case just omits the `bullCase` arg. With a blob, you'd construct
  `{ bullCase: null }` nested inside.
- **`update_thesis` patches are surgical.** Patching `bearCase: <new>` is
  one field. With a blob, you'd either replace the whole `researchSections`
  (losing the other 8) or build a merge.

No technical reason to prefer the blob. Token cost is a wash.

---

## 2. Target end state (after PR-5 + PR-9)

The final shape of `Thesis`. **41 scalar columns** (down from 47), grouped by
what they do.

### Identity & Lifecycle
| Field | Set by | Read by |
|---|---|---|
| `id`, `ticker`, `sector`, `researchRunId`, `userId`, `accountId`, `createdAt`, `updatedAt` | Prisma + writer | Everywhere |
| `direction` (PENDING / LONG / SHORT / PASS) | record_thesis · update_thesis (PENDING-promotion only) | Everywhere |
| `status` (WATCHING / ACTIVE / CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED) | record_thesis · update_thesis · place_trade · close_position | Everywhere |
| `parentThesisId` | record_thesis (`parent_thesis_id` arg) | UI chain chip · trade-evaluator |
| `invalidatedAt` / `invalidReason` · `closedAt` / `closeReason` | update_thesis · close_position | UI terminal-status Alert |
| `nextReviewAt` | record_thesis (derived from horizon) · update_thesis (REVIEWED-bump) | get_theses needsAction · overdue-review cron · UI |

### Trade structure (the decision)
| Field | Set by | Read by |
|---|---|---|
| `horizon` (CATALYST / TRADE / TARGET / COMPOUNDER) | Agent (record_thesis) | Daily-run prompt · trigger evaluator · trade evaluator · UI |
| `entryPrice` · `targetPrice` · `stopLoss` | Agent | Triggers · place_trade · position monitor · UI |
| `catalystDate` · `maxHoldDays` | Agent | Trigger defaults |
| `targetSizePct` · `scalingPlan` | Agent | place_trade sizing · UI |
| `scoring` (Json: `{ trendStrength, relativeStrength, entryQuality, catalystFreshness, composite }`) | Agent (record_thesis 4-dim self-grade) | **Daily-run `place_trade` hard gate (composite ≥ 7)** · Discovery prompt (composite ≥ 3 watchlist gate) · UI |

### Belief (the durable claim — short, falsifiable, structured)
| Field | Set by | Read by |
|---|---|---|
| `coreBelief` (1 sentence) | Agent at mint | **Tactical agent (verbatim into context on trigger fire)** · trade evaluator · UI |
| `keyAssumptions` (String[]) | Agent at mint | Daily-run · trade evaluator · UI |
| `invalidationConds` (String[]) | Agent at mint | Daily-run · trade evaluator · UI |

### Research narrative (the 9-section deep dossier — long, cited, written by V2)
| Field | Shape | What it is |
|---|---|---|
| `snapshot` | `{ text, citations[] }` | Current-state framing — 1 paragraph |
| `recentCatalysts` | `{ text, citations[] }` | 1-2 week catalyst window |
| `fundamentals` | `{ text, citations[] }` | Financials + segment narrative |
| `latestEarnings` | `{ bullets: [{ text, citation }] }` | 5 specific earnings-call bullets |
| `catalystsAndEvents` | `{ bullets: [{ text, citation }] }` | 3-5 dated upcoming catalysts |
| `bullCase` | `{ bullets: [{ text, citation }] }` | 3-5 bull bullets, mandatory |
| `bearCase` | `{ bullets: [{ text, citation }] }` | 3-5 bear bullets, mandatory even on LONG |
| `analystConsensus` | `{ text, citations[] }` | Firm-by-firm narrative |
| `insiderTechnical` | `{ text, citations[] }` | Insider activity + technical setup |
| `researchData` | Json (raw) | Structured-data block the synthesis consumed (audit/debug) |
| `researchUpdatedAt` | DateTime | Staleness gate — `>7d → dispatch refresh before place_trade` |

### Triggers (cron-deterministic predicates)
| Field | Set by | Read by |
|---|---|---|
| `triggers` (Json discriminated union) | record_thesis (defaults merged with agent extras) · update_thesis | **Trigger evaluator (cron — no LLM)** · daily-run needsAction · UI |

### Provenance
| Field | Set by | Read by |
|---|---|---|
| `sourceKind` (enum) | record_thesis (inferred or supplied) · server actions | UI provenance chip · hit-rate analytics |
| `sourceRationale` | Agent (when sourceKind is WEB_SEARCH/WATCHLIST_REVIEW/POSITION_REVIEW) | UI tooltip |
| `sourceSignalIds` (FK array into Signal table) | Agent (validated against AnalystSignalRoute) | Trade evaluator (credits Monitors on close) · UI |

### What does NOT survive

- `source` (legacy "AGENT"/"MANUAL"/"EDITOR") — dropped in PR-5; `sourceKind` replaces it
- `modelUsed` — dropped in PR-5; telemetry lives on `ResearchRun.mode`
- `holdDuration` — dropped in PR-5; derived from `horizon`
- `fullResearch`, `thoughtTrace`, `revalidationTriggers` — dropped in PR-5; dead columns
- `reasoningSummary` → renamed/retyped to `snapshot` in PR-9
- `thesisBullets` → renamed/retyped to `bullCase` in PR-9
- `riskFlags` → renamed/retyped to `bearCase` in PR-9
- `confidenceScore` — dropped in PR-9; `scoring.composite` is the single conviction number
- `signalTypes` — dropped in PR-9; derivable from `sourceSignalIds`
- `sourcesUsed` — dropped in PR-9; per-section citations cover it
- `researchSections` (blob) — dropped in PR-9; flattened to 9 individual columns

---

## 3. The sheet after PR-9

Top to bottom, no duplication:

1. **Status pill** + parent-chain chip if relevant
2. **Logo + ticker + live price + change**
3. **Headline** ("Watching for entry above $X")
4. **Provenance row** ("Sourced via X · N signals · rationale")
5. **Most recent trigger banner** (when present)
6. **Core Belief** box (one sentence)
7. **Key Assumptions** (≥2 bullets)
8. **Invalidation Conditions** (≥2 bullets)
9. **Composite Score** /10 + 4-dim breakdown
10. **Research Synthesis** — 9 collapsible sections (snapshot · recentCatalysts · fundamentals · latestEarnings · catalystsAndEvents · bullCase · bearCase · analystConsensus · insiderTechnical). Click any to expand.
11. **Price Targets** slider
12. **Triggers + Schedule**
13. **Activity log**

No more flat "Bullish View" / "Bearish View" / reasoning paragraph at the top —
they live inside the accordion as `bullCase` / `bearCase` / `snapshot` sections.
No more separate Confidence chip. No more separate Sources strip. No more
momentum tag.

---

## 4. Phase 1 — shipped PR sequence

| PR | Scope | Status |
|---|---|---|
| **1** | Schema additive — `scoring Json?` column. record_thesis writes to it. ThesisSheet reads it with `fullResearch.scoring` fallback. Backfill SQL applied 2026-05-18 (139 rows backfilled). | **Shipped 2026-05-18** |
| **2** | UI fixes — render `invalidationConds`, terminal-status Alert, `researchSections` accordion (gated on V2 data), drop the redundant intent line from `WatchingRow`, add `ThesisStatus.ARCHIVED` to the type + display registry, add `holdDurationFromHorizon()` helper. | **Shipped 2026-05-18** |
| **3** | `get_theses.include_research: boolean` (default false). | **Shipped 2026-05-18** |
| **4** | Drop `hold_duration` arg from `record_thesis` zod. Stop writing `fullResearch` from `record_thesis`. Derive `holdDuration` on the card-data assembly side so the legacy column can drop in PR-5. | **Shipped 2026-05-18** |
| **6** | Phase 1.5 — expose `confidenceScore`, provenance row, sources strip, parent thesis chip on the sheet. (Note: PR-9 then deletes `confidenceScore` + `sourcesUsed` once V2 ships and flattens the schema.) | **Shipped 2026-05-18** |

Shipped as [hindsight#286](https://github.com/dave-sucks/hindsight/pull/286).

## 5. PR-5 (gated — column drops)

Drops the 6 pure-legacy columns: `source`, `modelUsed`, `holdDuration`,
`fullResearch`, `thoughtTrace`, `revalidationTriggers`. Removes the final
writes from `record_thesis` + server actions. Removes the `fullResearch.scoring`
fallback from `/api/theses/[id]/triggers`.

**Status:** Not started. Gated on ≥7 days of clean daily runs after PR-286
merges (no errors in `record_thesis`, `update_thesis`, the trade evaluator, or
the ThesisSheet).

## 6. PR-9 (V2 schema cutover — pending)

The work in §1 above. Runs alongside the V2 thesis-writer ship.

**Order of operations:**
1. V2 thesis-writer agent is fully implemented (per `THESIS_RESEARCH_V2.md`
   Phase 1) but writes to the new flat columns (not the blob).
2. Migration runs (the SQL block in §1.3).
3. Readers cut over in the same release:
   - `trade-evaluator` reads `bullCase.bullets[*].text` + `bearCase.bullets[*].text`
     instead of `thesisBullets` + `riskFlags`
   - Daily-run prompt context reads `snapshot.text` instead of `reasoningSummary`
   - UI sheet drops the Bullish View / Bearish View / reasoning paragraph blocks;
     the 9-section accordion becomes the single source for narrative content
   - Confidence chip on Composite Score is removed (one conviction number)
   - Sources strip below Bearish View is removed (per-section citations cover it)
   - `signalTypes` "momentum" chip is removed
4. Agent prompt for V2 is written to emit the flat structure directly (no blob
   construction).
5. `THESIS_RESEARCH_V2.md` is updated to drop the `researchSections` blob design
   and reference this flat schema.

**Status:** Not started. Runs with V2 thesis-writer ship.

---

## 7. Migration runtime notes

- **Migration application** — `prisma migrate dev` is broken in this repo ([TD-3](../../TECH_DEBT.md)). Apply via Supabase MCP `apply_migration` or `prisma db execute`, then insert into `_prisma_migrations` manually with SHA-256 checksum of the SQL file. PR-1's migration followed this path on 2026-05-18.
- **Production DB** — Supabase project `zomxxtqiszpkqrjrqqat` (Hindsight). Each migration must be reviewed before it runs against prod.
- **PR-9 ordering** — the rename+retype migrations write the new column from the legacy column inside the same migration. The DROP happens at the end. So a single MCP `apply_migration` call is sufficient. Pre-PR-9 sanity check: confirm every code path that writes to `reasoningSummary` / `thesisBullets` / `riskFlags` has been updated to write `snapshot` / `bullCase` / `bearCase` instead — otherwise post-migration writes will fail.

---

## See also

- [`docs/plans/THESIS_SCHEMA_AUDIT.md`](./THESIS_SCHEMA_AUDIT.md) — original field-by-field audit + Decision Fields synthesis-prompt block
- [`docs/plans/THESIS_RESEARCH_V2.md`](../THESIS_RESEARCH_V2.md) — RAG-based research rewrite; PR-9 ships alongside its Phase 1. The V2 plan's `researchSections` blob design is superseded by the flat-column design in §1.2 above.
- [`docs/THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) — live thesis-system reference
- [`docs/PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle
- [`docs/TECH_DEBT.md`](../../TECH_DEBT.md) — TD-3 (broken `migrate dev` workflow)
