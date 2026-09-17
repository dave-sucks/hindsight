-- The playbook's numbers as settings (DAV-273): per-setup overrides of the
-- catalog's numbers, edited on /settings/playbook. Additive; empty = the
-- catalog as written.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "setupOverrides" JSONB NOT NULL DEFAULT '{}';
