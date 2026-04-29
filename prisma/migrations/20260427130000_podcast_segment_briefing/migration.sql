-- Phase 1 follow-up — segment-run briefing continuity.
--
-- Adds PodcastSegmentBriefing, the segment analog of AnalystBriefing.
-- Same role: a per-run recap that the next run reads for continuity.
-- Simpler than AnalystBriefing because segments don't have portfolio
-- state — just a narrative + follow-ups array.
--
-- complete_run's segment branch calls updateSegmentBriefing after a
-- segment run completes. The route's podcast-segment-run handler
-- threads the most recent briefing into the system prompt so the
-- agent has cross-episode memory.
--
-- Non-destructive. AnalystBriefing and trading data are untouched.
--
-- See docs/PODCAST_PLAN.md "Segment briefing continuity".

CREATE TABLE "PodcastSegmentBriefing" (
  "id"          TEXT PRIMARY KEY,
  "segmentId"   TEXT NOT NULL,
  "runId"       TEXT NOT NULL UNIQUE,
  "userId"      TEXT NOT NULL,
  "narrative"   TEXT NOT NULL,
  "followUps"   JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PodcastSegmentBriefing_segment_fkey"
    FOREIGN KEY ("segmentId") REFERENCES "PodcastSegment"("id") ON DELETE CASCADE,
  CONSTRAINT "PodcastSegmentBriefing_run_fkey"
    FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE
);

CREATE INDEX "PodcastSegmentBriefing_segment_generatedAt_idx"
  ON "PodcastSegmentBriefing" ("segmentId", "generatedAt");

CREATE INDEX "PodcastSegmentBriefing_userId_idx"
  ON "PodcastSegmentBriefing" ("userId");
