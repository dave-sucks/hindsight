-- A refused trade is something the principal may want to do by hand. The
-- receipt kept only the one-line summary ("Trade blocked: $VST — below min
-- composite"); the full reason the tool gave the agent (the numbers) now
-- rides along so the Activity feed can show it.

ALTER TABLE "GateRejection" ADD COLUMN "detail" TEXT;
