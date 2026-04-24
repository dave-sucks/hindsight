-- V3 Fix 5 — Thesis provenance audit columns.
--
-- record_thesis already required provenance via a Zod superRefine + an
-- execute() gate, but today's runs showed 11 of 19 theses landed with
-- null sourceSignalIds because the prior inference fallback silently saved
-- with no provenance. The execute() gate now rejects that shape, but we
-- also need to persist the agent's declared source_kind and source_rationale
-- so "was provenance actually correct?" is a DB query, not a log scrape.
--
-- Additive only. Historical Thesis rows keep NULL sourceKind / sourceRationale.

ALTER TABLE "Thesis"
  ADD COLUMN "sourceKind" TEXT,
  ADD COLUMN "sourceRationale" TEXT;
