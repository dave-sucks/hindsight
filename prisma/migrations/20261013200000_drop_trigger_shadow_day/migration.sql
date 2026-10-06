-- TriggerShadowDay held the counts of the new trigger checker run beside the
-- old one (docs/plans/TRIGGER_TYPES.md, PR 2). The cutover replaced the old
-- checker and stopped writing it; nothing has read or written it since.
DROP TABLE IF EXISTS "TriggerShadowDay";
