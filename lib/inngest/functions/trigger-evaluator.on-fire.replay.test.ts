/**
 * The five-minute check's own handler, per fire mode: a fire left for the next morning run is written
 * down and starts nothing; Send to Agent and Auto send the fire to the trigger run. IOT, PEAD Specialist,
 * held 300 @ $42.695 (production 2026-10-22): its $52 target review (stored REVIEW, now NEXT_MORNING)
 * and its $41.42 floor. Only the edges are doubled.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const AT = new Date("2026-10-22T15:00:00Z"); // 11:00 ET, a Thursday
const PEAD = "cmnhxpjio000004jvox6kl6c7";
const TARGET = { id: "56e86f78-7e31-43e0-b9c3-7445cc016c69", action: "REVIEW", predicate: { watch: "price", is: "above", value: 52 }, rationale: "Using $52 as the objective.", cooldownDays: 1 };
const FLOOR = { id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", action: "EXIT", predicate: { watch: "price", is: "below", value: 41.42 }, rationale: "Under the $41.42 floor.", cooldownDays: 0 };

async function pass(trigger: Record<string, unknown>, price: number) {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "iot", ticker: "IOT", status: "HOLDING", direction: "LONG", triggers: [trigger], researchRun: { agentConfigId: PEAD, agentConfig: { name: "PEAD Specialist", setupIds: [], enabled: true } } })],
    agentConfig: [agentConfigRow({ id: PEAD, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
    account: [accountRow({ triggers: [] })],
    position: [positionRow({ id: "pos_iot", analystId: PEAD, symbol: "IOT", avgCost: 42.695, peakPrice: 43.62, openedAt: new Date("2026-10-15T15:16:02Z") })],
  });
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  jest.useFakeTimers({
    now: AT,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith("/quote?symbol=") ? { data: { c: price, pc: price + 0.1, o: price + 0.1, dp: -0.2, t: Math.floor(AT.getTime() / 1000) } } : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ IOT: { close: price, high: price, low: price, volume: 1_000_000 } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({
        step: {
          run: async (_name: string, fn: () => Promise<unknown>) => fn(),
          sendEvent: async (_id: string, e: { name: string; data: Record<string, unknown> }) => void sent.push(e),
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  const rows = (db.store.thesisUpdate ?? []) as Array<Record<string, unknown>>;
  return { events: sent.filter((e) => e.name === "app/thesis.trigger.fired").map((e) => e.data.triggerId), firedRows: rows.filter((r) => r.type === "TRIGGER_FIRED").map((r) => r.triggerId) };
}

describe("where a fire goes", () => {
  it("IOT's live $52 review (now NEXT_MORNING) is written down for the morning run and starts nothing", async () => {
    expect(await pass({ ...TARGET, fireMode: "NEXT_MORNING" }, 52.4)).toEqual({ events: [], firedRows: [TARGET.id] });
  });

  it("the same review set to Send to Agent starts a trigger run", async () => {
    expect(await pass({ ...TARGET, fireMode: "ASK_NOW" }, 52.4)).toEqual({ events: [TARGET.id], firedRows: [] });
  });

  it("the floor set to Auto-sell goes to the trigger run's no-agent sale; left for the morning, it waits", async () => {
    expect((await pass({ ...FLOOR, fireMode: "DO_IT" }, 41.3)).events).toEqual([FLOOR.id]);
    expect(await pass({ ...FLOOR, fireMode: "NEXT_MORNING" }, 41.3)).toEqual({ events: [], firedRows: [FLOOR.id] });
  });
});
