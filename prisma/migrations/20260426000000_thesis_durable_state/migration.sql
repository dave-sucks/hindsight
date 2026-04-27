-- Thesis Durable State (PR 1 of 3)
--
-- Promotes Thesis from a one-shot per-run rationale to a durable coverage
-- object with explicit horizon, structured triggers, and a unified activity
-- log. Watchlist items will collapse into Thesis.status='WATCHING' in PR 3;
-- this migration only adds the column value so theses CAN be created in
-- that state — the AnalystWatchlistItem table is left untouched.
--
-- All changes are additive. Every new column is nullable or has a default.
-- Existing call paths (record_thesis, agent runs, dashboards) keep working
-- against the legacy field surface; new tools opt into the durable shape.
--
-- ── Why this shape ──────────────────────────────────────────────────────
-- See docs/AGENT_OVERHAUL_PLAN.md "Thesis-driven analyst architecture" and
-- the design discussion in PR description. Core insight: today's Thesis
-- is a TRADE rationale tied to a run; the new Thesis is a COVERAGE
-- rationale tied to an analyst, and runs WRITE updates to it instead of
-- replacing it.

-- ── ThesisStatus enum: add WATCHING ─────────────────────────────────────
-- Postgres requires ALTER TYPE for enum additions, must be in its own txn.
ALTER TYPE "ThesisStatus" ADD VALUE IF NOT EXISTS 'WATCHING';

-- ── Thesis: new lifecycle / pricing / triggers fields ───────────────────
ALTER TABLE "Thesis"
  -- Horizon dictates exit policy. Nullable because legacy rows predate it.
  --   CATALYST   = exit on catalyst event firing (good or bad), or 30d past
  --                catalystDate with no event. Bounded by catalystDate.
  --   TARGET     = exit when price hits target/stop, or thesis invalidated.
  --                Open-ended.
  --   TRADE      = exit on stop/target/maxHoldDays elapsed.
  --   COMPOUNDER = exit only when invalidation triggers fire. Never on price.
  ADD COLUMN "horizon"           TEXT,

  -- The actual claim, separate from the trade rationale. Free text — the
  -- agent reads this when re-evaluating. Often overlaps with reasoningSummary
  -- on first creation; diverges as the thesis evolves.
  ADD COLUMN "coreBelief"        TEXT,

  -- What has to be true for this thesis to work. Each item is a single
  -- premise the agent can later check against fresh signals.
  ADD COLUMN "keyAssumptions"    TEXT[]   DEFAULT ARRAY[]::TEXT[] NOT NULL,

  -- What would prove this wrong. Used by the housekeeping run and tactical
  -- mode to decide when a signal counts as thesis-breaking.
  ADD COLUMN "invalidationConds" TEXT[]   DEFAULT ARRAY[]::TEXT[] NOT NULL,

  -- Sizing intent at full position (% of portfolio). Separate from any
  -- current actual position size — captures what the analyst WANTS the
  -- position to be when the thesis is fully expressed.
  ADD COLUMN "targetSizePct"     DOUBLE PRECISION,

  -- Optional ladder for scaling in/out. Shape:
  --   [{ pct: 33, atPrice?, atSignal?, rationale }, ...]
  -- Stored as JSON so the predicate union can grow without migrations.
  ADD COLUMN "scalingPlan"       JSONB,

  -- Structured trigger array. Each entry:
  --   { id, predicate: TriggerPredicate, action, rationale, cooldownDays?,
  --     lastFiredAt? }
  -- TriggerPredicate is a discriminated union over PRICE_*, SIGNAL_TYPE,
  -- EARNINGS_*, FILING, TIME_ELAPSED, REVIEW_DATE_HIT, AND, OR. The router
  -- evaluates these deterministically; no LLM in the matching loop.
  -- See lib/agent/triggers/types.ts for the full shape.
  ADD COLUMN "triggers"          JSONB    DEFAULT '[]'::jsonb NOT NULL,

  -- CATALYST horizon only. When the catalyst event is expected.
  ADD COLUMN "catalystDate"      TIMESTAMP(3),

  -- TRADE horizon only. Default 14 enforced in the tool, not the column.
  ADD COLUMN "maxHoldDays"       INTEGER,

  -- When housekeeping should re-look at this thesis even with no trigger
  -- fire. Long-term theses get longer review intervals. Computed on
  -- create/update from horizon + reviewFrequency hints.
  ADD COLUMN "nextReviewAt"      TIMESTAMP(3),

  -- Mirror of invalidatedAt/invalidReason for the CLOSED state. CLOSED
  -- means "we exited the position based on this thesis"; INVALIDATED means
  -- "we no longer believe the thesis." A thesis can be CLOSED without
  -- being invalidated (e.g. target hit) or INVALIDATED without closing
  -- immediately (e.g. WATCHING thesis whose premise broke).
  ADD COLUMN "closedAt"          TIMESTAMP(3),
  ADD COLUMN "closeReason"       TEXT;

