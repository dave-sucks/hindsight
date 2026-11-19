-- The column #1036 took out of the schema: the triggers that come with a buy are written at the fill, not kept on the position.
ALTER TABLE "Position" DROP COLUMN IF EXISTS "buyTriggers";
