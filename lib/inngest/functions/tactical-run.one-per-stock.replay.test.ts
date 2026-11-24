/**
 * One trigger run per stock at a time, on ADI's real morning.
 *
 * ADI (PEAD Specialist, LIVE), 2026-11-24: "Review if on the day of earnings" fired at 9:30:20 and the
 * account's "Review if below 7% from yesterday's close" at 9:30:24. Each started a run. The first stopped
 * watching ADI at 9:30:39; the second, running beside it, could no longer write on the stock and failed.
 * The function allowed 4 runs per stock at once. With one, the second waits, then finds ADI gone and stops.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow } from "@/lib/replay";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const ADI = "cmwle5dx5000r08l55dtoql3n";
const DROP = { id: "31a3d2f7-346f-4c93-8ee0-824607812a35", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "move", is: "below", value: -7 }, rationale: "A sharp drop." };

async function load() {
  const db = prismaDouble({
    // As the first run left it: retired at 9:30:39.
    thesis: [thesisRow({ id: ADI, ticker: "ADI", status: "RETIRED", direction: "LONG", triggers: [DROP], researchRun: { agentConfigId: PEAD } })],
    agentConfig: [agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE" })],
    account: [accountRow({})],
  });
  let config: { concurrency?: unknown } | undefined;
  let modelCalls = 0;
  let returned: unknown;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (c: typeof config, _t: unknown, fn: typeof handler) => ((config = c), (handler = fn), {}), send: jest.fn() } }));
    jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
    jest.doMock("@/lib/agent/model", () => ({ modelFor: () => ({}) }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
    await import("@/lib/inngest/functions/tactical-run");
    returned = await handler!({
      event: { data: { thesisId: ADI, triggerId: DROP.id, analystId: PEAD, ticker: "ADI", action: "REVIEW", firedPrice: 196.4 } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
  });
  for (const m of ["ai", "@/lib/agent/model", "@/lib/agent/tools", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { config, modelCalls, returned, runs: db.store.researchRun ?? [] };
}

describe("two triggers on one stock at once", () => {
  it("run one at a time per stock", async () => {
    const { config } = await load();
    expect(config?.concurrency).toEqual({ limit: 1, key: "event.data.thesisId" });
  });

  it("the second, starting after the first stopped watching ADI, ends there: no run, no model call", async () => {
    const { returned, modelCalls, runs } = await load();
    expect(returned).toEqual({ skipped: "context-not-loadable", thesisId: ADI });
    expect(modelCalls).toBe(0);
    expect(runs).toHaveLength(0);
  });
});
