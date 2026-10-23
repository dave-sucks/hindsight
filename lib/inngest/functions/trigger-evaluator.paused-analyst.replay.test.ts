/**
 * The five-minute check on a paused analyst's stocks. Production rows: Momentum Breakout (paused) held MRVL
 * 13 @ $293.98 with a $256.50 floor (now Send to Agent). Before this, the check skipped every stock of a
 * paused analyst, so that floor would never fire. Now a held stock's sales are checked and nothing else is,
 * and a sale flagged for the morning run goes out now, since a paused analyst has no morning run.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const AT = new Date("2026-10-22T15:00:00Z"); // 11:00 ET, a Thursday
const MOMENTUM = "cmmofy6t3000004l7858o1xma";
const FLOOR = { id: "22efb89a-f05c-4b5a-97ab-ec40a4abc244", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 256.5 }, rationale: "Tight stop at $256.5. Trade-horizon — get out fast on invalidation.", cooldownDays: 0 };
const LOOK = { id: "look-260", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 260 }, rationale: "A look under $260.", cooldownDays: 1 };

async function pass(opts: { enabled: boolean; held: Record<string, unknown>[]; watched?: Record<string, unknown>[] }, price: number) {
  const run = { agentConfigId: MOMENTUM, agentConfig: { name: "Momentum Breakout", setupIds: [], enabled: opts.enabled } };
  const db = prismaDouble({
    thesis: [
      thesisRow({ id: "mrvl", ticker: "MRVL", status: "HOLDING", direction: "LONG", triggers: opts.held, researchRun: run }),
      ...(opts.watched ? [thesisRow({ id: "panw", ticker: "PANW", status: "WATCHING", direction: "LONG", triggers: opts.watched, researchRun: run })] : []),
    ],
    agentConfig: [agentConfigRow({ id: MOMENTUM, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: opts.enabled })],
    account: [accountRow({ triggers: [] })],
    position: [positionRow({ id: "pos_mrvl", analystId: MOMENTUM, symbol: "MRVL", avgCost: 293.98, quantity: 13, peakPrice: 299.5, openedAt: new Date("2026-06-15T13:49:53Z") })],
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
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({}) }));
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
  return { events: sent.filter((e) => e.name === "app/thesis.trigger.fired").map((e) => e.data.triggerId).sort(), firedRows: rows.filter((r) => r.type === "TRIGGER_FIRED").map((r) => r.triggerId) };
}

describe("the five-minute check, paused analyst", () => {
  it("MRVL's floor fires; the review on it and the watched stock's review are not checked", async () => {
    expect(await pass({ enabled: false, held: [FLOOR, LOOK], watched: [{ ...LOOK, id: "panw-look" }] }, 255.9)).toEqual({ events: [FLOOR.id], firedRows: [] });
  });

  it("a sale flagged for the morning run goes out now: there is no morning run", async () => {
    const flagged = { ...FLOOR, fireMode: "NEXT_MORNING" };
    expect(await pass({ enabled: false, held: [flagged] }, 255.9)).toEqual({ events: [FLOOR.id], firedRows: [] });
  });

  it("under an active analyst the same flagged sale still waits for the morning run, and the review fires", async () => {
    const flagged = { ...FLOOR, fireMode: "NEXT_MORNING" };
    expect(await pass({ enabled: true, held: [flagged, LOOK] }, 255.9)).toEqual({ events: [LOOK.id], firedRows: [FLOOR.id] });
  });
});
