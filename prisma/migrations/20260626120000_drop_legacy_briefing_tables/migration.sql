-- P1-26: drop the dead per-analyst briefing tables (replaced by PortfolioDigest).
-- All code references removed in the same change. Podcast + intelligence-core untouched.
DROP TABLE IF EXISTS "AnalystBriefing";
DROP TABLE IF EXISTS "MorningBrief";
