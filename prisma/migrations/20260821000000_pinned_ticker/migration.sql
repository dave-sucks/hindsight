-- PinnedTicker: the dashboard right-rail "Pinned" panel.
--
-- A pin is an attention marker, and attention outlives the episodes attached
-- to a name — the thesis retires, the position closes, the ticker doesn't. So
-- the pin hangs on the ticker and the row's content is resolved at render time
-- from the coverage data that already drives the table below the chart.
CREATE TABLE "PinnedTicker" (
    "id"        TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ticker"    TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedTicker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PinnedTicker_accountId_ticker_key" ON "PinnedTicker"("accountId", "ticker");
CREATE INDEX "PinnedTicker_accountId_sortOrder_idx" ON "PinnedTicker"("accountId", "sortOrder");

-- RLS deny-all from day one (2026-06-10 lockdown policy: the anon key must see
-- nothing; Prisma connects directly and bypasses RLS).
ALTER TABLE "PinnedTicker" ENABLE ROW LEVEL SECURITY;
