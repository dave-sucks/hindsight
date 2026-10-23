-- Delete Position.nearTargetAlertSent — the flag behind the hourly job's
-- "80% to target" email, removed long ago. Nothing reads or writes it; the
-- field left prisma/schema.prisma one deploy earlier (step 1), so nothing
-- selects it when it goes.

ALTER TABLE "Position" DROP COLUMN IF EXISTS "nearTargetAlertSent";
