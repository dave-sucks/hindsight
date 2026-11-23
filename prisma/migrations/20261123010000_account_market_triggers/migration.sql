-- The account's own triggers, on the market (lib/agent/triggers/market.ts):
-- the same Trigger[] shape as Account.triggers, in a column no stock's ladder
-- reads. Every account, old and new, starts with two rules: a fall of 2% in
-- the S&P on the day starts one Portfolio Manager run for the account, and so
-- does a rise of 2%. Two triggers, not one "either way": each fires and is
-- found false on a close by itself, so a rise the day after a fall still fires.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "marketTriggers" JSONB NOT NULL DEFAULT '[{"id":"market-fall","predicate":{"watch":"market","is":"below","value":2},"action":"RUN_PORTFOLIO_MANAGER","rationale":"A broad fall moves every holding at once, so the whole account gets a look the same day.","source":"DEFAULT"},{"id":"market-rise","predicate":{"watch":"market","is":"above","value":2},"action":"RUN_PORTFOLIO_MANAGER","rationale":"A broad rise sets off buys on several stocks at once, so the whole account gets a look the same day.","source":"DEFAULT"}]';
