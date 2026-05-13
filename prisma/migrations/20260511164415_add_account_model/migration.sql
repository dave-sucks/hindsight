-- Team Access — multi-tenant Account model.
--
-- 1. Create Account, AccountMembership, AccountInvite tables + MemberRole enum.
-- 2. Create one Account per existing User and link via OWNER membership.
--    Account.id is set equal to User.id so the backfill below is a 1:1 join.
-- 3. Add nullable accountId on every scoped data model.
-- 4. Backfill accountId = userId on every row (1:1 with the seeded accounts).
-- 5. Tighten accountId to NOT NULL.
--
-- See docs/TEAM_ACCESS_PLAN.md. Non-destructive: userId columns are kept
-- on every model for compatibility with existing query sites. They become
-- legacy/audit-only once the route migration in the next commit lands.

-- ─── 1. New tables and enum ────────────────────────────────────────────────

CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

CREATE TABLE "Account" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountMembership" (
  "id"        TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "role"      "MemberRole" NOT NULL DEFAULT 'VIEWER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountMembership_accountId_userId_key" ON "AccountMembership"("accountId", "userId");
CREATE INDEX "AccountMembership_userId_idx"   ON "AccountMembership"("userId");
CREATE INDEX "AccountMembership_accountId_idx" ON "AccountMembership"("accountId");

ALTER TABLE "AccountMembership"
  ADD CONSTRAINT "AccountMembership_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountMembership_userId_fkey"    FOREIGN KEY ("userId")
    REFERENCES "users"("id")   ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccountInvite" (
  "id"         TEXT NOT NULL,
  "accountId"  TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "role"       "MemberRole" NOT NULL DEFAULT 'VIEWER',
  "token"      TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountInvite_token_key" ON "AccountInvite"("token");
CREATE INDEX "AccountInvite_accountId_idx" ON "AccountInvite"("accountId");
CREATE INDEX "AccountInvite_token_idx"     ON "AccountInvite"("token");

ALTER TABLE "AccountInvite"
  ADD CONSTRAINT "AccountInvite_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2. Seed one Account per User + an OWNER membership ───────────────────
-- Account.id = User.id so backfills can join by id directly. The display
-- name defaults to the user's email; users can rename it later.

INSERT INTO "Account" ("id", "name", "createdAt", "updatedAt")
SELECT u."id", u."email", NOW(), NOW()
FROM "users" u
ON CONFLICT DO NOTHING;

INSERT INTO "AccountMembership" ("id", "accountId", "userId", "role", "createdAt")
SELECT gen_random_uuid()::text, u."id", u."id", 'OWNER', NOW()
FROM "users" u
ON CONFLICT DO NOTHING;

-- ─── 3. Add nullable accountId on every scoped data model ─────────────────

ALTER TABLE "AgentConfig"              ADD COLUMN "accountId" TEXT;
ALTER TABLE "ResearchRun"              ADD COLUMN "accountId" TEXT;
ALTER TABLE "Thesis"                   ADD COLUMN "accountId" TEXT;
ALTER TABLE "watchlist_items"          ADD COLUMN "accountId" TEXT;
ALTER TABLE "AnalystWatchlistItem"     ADD COLUMN "accountId" TEXT;
ALTER TABLE "Monitor"                  ADD COLUMN "accountId" TEXT;
ALTER TABLE "MorningBrief"             ADD COLUMN "accountId" TEXT;
ALTER TABLE "AnalystBriefing"          ADD COLUMN "accountId" TEXT;
ALTER TABLE "AccuracyReport"           ADD COLUMN "accountId" TEXT;
ALTER TABLE "Podcast"                  ADD COLUMN "accountId" TEXT;
ALTER TABLE "PodcastSegment"           ADD COLUMN "accountId" TEXT;
ALTER TABLE "PodcastSegmentBriefing"   ADD COLUMN "accountId" TEXT;
ALTER TABLE "Episode"                  ADD COLUMN "accountId" TEXT;
ALTER TABLE "SegmentTranscript"        ADD COLUMN "accountId" TEXT;
ALTER TABLE "Position"                 ADD COLUMN "accountId" TEXT;
ALTER TABLE "TradeDecision"            ADD COLUMN "accountId" TEXT;

-- ─── 4. Backfill accountId from userId (Account.id == User.id) ────────────
-- These updates rely on the 1:1 Account/User mapping seeded above.
-- For tables that scope by analystId, fall back via AgentConfig.userId.

