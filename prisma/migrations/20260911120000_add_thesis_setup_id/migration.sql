-- DAV-244: the buy pattern a thesis was written on (lib/agent/knowledge/setups.ts).
-- An add, so the two-PR column rule does not apply. Null on every existing row.
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "setupId" TEXT;
