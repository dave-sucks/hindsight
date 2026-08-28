-- GateRejection (DAV-219): telemetry for the write-tool rejection points.
-- Every refusal previously went to console.log and nowhere else, so "which
-- of the ~52 rules ever fire" was unanswerable. Written by the defineTool()
-- wrapper; nothing reads it to make a decision — pure instrumentation.
CREATE TABLE "GateRejection" (
    "id"        TEXT NOT NULL,
    "tool"      TEXT NOT NULL,
    "gateCode"  TEXT,
    "summary"   TEXT NOT NULL,
    "ticker"    TEXT,
    "runId"     TEXT,
    "analystId" TEXT,
    "runMode"   TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateRejection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GateRejection_tool_gateCode_createdAt_idx" ON "GateRejection"("tool", "gateCode", "createdAt" DESC);
CREATE INDEX "GateRejection_createdAt_idx" ON "GateRejection"("createdAt" DESC);
CREATE INDEX "GateRejection_runId_idx" ON "GateRejection"("runId");

-- RLS deny-all from day one (2026-06-10 lockdown policy: the anon key must see
-- nothing; Prisma connects directly and bypasses RLS).
ALTER TABLE "GateRejection" ENABLE ROW LEVEL SECURITY;
