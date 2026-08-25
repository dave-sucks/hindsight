-- Drop Thesis.revalidationTriggers (DAV-195 L8).
--
-- The first attempt at triggers, from before Thesis.triggers existed. Its own
-- schema comment said "superseded by the structured triggers column below;
-- will be removed once all consumers migrate." They migrated. The column has
-- had zero readers outside generated Prisma client code since.
ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "revalidationTriggers";
