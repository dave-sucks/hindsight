-- Per-member email notification preferences on AccountMembership.
--
-- Before this migration every account email (proposal-pending, trade-opened,
-- trade-closed, daily run digest) was routed to the account OWNER only via
-- getOwnerUserId(). These columns let every member receive account emails,
-- with a per-member per-category opt-out managed on /settings/team.
-- Defaults are TRUE so existing members start receiving everything.

ALTER TABLE "AccountMembership"
  ADD COLUMN "emailTradeProposals" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailTradeActivity"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailDailyDigest"    BOOLEAN NOT NULL DEFAULT true;