-- ── Indexes for the new query patterns ──────────────────────────────────
-- Tactical mode + housekeeping both filter by analyst (via researchRun ->
-- agentConfigId). Today there's an index on (userId, ticker, status) but
-- the new modes also want (status, nextReviewAt) for "what needs attention"
-- and (ticker, status) for "is there an open thesis on this name yet."
CREATE INDEX "Thesis_status_nextReviewAt_idx"
  ON "Thesis" ("status", "nextReviewAt");

CREATE INDEX "Thesis_ticker_status_idx"
  ON "Thesis" ("ticker", "status");

-- ── ThesisUpdate: unified activity log ──────────────────────────────────
-- One row per state change on a Thesis. Replaces the scattered history
-- across RunEvent.payload, parentThesisId chain walks, and Position events.
-- The thesis detail page renders this as a vertical timeline.
--
-- Captures CONTEXT AT THE TIME (priceAtTime, positionAtTime) so an entry
-- six months later still tells the operator "this is what we knew when we
-- made this call." That's the part you said was missing today.
CREATE TABLE "ThesisUpdate" (
  "id"             TEXT          NOT NULL,
  "thesisId"       TEXT          NOT NULL,
  "timestamp"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- "CREATED" | "UPDATED" | "TRIGGER_FIRED" | "REVIEWED" | "ACTED"
  --   | "INVALIDATED" | "CLOSED" | "SUPERSEDED" | "STATUS_CHANGED"
  -- Keep as TEXT (not enum) so we can extend without a migration.
  "type"           TEXT          NOT NULL,

  -- Diff payload. Shape:
  --   { fieldName: { from: <value>, to: <value> }, ... }
  -- Empty {} for CREATED rows (no prior state) and for REVIEWED rows
  -- where the agent looked but changed nothing.
  "fieldChanges"   JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Snapshot of context at the moment of this update. priceAtTime is the
  -- latest quote we could resolve for this ticker; positionAtTime is the
  -- analyst's actual position state ({qty, avgCost, unrealizedPnL}) or
  -- null if no position. Both nullable because not every code path can
  -- get them (e.g. agent may not have a fresh quote during housekeeping).
  "priceAtTime"    DOUBLE PRECISION,
  "positionAtTime" JSONB,

  -- Narrative. summary is one sentence ("Increased target to $247.35 after
  -- Q2 beat"); rationale is the agent's longer reasoning. summary feeds
  -- the timeline list view; rationale renders in the expanded entry.
  "summary"        TEXT          NOT NULL,
  "rationale"      TEXT,

  -- Links into the rest of the system. triggerId is the trigger that
  -- fired (set on TRIGGER_FIRED + ACTED). signalIds is whatever the
  -- agent cited in its reasoning. runId points at the ResearchRun (any
  -- mode — tactical, housekeeping, discovery, or legacy morning).
  -- tradeId is set if the update produced an actual trade.
  "triggerId"      TEXT,
  "signalIds"      TEXT[]        DEFAULT ARRAY[]::TEXT[] NOT NULL,
  "runId"          TEXT,
  "tradeId"        TEXT,

  CONSTRAINT "ThesisUpdate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ThesisUpdate_thesisId_fkey"
    FOREIGN KEY ("thesisId") REFERENCES "Thesis"("id") ON DELETE CASCADE,
  CONSTRAINT "ThesisUpdate_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL
);

-- Timeline render = "all updates for one thesis, newest first". Composite
-- index on (thesisId, timestamp DESC) keeps it cheap as the log grows.
CREATE INDEX "ThesisUpdate_thesisId_timestamp_idx"
  ON "ThesisUpdate" ("thesisId", "timestamp" DESC);

-- "What ran in this run" / "what did housekeeping touch today" queries.
CREATE INDEX "ThesisUpdate_runId_idx"
  ON "ThesisUpdate" ("runId");

-- "All TRIGGER_FIRED events across the book" / "all ACTED events for this
-- analyst's audit log."
CREATE INDEX "ThesisUpdate_type_timestamp_idx"
  ON "ThesisUpdate" ("type", "timestamp" DESC);

-- ── Backfill: write one CREATED row per existing Thesis ─────────────────
-- Without this the timeline is empty for every legacy thesis, which makes
-- the new UI useless on day 1. We synthesize a CREATED row from the
-- existing thesis fields. fieldChanges is left empty (CREATED = no prior
-- state); priceAtTime is entryPrice if we have it; rationale comes from
-- reasoningSummary. runId resolves through researchRunId.
INSERT INTO "ThesisUpdate" (
  "id", "thesisId", "timestamp", "type",
  "fieldChanges", "priceAtTime", "summary", "rationale",
  "signalIds", "runId"
)
SELECT
  -- cuid-ish: 'tlu_' + thesis id is unique because we only emit one
  -- CREATED row per thesis. Future updates use proper cuids.
  'tlu_create_' || t.id,
  t.id,
  t."createdAt",
  'CREATED',
  '{}'::jsonb,
  t."entryPrice",
  -- Single-sentence summary for the timeline list view.
  CASE
    WHEN t.direction = 'PASS' THEN 'Passed on ' || t.ticker
    ELSE t.direction || ' thesis on ' || t.ticker
         || ' at confidence ' || t."confidenceScore"
  END,
  t."reasoningSummary",
  COALESCE(t."sourceSignalIds", ARRAY[]::TEXT[]),
  t."researchRunId"
FROM "Thesis" t
ON CONFLICT ("id") DO NOTHING;

-- For theses whose status has already moved off ACTIVE, also write the
-- terminal-state row so the timeline isn't misleading. Use updatedAt as
-- the timestamp since we don't have a true "when did this transition
-- happen" record on legacy rows.
INSERT INTO "ThesisUpdate" (
  "id", "thesisId", "timestamp", "type",
  "fieldChanges", "summary", "rationale", "runId"
)
SELECT
  'tlu_term_' || t.id,
  t.id,
  COALESCE(t."invalidatedAt", t."updatedAt"),
  CASE t.status
    WHEN 'INVALIDATED' THEN 'INVALIDATED'
    WHEN 'SUPERSEDED'  THEN 'SUPERSEDED'
    WHEN 'CLOSED'      THEN 'CLOSED'
  END,
  '{}'::jsonb,
  CASE t.status
    WHEN 'INVALIDATED' THEN 'Thesis invalidated'
    WHEN 'SUPERSEDED'  THEN 'Replaced by newer thesis on ' || t.ticker
    WHEN 'CLOSED'      THEN 'Thesis closed'
  END,
  t."invalidReason",
  t."researchRunId"
FROM "Thesis" t
WHERE t.status IN ('INVALIDATED', 'SUPERSEDED', 'CLOSED')
ON CONFLICT ("id") DO NOTHING;
