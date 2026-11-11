-- The run page tells a run from before any model call was kept (no "request" row before it started) from one that kept none.
CREATE INDEX "RunMessage_role_createdAt_idx" ON "RunMessage"("role", "createdAt");
