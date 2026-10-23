/**
 * A paused analyst's sale goes to the owner, never to the agent. Production rows: Momentum Breakout (paused)
 * held MRVL 13 @ $293.98 on paper with a $256.50 floor and a $330 target, both now Send to Agent. Paper
 * approvals are off, so only the forced proposal stops a "Send to Agent" sale from executing unasked.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";
import { PAUSED_SALE_NOTE } from "@/lib/agent/triggers/paused";

const MOMENTUM = "cmmofy6t3000004l7858o1xma";
const FLOOR = { id: "22efb89a-f05c-4b5a-97ab-ec40a4abc244", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 256.5 }, rationale: "Tight stop at $256.5. Trade-horizon — get out fast on invalidation.", cooldownDays: 0 };
const TARGET = { id: "0e314b2e-72d9-462d-85e3-00be5039432d", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "above", value: 330 }, rationale: "Target $330 hit. Trade plan executed; close.", cooldownDays: 0 };
const REVIEW = { id: "f83c2f9f-a06b-45d0-b122-cc52c02f300d", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "surprise", is: "beat", value: 0 }, rationale: "Beat — possibly the catalyst.", cooldownDays: 7 };

const book = (triggers: Record<string, unknown>[], enabled = false) => ({
  thesis: [
    thesisRow({
      id: "cmqeiw4pa000504l849bdj8n7",
      ticker: "MRVL",
      status: "HOLDING",
      direction: "LONG",
      triggers,
      researchRun: { agentConfigId: MOMENTUM, agentConfig: { name: "Momentum Breakout", setupIds: [], enabled } },
    }),
  ],
  position: [positionRow({ id: "cmqf9avuh000604jya2yocv6z", symbol: "MRVL", analystId: MOMENTUM, environment: "PAPER", quantity: 13, avgCost: 293.98 })],
  agentConfig: [agentConfigRow({ id: MOMENTUM, name: "Momentum Breakout", tradingEnvironment: "PAPER", enabled })],
  account: [accountRow({ requireApprovalBuysPaper: false, requireApprovalSellsPaper: false })],
});

async function fire(trigger: Record<string, unknown>, firedPrice: number, seed = book([FLOOR, TARGET, REVIEW])) {
  const db = prismaDouble(seed);
  let modelCalls = 0;
  const closes: unknown[][] = [];
  let returned: unknown;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/actions/closeTrade.actions", () => ({ closeOpenPosition: jest.fn(async (...a: unknown[]) => (closes.push(a), { kind: "proposed" })) }));
    jest.doMock("@/lib/proposals/held-through-context", () => ({ heldThroughNoteForPosition: async () => null }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({ get_theses: { execute: async () => ({ ok: false }) } }) }));
    await import("@/lib/inngest/functions/tactical-run");
    returned = await handler!({
      event: { data: { thesisId: "cmqeiw4pa000504l849bdj8n7", triggerId: trigger.id, analystId: MOMENTUM, ticker: "MRVL", action: trigger.action, firedPrice } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
  });
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/actions/closeTrade.actions", "@/lib/proposals/held-through-context", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { returned, modelCalls, closes, runs: (db.store.researchRun ?? []) as Array<Record<string, unknown>> };
}

describe("a paused analyst's held stock", () => {
  it("MRVL's floor (Send to Agent) proposes the sale to the owner, always as a proposal, with no agent", async () => {
    const r = await fire(FLOOR, 255.9);
    expect(r.modelCalls).toBe(0);
    expect(r.closes).toHaveLength(1);
    const [positionId, reason, , source, rationale, , , opts] = r.closes[0];
    expect([positionId, reason, source]).toEqual(["cmqf9avuh000604jya2yocv6z", "STOP", "price_monitor"]);
    expect(rationale).toContain(PAUSED_SALE_NOTE);
    expect(opts).toEqual({ propose: true });
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE" });
  });

  it("the target sale set to Flag for Review goes the same way", async () => {
    const flagged = { ...TARGET, fireMode: "NEXT_MORNING" };
    const r = await fire(flagged, 331.2, book([FLOOR, flagged]));
    expect(r.modelCalls).toBe(0);
    expect(r.closes[0].slice(0, 2)).toEqual(["cmqf9avuh000604jya2yocv6z", "TARGET"]);
    expect(r.closes[0][7]).toEqual({ propose: true });
  });

  it("an Auto-sell keeps its own path: the approval switch decides", async () => {
    const auto = { ...FLOOR, fireMode: "DO_IT" };
    const r = await fire(auto, 255.9, book([auto]));
    expect(r.modelCalls).toBe(0);
    expect(r.closes[0][7]).toEqual({ propose: false });
  });

  it("a review on a paused analyst's stock starts nothing", async () => {
    const r = await fire(REVIEW, 300);
    expect(r.returned).toMatchObject({ skipped: "analyst-paused" });
    expect(r.modelCalls).toBe(0);
    expect(r.closes).toHaveLength(0);
    expect(r.runs).toHaveLength(0);
  });

  it("the same floor under an active analyst still asks the agent", async () => {
    const r = await fire(FLOOR, 255.9, book([FLOOR, TARGET], true));
    expect(r.modelCalls).toBeGreaterThan(0);
    expect(r.closes).toHaveLength(0);
  });
});
