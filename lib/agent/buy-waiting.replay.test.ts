/**
 * A buy fire while a buy on the same stock waits for approval starts no run.
 * MU, Secular Compounder, 2026-10-15: the chat proposed 11 shares at 10:59:59
 * ET (order cmv9o0njb000106lbg2ok0luk). At 11:01:31 "Buy if above $906" fired
 * at $909.51; the trigger run (cmv9o2mi7000006l5vwnn7hes) found the proposal,
 * did not duplicate it, and still moved the buy level to $908.72. The run is
 * the trigger run's real handler, the model captured, never called.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, planTriggers, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const THESIS = "cmv9nm3xo000o06l3om8r7ath";
const BUY = "9db623d8-7df0-48bb-b9ce-3968664813ae";

const seed = (orderStatus: string) => {
  const [buy, ...rest] = planTriggers({ entry: 906, target: 1500, stop: 850 });
  const position = positionRow({ id: "cmv9o0nhe000006lbmypszfe7", symbol: "MU", analystId: SECULAR, accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", status: orderStatus === "AWAITING_APPROVAL" ? "PENDING_APPROVAL" : "CANCELLED", quantity: 11, avgCost: 906.33 });
  return {
    thesis: [thesisRow({ id: THESIS, ticker: "MU", status: "WATCHING", direction: "LONG", analystId: SECULAR, entryPrice: 906, targetPrice: 1500, stopLoss: 850, triggers: [{ ...buy, id: BUY }, ...rest] })],
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: "LIVE", maxOpenPositions: 8, minConfidence: 70 })],
    account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
    position: [position],
    order: [{ id: "cmv9o0njb000106lbg2ok0luk", positionId: position.id, position, intent: "OPEN", status: orderStatus, quantity: 11, createdAt: new Date("2026-10-15T14:59:59Z") }],
  };
};

/** The trigger run's handler for the 11:01 fire: what it returned, and whether it reached the model. */
async function fire(orderStatus: string) {
  const db = prismaDouble(seed(orderStatus));
  let modelCalls = 0;
  let returned: unknown;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    await import("@/lib/inngest/functions/tactical-run");
    returned = await handler!({
      event: { data: { thesisId: THESIS, triggerId: BUY, analystId: SECULAR, ticker: "MU", action: "ENTER", predicateKind: "price", firedPrice: 909.51 } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
  });
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { returned, modelCalls, runs: (db.store.researchRun ?? []).length };
}

describe("MU 2026-10-15 11:01 — a buy fire while the chat's buy waits", () => {
  it("starts no run: the waiting buy is the answer", async () => {
    const { returned, modelCalls, runs } = await fire("AWAITING_APPROVAL");
    expect(returned).toEqual({ skipped: "buy-already-queued", thesisId: THESIS, orderId: "cmv9o0njb000106lbg2ok0luk" });
    expect(modelCalls).toBe(0);
    expect(runs).toBe(0);
  });

  it("once that buy is decided, the next fire runs as before", async () => {
    const { modelCalls } = await fire("REJECTED");
    expect(modelCalls).toBeGreaterThan(0);
  });
});