UPDATE "AgentConfig"             SET "accountId" = "userId";
UPDATE "ResearchRun"             SET "accountId" = "userId";
UPDATE "Thesis"                  SET "accountId" = "userId";
UPDATE "watchlist_items"         SET "accountId" = "user_id";
UPDATE "AnalystWatchlistItem"    SET "accountId" = "userId";
UPDATE "AnalystBriefing"         SET "accountId" = "userId";
UPDATE "AccuracyReport"          SET "accountId" = "userId";
UPDATE "Podcast"                 SET "accountId" = "userId";
UPDATE "PodcastSegment"          SET "accountId" = "userId";
UPDATE "PodcastSegmentBriefing"  SET "accountId" = "userId";
UPDATE "Episode"                 SET "accountId" = "userId";
UPDATE "SegmentTranscript"       SET "accountId" = "userId";
UPDATE "Position"                SET "accountId" = "userId";
UPDATE "TradeDecision"           SET "accountId" = "userId";

-- Monitor + MorningBrief scope via the analyst. Resolve through AgentConfig.
UPDATE "Monitor" m
SET "accountId" = ac."accountId"
FROM "AgentConfig" ac
WHERE m."analystId" = ac."id" AND m."accountId" IS NULL;

UPDATE "MorningBrief" b
SET "accountId" = ac."accountId"
FROM "AgentConfig" ac
WHERE b."analystId" = ac."id" AND b."accountId" IS NULL;

-- FIRM-scope monitors (analystId is NULL) attach to the single existing
-- account so they're addressable. Safe because clean-slate has exactly
-- one Account; revisit if/when multi-tenant FIRM monitors are real.
UPDATE "Monitor"
SET "accountId" = (SELECT "id" FROM "Account" LIMIT 1)
WHERE "accountId" IS NULL;

-- ─── 5. Tighten accountId to NOT NULL ─────────────────────────────────────

ALTER TABLE "AgentConfig"            ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "ResearchRun"            ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Thesis"                 ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "watchlist_items"        ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "AnalystWatchlistItem"   ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Monitor"                ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "MorningBrief"           ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "AnalystBriefing"        ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "AccuracyReport"         ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Podcast"                ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "PodcastSegment"         ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "PodcastSegmentBriefing" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Episode"                ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "SegmentTranscript"      ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Position"               ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "TradeDecision"          ALTER COLUMN "accountId" SET NOT NULL;

-- ─── 6. Indexes on accountId ──────────────────────────────────────────────

CREATE INDEX "AgentConfig_accountId_idx"             ON "AgentConfig"("accountId");
CREATE INDEX "ResearchRun_accountId_idx"             ON "ResearchRun"("accountId");
CREATE INDEX "Thesis_accountId_idx"                  ON "Thesis"("accountId");
CREATE INDEX "Thesis_accountId_ticker_status_idx"    ON "Thesis"("accountId", "ticker", "status");
CREATE INDEX "watchlist_items_accountId_idx"         ON "watchlist_items"("accountId");
CREATE INDEX "AnalystWatchlistItem_accountId_idx"    ON "AnalystWatchlistItem"("accountId");
CREATE INDEX "Monitor_accountId_idx"                 ON "Monitor"("accountId");
CREATE INDEX "MorningBrief_accountId_idx"            ON "MorningBrief"("accountId");
CREATE INDEX "AnalystBriefing_accountId_idx"         ON "AnalystBriefing"("accountId");
CREATE INDEX "AccuracyReport_accountId_idx"          ON "AccuracyReport"("accountId");
CREATE INDEX "Podcast_accountId_idx"                 ON "Podcast"("accountId");
CREATE INDEX "PodcastSegment_accountId_idx"          ON "PodcastSegment"("accountId");
CREATE INDEX "PodcastSegmentBriefing_accountId_idx"  ON "PodcastSegmentBriefing"("accountId");
CREATE INDEX "Episode_accountId_idx"                 ON "Episode"("accountId");
CREATE INDEX "SegmentTranscript_accountId_idx"       ON "SegmentTranscript"("accountId");
CREATE INDEX "Position_accountId_idx"                ON "Position"("accountId");
CREATE INDEX "Position_accountId_status_idx"         ON "Position"("accountId", "status");
CREATE INDEX "TradeDecision_accountId_idx"           ON "TradeDecision"("accountId");
