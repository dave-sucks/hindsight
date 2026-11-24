/**
 * after-buy-run — the run after a buy or an add fills, one per filled order
 * (lib/proposals/after-buy.ts sends the event from every fill). The fill has
 * put on the floor; this run puts on the holding's other triggers and writes
 * the trade's note when nobody has. A run that fails leaves the floor as it is.
 */
import type { ToolSet } from "ai";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { runAgentAsRun } from "@/lib/agent/engine/run";
import { AFTER_BUY, AFTER_BUY_ASK } from "@/lib/agent/engine/agents/after-buy";
import { pullThesisData } from "@/lib/agent/thesis-research/pull-data";
import { NonRetriableError } from "inngest";
import { BUY_FILLED, afterBuyDoneBy, afterBuyMessage, buyLeft, loadAfterBuyFacts, tellBuy } from "@/lib/proposals/after-buy";
import { retryThenTell } from "@/lib/inngest/retry-then-tell";
import { putNotesOnRunProposals, sendNoteWritten } from "@/lib/proposals/auto-writeup";

/**
 * Runs After the buy on one filled order; a fill it isn't for, or one whose run did its work, is skipped. A fill
 * reported twice runs once: a second report finds the first run, and a failed one is the failure handler's to try again.
 */
export async function runAfterBuy(orderId: string, retry = false): Promise<{ skipped: string } | { runId: string; status: string; noted: boolean }> {
  const facts = await loadAfterBuyFacts(orderId);
  if (!facts) return { skipped: "not a filled buy or add on a stock we hold" };
  const done = await afterBuyDoneBy(orderId);
  if (done) return { skipped: `already run (${done})` };
  if (!retry && (await prisma.researchRun.count({ where: { mode: "AFTER_BUY", parameters: { path: ["orderId"], equals: orderId } } })) > 0) {
    return { skipped: "a run on this order failed; its retry runs it again" };
  }
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: facts.analystId },
    select: { id: true, userId: true, exclusionList: true, sectors: true, minPositionSize: true, maxPositionSize: true, maxPositionTotal: true, maxOpenPositions: true },
  });
  if (!analyst) return { skipped: "no analyst" };

  let noted = false;
  const run = await runAgentAsRun(
    {
      record: AFTER_BUY,
      mode: "AFTER_BUY",
      parameters: { ticker: facts.ticker, thesisId: facts.thesisId, orderId },
      args: async (_target, runId) => {
        const ctx = {
          runStock: { ticker: facts.ticker, thesisId: facts.thesisId, triggerId: "" },
          runId,
          userId: facts.userId,
          accountId: facts.accountId,
          analystId: analyst.id,
          runMode: "AFTER_BUY",
          watchlist: await getWatchlistSymbols(analyst.id),
          exclusionList: analyst.exclusionList ?? [],
          sectors: analyst.sectors ?? [],
          minPositionSize: Number(analyst.minPositionSize),
          maxPositionSize: Number(analyst.maxPositionSize),
          maxPositionTotal: Number(analyst.maxPositionTotal),
          maxOpenPositions: analyst.maxOpenPositions,
          alpacaCreds: (await resolveAlpacaCredentials(analyst.userId, facts.environment)) ?? undefined,
          runEnvironment: facts.environment,
        };
        const pull = await pullThesisData(facts.ticker, ctx as never).catch(() => null);
        return {
          input: { now: new Date(), environment: facts.environment, message: afterBuyMessage(facts, AFTER_BUY_ASK) },
          subject: { kind: "thesis" as const, userId: facts.userId, accountId: facts.accountId, environment: facts.environment, analystId: analyst.id, ticker: facts.ticker, thesisId: facts.thesisId },
          given: pull ? { stockData: pull.rawDataBlock } : undefined,
          toolset: createResearchTools(ctx as never) as ToolSet,
          // A trade that has its note gets no write_note: the note is written once.
          wrapTools: facts.note ? (tools: ToolSet) => Object.fromEntries(Object.entries(tools).filter(([name]) => name !== "write_note")) as ToolSet : undefined,
          source: "after-buy-run",
        };
      },
      // The note this run wrote goes on the order, in place of the Auto trade's plain line.
      keep: async (runId) => {
        if (facts.note) return;
        noted = (await putNotesOnRunProposals({ runId, analystId: analyst.id, since: new Date(0), orderIds: [orderId] })).length > 0;
      },
    },
    { userId: facts.userId, accountId: facts.accountId, environment: facts.environment, analystId: analyst.id },
  );
  if (noted) await sendNoteWritten(orderId);
  return { runId: run.runId, status: run.status, noted };
}

export const afterBuyRun = inngest.createFunction(
  {
    id: "after-buy-run",
    name: "After the buy",
    // One at a time per order: a fill reported twice runs once, because the second finds the first finished.
    concurrency: { limit: 1, key: "event.data.orderId" },
    retries: 1,
    // A failed run is tried again, then the owner is told.
    onFailure: async ({ event, step }) =>
      retryThenTell(event.data.event as unknown as { name: string; data: { orderId: string }; ts?: number }, step as unknown as Parameters<typeof retryThenTell>[1], { left: buyLeft, tell: tellBuy }),
  },
  { event: BUY_FILLED },
  async ({ event, step }) => {
    const { orderId, recoveryTry } = event.data as { orderId?: string; recoveryTry?: number };
    if (!orderId) return { skipped: "no order" };
    const out = await step.run("after-buy", () => runAfterBuy(orderId, (recoveryTry ?? 0) > 0));
    if ("status" in out && out.status === "FAILED") throw new NonRetriableError(`After the buy run ${out.runId} failed`);
    return out;
  },
);
