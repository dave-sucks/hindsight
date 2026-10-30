-- The research brief was deleted from the code and the schema in #885
-- (2026-10-28): an Auto trade is now written up by the analyst, and nothing
-- reads or writes this table. Dropped in its own PR, after that one was live.
DROP TABLE IF EXISTS "ResearchBrief";
