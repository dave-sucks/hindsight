-- The setups an analyst runs, as a setting on the analyst (DAV-280).
ALTER TABLE "AgentConfig" ADD COLUMN "setupIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The three live seats keep exactly what the code map gave them by name.
UPDATE "AgentConfig" SET "setupIds" = ARRAY['PEAD', 'EPISODIC_PIVOT', 'MA_PULLBACK'] WHERE name = 'PEAD Specialist' AND "setupIds" = ARRAY[]::TEXT[];
UPDATE "AgentConfig" SET "setupIds" = ARRAY['COMPOUNDER_ACCUMULATION', 'BASE_BREAKOUT', 'MA_PULLBACK'] WHERE name = 'Secular Compounder' AND "setupIds" = ARRAY[]::TEXT[];
UPDATE "AgentConfig" SET "setupIds" = ARRAY['PRE_CATALYST', 'BASE_BREAKOUT', 'MA_PULLBACK'] WHERE name = 'Catalyst Event PM' AND "setupIds" = ARRAY[]::TEXT[];
