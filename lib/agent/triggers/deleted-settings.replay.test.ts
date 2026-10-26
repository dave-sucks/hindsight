/**
 * Every setting a trigger carries is a field in the trigger form, or it doesn't
 * exist. The trail's arming gain and range widening (startOnceUpPct, widenAtr)
 * and the big-winner switch (fastWinnerPct, fastWinnerDays) are deleted; a
 * stored trigger that still carries one reads, fires and saves without it.
 *
 * V (Secular Compounder, LIVE): its "Review if above 4.6% from our entry"
 * (Flag for Review, 7-day wait, last fired 10-16) carries fastWinnerPct 10.
 * Bought at $369.25, its high since is $414.60 (+12.3%), so the switch kept the
 * review silent from 10-23. Now it fires at its level.
 *
 * Real rows and tape, through the read, the evaluator's pass and update_thesis.
 */
import { prismaDouble, replayTool, thesisRow, agentConfigRow, accountRow, positionRow, type PrismaDouble } from "@/lib/replay";
import { parseTriggersResilient } from "./schema";
import { sentenceOf } from "./condition";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const V_REVIEW = {
  id: "cf42e448-ec50-40b4-9c33-f1ee60e2522c", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING",
  predicate: { is: "above", value: 4.6, watch: "move", settings: { fastWinnerPct: 10 }, variable: "entry" },
  rationale: "Stock approaching the base pivot at $385.57: review the thesis.", lastFiredAt: "2026-10-16T19:50:10.623Z", cooldownDays: 7,
};
/** V's floor and target, so the plan a save checks is the real one. */
const V_PLAN = [
  { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { is: "below", value: 401.91, watch: "price" }, rationale: "The floor.", cooldownDays: 1 },
  { id: "203c3f47-82be-4411-a399-01d8a2c91278", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { is: "above", value: 434, watch: "price" }, rationale: "The target.", cooldownDays: 1 },
];
/** The PEAD seat's old trail, as a stored row still carries it. */
const OLD_TRAIL = { id: "f552414c-ff2a-455d-b779-d5401ac9ea98", action: "EXIT", source: "PRINCIPAL", predicate: { watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10, widenAtr: 3 } }, rationale: "Gave back 12% from the high.", cooldownDays: 0 };

const vThesis = () =>
  thesisRow({ id: "cmum3c2la000704l2nq4rgf8k", ticker: "V", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", setupId: "COMPOUNDER_ACCUMULATION", entryPrice: 369.2526, targetPrice: 434, stopLoss: 401.91, analystId: SECULAR, triggers: [V_REVIEW, ...V_PLAN], researchRun: { agentConfigId: SECULAR, agentConfig: { enabled: true, name: "Secular Compounder", setupIds: [] } } });
const vPosition = () =>
  positionRow({ id: "cmuvl5233000204jp3njifila", analystId: SECULAR, symbol: "V", quantity: 27, avgCost: 369.2526, environment: "LIVE", openedAt: new Date("2026-10-05T18:55:56.870Z"), peakPrice: 414.6, peakAt: new Date("2026-10-22T18:45:13.984Z"), troughPrice: 369.25, troughAt: new Date("2026-10-05T18:55:56.870Z") });

const FAKE = ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const;

async function pass(db: PrismaDouble, at: string, snapshots: Record<string, unknown>) {
  const sent: unknown[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    if (!path.endsWith("/snapshots")) throw new Error(`unexpected vendor call ${path}`);
    return { ok: true, status: 200, headers: new Headers(), json: async () => snapshots, text: async () => "" } as unknown as Response;
  });
  jest.useFakeTimers({ now: new Date(at), doNotFake: [...FAKE] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: unknown) => void sent.push(e) } });
    });
  } finally {
    jest.useRealTimers();
    jest.dontMock("@/lib/prisma");
    jest.dontMock("@/lib/inngest/client");
  }
  return sent;
}

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = OLD_ENV;
  jest.restoreAllMocks();
});

describe("a stored trigger still carrying a deleted key", () => {
  it("reads without it, and says only its number", () => {
    const { triggers } = parseTriggersResilient([V_REVIEW, OLD_TRAIL]);
    expect(triggers.map((t) => t.predicate)).toEqual([
      { is: "above", value: 4.6, watch: "move", variable: "entry" },
      { watch: "move", is: "below", value: 12, variable: "peak" },
    ]);
    expect(triggers.map((t) => sentenceOf(t, true))).toEqual(["Review if above 4.6% from our entry", "Sell if below 12% from the high since we bought"]);
  });

  it("V 10-26 09:30 ET at $405.73: the review fires at its level for the morning run, though V ran 12.3% off the buy", async () => {
    const db = prismaDouble({ account: [accountRow({ triggers: [] })], agentConfig: [agentConfigRow({ id: SECULAR, triggers: [] })], thesis: [vThesis()], position: [vPosition()] });
    const sent = await pass(db, "2026-10-26T14:30:05Z", {
      V: {
        latestTrade: { p: 405.725, t: "2026-10-26T14:30:00Z" },
        dailyBar: { t: "2026-10-26T04:00:00Z", o: 405.75, h: 407.53, l: 404.1901, c: 405.725 },
        prevDailyBar: { t: "2026-10-23T04:00:00Z", o: 410.59, h: 412.5801, l: 406.8, c: 407.92 },
      },
    });
    expect(sent).toEqual([]);
    const fired = (db.store.thesisUpdate as Array<Record<string, unknown>>).filter((u) => u.type === "TRIGGER_FIRED");
    expect(fired).toMatchObject([{ triggerId: V_REVIEW.id, summary: "Review if above 4.6% from our entry", priceAtTime: 405.725 }]);
  });

  it("an agent's edit saves it without the key", async () => {
    const { result, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [vThesis()], position: [vPosition()], agentConfig: [agentConfigRow({ id: SECULAR })] },
      args: { thesis_id: "cmum3c2la000704l2nq4rgf8k", price_at_time: 405.725, edit_triggers: [{ id: V_REVIEW.id, value: 6, rationale: "Moved up to the $391 pivot retest." }] },
      ctx: { analystId: SECULAR },
      quotes: { V: 405.725 },
    });
    expect((result.data as { trigger_ops?: Array<{ ok: boolean }> }).trigger_ops?.[0]?.ok).toBe(true);
    const stored = (db.store.thesis[0].triggers as Array<{ id: string; predicate: unknown }>).find((t) => t.id === V_REVIEW.id);
    expect(stored?.predicate).toEqual({ is: "above", value: 6, watch: "move", variable: "entry" });
  });
});
