-- DAV-237: delete Thesis.targetSizePct — the agent's own "% of portfolio".
--
-- Nothing that moved money read it. place_trade sized every order from the
-- agent's `notional` and clamped it to the analyst's band; the percent only
-- fed two refusal gates (record_thesis / update_thesis) and a prompt line
-- telling the model how to pick it. The size of a new position now comes
-- from the analyst's own settings, placed by conviction (smallest trade
-- normally, largest on STRONG/HIGH) — see entrySizeForConviction in
-- lib/agent/position-sizing.ts.

ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "targetSizePct";
