-- AlterTable: AnalystWatchlistItem — add missing metadata columns
-- These were defined in schema.prisma but never had a migration.
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "thesisDirection" TEXT;
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "targetPrice" DOUBLE PRECISION;
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "stopPrice" DOUBLE PRECISION;
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "conviction" INTEGER;
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "catalyst" TEXT;
