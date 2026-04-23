-- Feeds: firm-aggregate subscription dimension on AgentConfig.
-- Values are canonical FEEDS (see lib/universe/feeds.ts) and mirror
-- Signal.aggregateType 1:1 so the router can do a direct membership check
-- (`analyst.feeds @> ARRAY[signal.aggregateType]`).
--
-- Composition: feeds is another Universe dimension — AND-joined with
-- sectors / industries / themes / marketCap. Empty array (default) =
-- no filter on the feeds dimension. Existing analysts opt in via the
-- AnalystConfigSheet UI or via builder/editor `suggest_config` proposals.

ALTER TABLE "AgentConfig"
    ADD COLUMN IF NOT EXISTS "feeds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
