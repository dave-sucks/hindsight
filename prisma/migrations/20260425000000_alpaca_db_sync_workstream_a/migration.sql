-- Alpaca↔DB sync — Workstream A schema (additive only).
-- See docs/ALPACA_DB_SYNC_DESIGN.md §4.1 and §7 step 1.
--
-- Adds:
--   1. SyncHealthSnapshot table — the heartbeat cron writes one row per run.
--   2. Order.idempotencyKey / intent / alpacaSubmittedAt / alpacaConfirmedAt
--      Plumbing for Workstream B's DB-first writes. All nullable so existing
--      callers and rows keep working unchanged. UNIQUE on idempotencyKey is
--      a partial index (only enforced where it's populated).
--   3. Order(status, createdAt) index — supports the "PENDING orders over SLA"
--      heartbeat check without a full table scan.
--
-- Rollback path: see migration_rollback.sql in the same dir.

-- ── SyncHealthSnapshot ──────────────────────────────────────────────────────
CREATE TABLE "SyncHealthSnapshot" (
    "id"                       TEXT          NOT NULL,
    "capturedAt"               TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orphansAlpacaNotInDb"     INTEGER       NOT NULL,
    "staleDbNotInAlpaca"       INTEGER       NOT NULL,
    "duplicateDbRows"          INTEGER       NOT NULL,
    "quantityMismatches"       INTEGER       NOT NULL,
    "pendingOrdersOverSla"     INTEGER       NOT NULL,
    "costBasisDriftDollars"    DOUBLE PRECISION NOT NULL,
    "affectedIds"              JSONB         NOT NULL,
    "alpacaAccountSnapshot"    JSONB         NOT NULL,
    CONSTRAINT "SyncHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SyncHealthSnapshot_capturedAt_idx"
    ON "SyncHealthSnapshot" ("capturedAt");

-- ── Order: idempotency + submit/confirm timestamps ──────────────────────────
ALTER TABLE "Order"
    ADD COLUMN "idempotencyKey"    TEXT,
    ADD COLUMN "intent"             TEXT,
    ADD COLUMN "alpacaSubmittedAt"  TIMESTAMP(3),
    ADD COLUMN "alpacaConfirmedAt"  TIMESTAMP(3);

-- Partial unique index: enforced only on rows that set the key. Legacy rows
-- (NULL key) are exempt, which is the property we want during the rollout.
CREATE UNIQUE INDEX "Order_idempotencyKey_key"
    ON "Order" ("idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL;

-- Heartbeat needs to find PENDING orders older than the SLA quickly.
CREATE INDEX "Order_status_createdAt_idx"
    ON "Order" ("status", "createdAt");

-- ── v_sync_health_now ───────────────────────────────────────────────────────
-- Single-row view: "is sync healthy right now?" Returns the latest snapshot
-- with an overall HEALTHY / DRIFT verdict. Used by /intelligence/health and
-- by humans running ad-hoc psql queries.
CREATE OR REPLACE VIEW "v_sync_health_now" AS
SELECT
    "capturedAt"                   AS "lastCheck",
    "orphansAlpacaNotInDb"         AS "orphans",
    "staleDbNotInAlpaca"           AS "stale",
    "duplicateDbRows"              AS "duplicates",
    "quantityMismatches"           AS "qtyMismatches",
    "pendingOrdersOverSla"         AS "stuckPending",
    "costBasisDriftDollars"        AS "costBasisDrift",
    CASE
        WHEN "orphansAlpacaNotInDb"
           + "staleDbNotInAlpaca"
           + "duplicateDbRows"
           + "quantityMismatches"
           + "pendingOrdersOverSla" = 0
         AND ABS("costBasisDriftDollars") < 1.00
        THEN 'HEALTHY'
        ELSE 'DRIFT'
    END                            AS "overall"
FROM "SyncHealthSnapshot"
ORDER BY "capturedAt" DESC
LIMIT 1;
