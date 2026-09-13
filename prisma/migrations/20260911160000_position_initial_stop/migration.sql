-- DAV-248: the stop a position opened with (after any edit at approval). It
-- never moves, so R = gain ÷ (entry − initialStop) stays the risk actually
-- taken. Null on positions opened before this; the scorecard reads their
-- entry stop from the INITIATE TradeDecision text instead.
ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "initialStop" DOUBLE PRECISION;
