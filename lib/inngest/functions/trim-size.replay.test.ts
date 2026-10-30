/**
 * A trim's size is its size in every On fire mode.
 *
 * NVDA (PEAD, LIVE, 33 shares at $218.23) carried the setup's 2R partial,
 * "Trim if above 16.6% from our entry", written at the fill. Here the owner has
 * set its size to 30%. Auto sells 30%. Send to Agent tells the analyst
 * "Trim 30%", and its partial_close sells 30% unless the run names another
 * size. The morning run reads the same sentence on the stock's trigger line.
 *
 * Real handlers; the model is captured, never called.
 */
import { prismaDouble, replayTool, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";
import { triggerForAgent } from "@/lib/agent/triggers/format";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const TRIM = { id: "5fbb5cdb-e4b3-4559-8703-eaf75798ae79", action: "TRIM", source: "DEFAULT", predicate: { is: "above", value: 16.6, watch: "move", variable: "entry" }, rationale: "Up 16.6% from entry: 2R on a 8.3% stop.", cooldownDays: 7, trimPct: 30 };

const seed = (fireMode: string) => ({
  thesis: [thesisRow({ id: "cmtg9nbdy000204jpc6cwawgg", ticker: "NVDA", status: "HOLDING", direction: "LONG", horizon: "TARGET", analystId: PEAD, triggers: [{ ...TRIM, fireMode }] })],
  position: [positionRow({ id: "cmtha1mcg000804kyrns3lpjg", symbol: "NVDA", analystId: PEAD, environment: "LIVE", quantity: 33, initialQty: 33, avgCost: 218.2259, peakPrice: 255.1, openedAt: new Date("2026-08-31T13:53:39.975Z") })],
  agentConfig: [agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE" })],
  account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

/** One fire through the trigger run: the tools' context, the trade tool called, and what the model was told. */
async function fire(fireMode: string) {
  const db = prismaDouble(seed(fireMode));
  const told: string[] = [];
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const contexts: Array<Record<string, unknown>> = [];
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    jest.doMock("ai", () => ({
      generateText: jest.fn(async (a: { system?: string; prompt?: string }) => {
        told.push(String(a.system), String(a.prompt));
        return { steps: [], response: { messages: [] }, text: "" };
      }),
      stepCountIs: () => () => false,
    }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: (ctx: Record<string, unknown>) => {
        contexts.push(ctx);
        const tool = (name: string) => ({ execute: jest.fn(async (args: Record<string, unknown>) => (toolCalls.push({ tool: name, args }), { ok: true, summary: "Proposed" })) });
        return { manage_position: tool("manage_position"), get_theses: { execute: async () => ({ ok: false }) } };
      },
    }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({
      event: { data: { thesisId: "cmtg9nbdy000204jpc6cwawgg", triggerId: TRIM.id, analystId: PEAD, ticker: "NVDA", action: "TRIM", firedPrice: 254.6 } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
  });
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { told: told.join("\n"), toolCalls, contexts };
}

/** The real manage_position partial_close, in a trigger run woken (or not) by the trim. */
async function trim(args: Record<string, unknown>, firedTrim?: { ticker: string; pct: number }) {
  const { db } = await replayTool("manage-position", "managePosition", {
    seed: seed("ASK_NOW"),
    args: { symbol: "NVDA", action: "partial_close", reason: "Up 16.6% from the buy at 2R: selling part into strength and keeping the rest on the trail.", ...args },
    ctx: { analystId: PEAD, runMode: "INTRADAY_TACTICAL", runEnvironment: "LIVE", ...(firedTrim ? { firedTrim } : {}) },
    quotes: { NVDA: 254.6 },
    mocks: { "@/lib/notify/proposal-push": () => ({ sendProposalPendingPush: async () => undefined }), "@/lib/emails/proposal-pending": () => ({ sendProposalPendingEmail: async () => undefined }) },
  });
  for (const m of ["@/lib/prisma", "@/lib/alpaca", "@/lib/actions/finnhub.actions", "@/lib/agent/research-helpers", "@/lib/inngest/client", "@/lib/notify/proposal-push", "@/lib/emails/proposal-pending"]) jest.dontMock(m);
  return (db.store.order as Array<{ intent: string; quantity: number; status: string }>).filter((o) => o.intent === "PARTIAL_CLOSE");
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("NVDA's trim, sized 30%, in every mode", () => {
  it("Auto sells 30% with no analyst deciding; the analyst is then asked to write it up, not to decide", async () => {
    const r = await fire("DO_IT");
    expect(r.toolCalls).toEqual([{ tool: "manage_position", args: expect.objectContaining({ symbol: "NVDA", action: "partial_close", close_pct: 30 }) }]);
    expect(r.told).toContain("THE WRITE-UP");
    expect(r.told).not.toContain("DECISION FRAMEWORK");
  });

  it("Send to Agent tells the analyst \"Trim 30%\", and its tools carry the size", async () => {
    const r = await fire("ASK_NOW");
    expect(r.told).toContain("Trim 30% if above 16.6% from our entry");
    expect(r.told).toContain("declared action: TRIM 30% of the position");
    expect(r.contexts.at(-1)).toMatchObject({ firedTrim: { ticker: "NVDA", pct: 30 } });
  });

  it("the run's partial_close with no size sells 30% (9 of 33 shares); a size it names stands; with no trim behind it, half", async () => {
    expect(await trim({}, { ticker: "NVDA", pct: 30 })).toMatchObject([{ quantity: 9, status: "AWAITING_APPROVAL" }]);
    expect(await trim({ close_pct: 50 }, { ticker: "NVDA", pct: 30 })).toMatchObject([{ quantity: 16 }]);
    expect(await trim({})).toMatchObject([{ quantity: 16 }]);
  });

  it("Flag for Review: the morning run's trigger line says the size", () => {
    expect(triggerForAgent({ ...TRIM, fireMode: "NEXT_MORNING" }, true).says).toBe("Trim 30% if above 16.6% from our entry");
    expect(triggerForAgent({ ...TRIM, trimPct: undefined }, true).says).toBe("Trim 50% if above 16.6% from our entry");
  });
});
