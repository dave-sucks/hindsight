-- =============================================================
-- DO NOT RUN. Kept for historical reference only.
--
-- Decision 2026-06-02 (see docs/GAPS.md → 2026-06-02 entry):
-- conviction is the writer's qualitative judgment, independent of
-- composite (that decoupling was the whole point of Gates A+B being
-- killed in PR #360). Deriving conviction from composite buckets
-- reintroduces the coupling the design specifically removed.
--
-- The right behavior: let conviction populate organically as the
-- thesis-writer touches each thesis on refresh / re-mint. The daily
-- run treats NULL conviction as "no signal" and falls back to
-- R/R math, which is the intended graceful degradation.
--
-- This script was applied once on 2026-06-02 and immediately
-- reverted (25 rows). The marker rationale
-- ("backfilled from composite on 2026-05-31") was wiped during
-- the revert; if you see it anywhere, that's a re-application.
-- =============================================================

-- Conviction Expression v4 — backfill for existing live rows.
-- See docs/plans/CONVICTION_EXPRESSION.md §3, §9.
--
-- ONE-SHOT SCRIPT. Run manually after the 20260531000000_thesis_conviction_v4
-- migration adds the three nullable columns.
--
-- Rules:
--   • Only LONG/SHORT WATCHING + ACTIVE get a backfilled conviction
--     (the only rows the daily-run reads as live).
--   • Conviction derived from scoring.composite:
--       composite ≥ 8 → HIGH    (NOT STRONG — STRONG requires explicit
--                                writer judgment + variantView, no auto-derive)
--       composite 6-7 → MEDIUM
--       composite < 6 → LOW
--   • convictionRationale = "backfilled from composite on 2026-05-31"
--     so the UI can distinguish derived defaults from writer-attested.
--   • variantView stays NULL — there's no honest auto-derive for "what
--     does consensus have wrong." Next writer refresh populates organically.
--   • PASS / PENDING / no-composite rows stay NULL on all three fields.
--   • INVALIDATED / CLOSED / SUPERSEDED / ARCHIVED rows stay NULL — they're
--     historical, the daily-run filters them out via the resolver anyway.
--
-- Pre-run check: 38 live rows expected (LONG WATCHING/ACTIVE + 1 SHORT WATCHING).
-- Verify counts before + after match.

-- Dry-run query (uncomment to preview affected row count without writing):
-- SELECT direction, status,
--   COUNT(*) AS would_update,
--   COUNT(*) FILTER (WHERE (scoring->>'composite')::numeric >= 8) AS to_HIGH,
--   COUNT(*) FILTER (WHERE (scoring->>'composite')::numeric BETWEEN 6 AND 7.9999) AS to_MEDIUM,
--   COUNT(*) FILTER (WHERE (scoring->>'composite')::numeric < 6) AS to_LOW
-- FROM "Thesis"
-- WHERE direction IN ('LONG', 'SHORT')
--   AND status IN ('WATCHING', 'ACTIVE')
--   AND conviction IS NULL
--   AND scoring IS NOT NULL
-- GROUP BY direction, status;

BEGIN;

UPDATE "Thesis"
SET
  conviction = CASE
    WHEN (scoring->>'composite')::numeric >= 8 THEN 'HIGH'
    WHEN (scoring->>'composite')::numeric >= 6 THEN 'MEDIUM'
    ELSE 'LOW'
  END,
  "convictionRationale" = 'backfilled from composite on 2026-05-31'
WHERE direction IN ('LONG', 'SHORT')
  AND status IN ('WATCHING', 'ACTIVE')
  AND conviction IS NULL
  AND scoring IS NOT NULL
  AND scoring->>'composite' IS NOT NULL;

-- Post-run verification (uncomment to validate after):
-- SELECT conviction, COUNT(*) FROM "Thesis"
--   WHERE direction IN ('LONG', 'SHORT')
--     AND status IN ('WATCHING', 'ACTIVE')
--   GROUP BY conviction ORDER BY conviction NULLS LAST;

COMMIT;
