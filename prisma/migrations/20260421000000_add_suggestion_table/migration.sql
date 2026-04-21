-- Session C: self-improvement proposal loop.
-- One row per PENDING / APPROVED / DISMISSED / EXPIRED / SNOOZED proposal
-- emitted by the weekly self-improvement Inngest job. See
-- lib/inngest/functions/self-improvement-weekly.ts for the write path and
-- lib/actions/suggestion.actions.ts for the approve / dismiss / snooze
-- actions. No AgentConfig or Monitor mutation happens without user approval.

CREATE TABLE "Suggestion" (
    "id"            TEXT        PRIMARY KEY,
    "analystId"     TEXT        NOT NULL REFERENCES "AgentConfig"("id") ON DELETE CASCADE,
    "userId"        TEXT        NOT NULL,
    "kind"          TEXT        NOT NULL,
    "dedupeKey"     TEXT        NOT NULL,
    "title"         TEXT        NOT NULL,
    "rationale"     TEXT        NOT NULL,
    "evidence"      JSONB       NOT NULL,
    "proposedDiff"  JSONB       NOT NULL,
    "status"        TEXT        NOT NULL DEFAULT 'PENDING',
    "dismissReason" TEXT,
    "dismissNote"   TEXT,
    "sourceRunId"   TEXT,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"    TIMESTAMP(3),
    "resolvedBy"    TEXT
);

CREATE INDEX "Suggestion_analystId_status_idx"
    ON "Suggestion" ("analystId", "status");

CREATE INDEX "Suggestion_analystId_dedupeKey_status_idx"
    ON "Suggestion" ("analystId", "dedupeKey", "status");

CREATE INDEX "Suggestion_expiresAt_idx"
    ON "Suggestion" ("expiresAt");

-- Partial unique index: enforce "one open proposal per (analyst, dedupeKey)"
-- at the DB layer. Code-level dedup in persistSuggestions is best-effort —
-- Inngest step replays or concurrent runs could race past the SELECT check
-- and emit duplicate PENDING rows. This constraint turns that race into a
-- P2002 unique violation that persistSuggestions catches and counts as
-- skippedDuplicate. APPROVED / DISMISSED / EXPIRED rows are unconstrained
-- so resolved history can contain the same key multiple times.
CREATE UNIQUE INDEX "Suggestion_analystId_dedupeKey_active_uniq"
    ON "Suggestion" ("analystId", "dedupeKey")
    WHERE status IN ('PENDING', 'SNOOZED');
