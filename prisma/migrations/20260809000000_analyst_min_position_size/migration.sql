-- Position-size FLOOR (`minPositionSize`) — the missing half of the sizing band.
--
-- Before this column the analyst config expressed sizing as ceilings only
-- (`maxPositionSize`, plus `realMaxPosition` on LIVE). Nothing stopped an
-- analyst from opening a position far below its intended size: PEAD Specialist
-- proposed a $3,566 HPE entry against a $14,000 ceiling, and Secular Compounder
-- opened a 1-share $922 LITE position against a $15,000 ceiling. The only
-- workaround was prose floors in `analystPrompt` — Layer 3 doing Layer 1's job.
--
-- DEFAULT 0 means "no floor", so every existing row keeps its current behavior
-- and no analyst starts refusing trades the morning this deploys. Owners opt in
-- per seat by setting a floor in the analyst Settings UI (Floor / Ceiling pair)
-- or via UPDATE. Enforced in place_trade Guardrail 5b, which REJECTS a
-- below-floor entry with the floor in the message rather than silently
-- resizing the order.

ALTER TABLE "AgentConfig"
    ADD COLUMN IF NOT EXISTS "minPositionSize" DOUBLE PRECISION NOT NULL DEFAULT 0;
