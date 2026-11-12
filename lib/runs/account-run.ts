/**
 * account-run.ts — a run made for the whole account with one model call (the
 * 8 PM Portfolio Digest): opened read only (READ_ONLY_RUN_MODES), its one
 * request and its thread kept on it, and closed COMPLETE, or FAILED when the
 * call failed (its record names the error). The run page shows the request as
 * chips (lib/agent/run-requests.ts).
 */
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { saveRequestRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { saveRunThread } from "@/lib/agent/run-thread";

export interface OneCall {
  /** The call's request, as sent. An `error` on it closes the run FAILED. */
  request: RequestRecord;
  /** The run's thread: the model's first message, then its reply. */
  thread: unknown[];
  /** A call of several steps (the Market Reviewer): every message after the first, and the steps they came from. */
  messages?: unknown[];
  steps?: Parameters<typeof saveRunThread>[1]["steps"];
}

/**
 * Open the run, make the call, keep what it sent and its thread, close the
 * run. With no owner on the account the call is made with no run. A call
 * that throws closes the run FAILED and throws on; nothing after the call
 * throws, so a step that wraps this is never retried into a second run.
 */
export async function runAccountCall<T extends OneCall>(
  run: { accountId: string; environment: string; mode: string; parameters?: Record<string, string> },
  call: (runId: string | null) => Promise<T>,
): Promise<T> {
  const userId = await getOwnerUserId(run.accountId);
  const runId = userId
    ? (
        await prisma.researchRun.create({
          data: { userId, accountId: run.accountId, source: "AGENT", status: "RUNNING", mode: run.mode, environment: run.environment, parameters: run.parameters ?? {} },
          select: { id: true },
        })
      ).id
    : null;
  let failed = true;
  try {
    const out = await call(runId);
    if (runId) {
      await saveRequestRecord(runId, out.request);
      await saveRunThread(runId, { opening: out.thread, messages: out.messages ?? [], steps: out.steps ?? [] }, out.request.source).catch((err) =>
        console.error(`[account-run] run ${runId}'s thread couldn't be saved:`, err instanceof Error ? err.message : err),
      );
    }
    failed = Boolean(out.request.error);
    return out;
  } finally {
    if (runId)
      await prisma.researchRun
        .update({ where: { id: runId }, data: { status: failed ? "FAILED" : "COMPLETE", completedAt: new Date() } })
        .catch((err) => console.warn(`[account-run] run ${runId} couldn't be marked done:`, err instanceof Error ? err.message : err));
  }
}
