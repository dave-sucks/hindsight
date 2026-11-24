/**
 * A fire on a watch with no view goes to the Writer, and no agent is asked.
 * Production rows: MA on 2026-10-09, a watch with no view and no claim, a
 * strength wake and a 45-day review clock; the wake fired at 13:30 UTC at
 * $575.85. It has no case for a run to judge, so the fire starts its write-up.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow } from "@/lib/replay";

const ANALYST = "cmmmh0wxu000004js7yoyzvlf";
const MA_ID = "cmum2tf9m000d04jfv0szuiap";
const WAKE = { id: "e3c45d50-56de-4a17-9bf1-91e9c69c56ee", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "strength", value: 0, settings: { window: "6M" } }, rationale: "(not kept)" };
const CLOCK = { id: "a2e0f9b5-8b48-4e7a-b91e-7bc2bb350006", action: "REVIEW", predicate: { watch: "repeat", value: 45 }, rationale: "(not kept)" };

const book = (direction: string | null) => ({
  thesis: [
    thesisRow({
      id: MA_ID,
      ticker: "MA",
      status: "WATCHING",
      direction,
      triggers: [WAKE, CLOCK],
      researchRun: { agentConfigId: ANALYST, agentConfig: { name: "Secular Compounder", setupIds: [], enabled: true } },
    }),
  ],
  agentConfig: [agentConfigRow({ id: ANALYST, name: "Secular Compounder", tradingEnvironment: "PAPER", enabled: true })],
  account: [accountRow({})],
});

async function fire(direction: string | null) {
  const db = prismaDouble(book(direction));
  let modelCalls = 0;
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  let returned: unknown;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/market-data/load-market-numbers", () => ({ loadMarketNumbers: async () => jest.requireActual("@/lib/agent/__fixtures__/market-numbers-standin").STANDIN_MARKET_NUMBERS }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn(async (e: { name: string; data: Record<string, unknown> }) => void sent.push(e)) },
    }));
    jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
    jest.doMock("@/lib/agent/model", () => ({ modelFor: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({ get_theses: { execute: async () => ({ ok: false }) } }) }));
    await import("@/lib/inngest/functions/tactical-run");
    returned = await handler!({
      event: { data: { thesisId: MA_ID, triggerId: WAKE.id, analystId: ANALYST, ticker: "MA", action: "REVIEW", firedPrice: 575.85 } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    }).catch((err: Error) => {
      // The doubled model writes no note, so the run ends failed and the function fails for a retry.
      if (err.name !== "NonRetriableError") throw err;
      return { failed: err.message };
    });
  });
  for (const m of ["ai", "@/lib/agent/model", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma", "@/lib/market-data/load-market-numbers"]) jest.dontMock(m);
  return { returned, modelCalls, sent, runs: (db.store.researchRun ?? []) as Array<Record<string, unknown>> };
}

describe("MA 2026-10-09: the strength wake fired on a watch with no view", () => {
  it("starts its write-up and asks no agent: one Writer run, sent as a refresh of this thesis", async () => {
    const r = await fire(null);
    expect(r.modelCalls).toBe(0);
    expect(r.returned).toMatchObject({ skipped: "no-view-watch", thesisId: MA_ID, triggerId: WAKE.id });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ mode: "THESIS_WRITER", status: "RUNNING", agentConfigId: ANALYST, source: "AGENT" });
    expect(r.runs[0].parameters).toMatchObject({ ticker: "MA", mode: "refresh", existingThesisId: MA_ID, dispatchedBy: "no-view-watch-fire" });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ name: "app/thesis.write.requested", data: { ticker: "MA", analystId: ANALYST, mode: "refresh", existingThesisId: MA_ID, childRunId: r.runs[0].id } });
    expect(String(r.sent[0].data.reason)).toBe("Sent to research when its trigger fired: MA is on the watchlist with no view yet.");
  });

  it("the same fire on MA with a view asks the agent, and sends nothing to the Writer", async () => {
    const r = await fire("LONG");
    expect(r.modelCalls).toBeGreaterThan(0);
    expect(r.sent.filter((e) => e.name === "app/thesis.write.requested")).toEqual([]);
    expect(r.runs.every((x) => x.mode !== "THESIS_WRITER")).toBe(true);
  });
});
