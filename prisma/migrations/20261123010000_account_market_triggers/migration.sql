-- The account's own triggers, on the market (lib/agent/triggers/market.ts):
-- the same Trigger[] shape as Account.triggers, in a column no stock's ladder
-- reads. Every account, old and new, starts with the one rule: a fall of 2%
-- in the S&P on the day starts one Portfolio Manager run for the account.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "marketTriggers" JSONB NOT NULL DEFAULT '[{"id":"market-fall","predicate":{"watch":"market","is":"below","value":2},"action":"RUN_PORTFOLIO_MANAGER","rationale":"A broad fall moves every holding at once, so the whole account gets a look the same day.","source":"DEFAULT"}]';
