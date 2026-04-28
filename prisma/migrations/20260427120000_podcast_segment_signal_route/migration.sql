-- Phase 1 follow-up — segment-aware signal routing.
--
-- Adds PodcastSegmentSignalRoute, the segment analog of
-- AnalystSignalRoute. signal-router writes rows of both types from a
-- single pass; read_signals branches on ToolContext.podcastSegmentId
-- to pick the right table. Same schema shape, same indexes.
--
-- Non-destructive. AnalystSignalRoute and trading data are untouched.
-- Trading runs continue to use AnalystSignalRoute exclusively.
--
-- See docs/PODCAST_PLAN.md "Signal pipeline reaches segments".

CREATE TABLE "PodcastSegmentSignalRoute" (
  "id"                TEXT PRIMARY KEY,
  "podcastSegmentId"  TEXT NOT NULL,
  "signalId"          TEXT NOT NULL,
  "relevanceScore"    INTEGER NOT NULL,
  "rawRelevanceScore" INTEGER,
  "noveltyScore"      INTEGER,
  "routeReason"       TEXT NOT NULL,
  "routeReasonCode"   TEXT,
  "matchedUniverse"   JSONB,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "tradingDay"        DATE,
  "routedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PodcastSegmentSignalRoute_segment_fkey"
    FOREIGN KEY ("podcastSegmentId") REFERENCES "PodcastSegment"("id") ON DELETE CASCADE,
  CONSTRAINT "PodcastSegmentSignalRoute_signal_fkey"
    FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "PodcastSegmentSignalRoute_segment_signal_key"
  ON "PodcastSegmentSignalRoute" ("podcastSegmentId", "signalId");

CREATE INDEX "PodcastSegmentSignalRoute_segment_status_idx"
  ON "PodcastSegmentSignalRoute" ("podcastSegmentId", "status");

CREATE INDEX "PodcastSegmentSignalRoute_segment_routedAt_idx"
  ON "PodcastSegmentSignalRoute" ("podcastSegmentId", "routedAt");

CREATE INDEX "PodcastSegmentSignalRoute_segment_routeReasonCode_routedAt_idx"
  ON "PodcastSegmentSignalRoute" ("podcastSegmentId", "routeReasonCode", "routedAt" DESC);

CREATE INDEX "PodcastSegmentSignalRoute_signal_idx"
  ON "PodcastSegmentSignalRoute" ("signalId");

CREATE INDEX "PodcastSegmentSignalRoute_segment_tradingDay_idx"
  ON "PodcastSegmentSignalRoute" ("podcastSegmentId", "tradingDay");
