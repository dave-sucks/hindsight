/**
 * trigger-evaluator.one-bad-trigger.test.ts — a trigger the check can't read
 * costs that trigger, never the pass.
 *
 * The new checker decides now. If it throws on one trigger (an error in its
 * code, or numbers it doesn't expect), that trigger is logged with its id and
 * its stock and skipped; every other trigger, on the same stock and on the
 * rest of the book, is checked and fires as usual.
 *
 * This runs the evaluator's own cron handler with two held stocks the price
 * has broken down through: AAA with a trail and a floor the checker is made to
 * throw on, BBB with a floor. Only the edges are doubled: the database, the
 * quote, the day's bar, the earnings calendar, the SEC read and the snapshot.
 */
import {
  prismaDouble,
  thesisRow,
  agentConfigRow,
  accountRow,
  positionRow,
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
} from "@/lib/replay";

const AT = new Date("2026-10-06T15:00:00Z"); // 11:00 ET, a Tuesday
const PRICE = 90;
const BAD_LEVEL = 777;

const floor = (id: string, level: number) => ({
  id,
  action: "EXIT",
  rationale: "The floor: below it the plan is wrong.",
  predicate: { kind: "PRICE_BELOW", level },
  fireMode: "TACTICAL",
});

// 20% off the $125 high is $100: the $90 price is past it.
const trail = (id: string) => ({
  id,
  action: "EXIT",
  rationale: "Give back no more than a fifth from the high.",
  predicate: { kind: "TRAILING_FROM_HIGH", pct: 20 },
  fireMode: "TACTICAL",
});

async function pass() {
  const db = prismaDouble({
    thesis: ["AAA", "BBB"].map((ticker) =>
      thesisRow({
        id: `thesis_${ticker}`,
        ticker,
        status: "HOLDING",
        direction: "LONG",
        triggers: ticker === "AAA" ? [floor("aaa-bad", BAD_LEVEL), trail("aaa-trail")] : [floor("bbb-floor", 100)],
        researchRun: { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: "Replay", setupIds: [], enabled: true } },
      }),
    ),
    agentConfig: [agentConfigRow({ accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
    account: [accountRow({ triggers: [] })],
    position: ["AAA", "BBB"].map((symbol) =>
      positionRow({ id: `position_${symbol}`, analystId: REPLAY_ANALYST_ID, symbol, avgCost: 120, peakPrice: 125, openedAt: new Date("2026-09-01T14:00:00Z") }),
    ),
  });
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  const errors: string[] = [];
  const error = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));

  jest.useFakeTimers({
    now: AT,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({
        inngest: {
          createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => {
            handler = fn;
            return {};
          },
          send: jest.fn(),
        },
      }));
      // The checker throws on the one trigger set at the bad level, and reads every other one as it does.
      jest.doMock("@/lib/agent/triggers/condition/read", () => {
        const actual = jest.requireActual("@/lib/agent/triggers/condition/read");
        return {
          ...actual,
          SHAPE_CHECKER: {
            ...actual.SHAPE_CHECKER,
            holds: (p: { level?: number }, ctx: unknown) => {
              if (p.level === BAD_LEVEL) throw new Error("cannot read this trigger");
              return actual.SHAPE_CHECKER.holds(p, ctx);
            },
          },
        };
      });
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith("/quote?symbol=")
            ? { data: { c: PRICE, pc: 101, o: 99, dp: ((PRICE - 101) / 101) * 100, t: Math.floor(AT.getTime() / 1000) } }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({
        getTodaySessionBars: async () => ({
          AAA: { close: PRICE, high: 99, low: PRICE, volume: 1_000_000 },
          BBB: { close: PRICE, high: 99, low: PRICE, volume: 1_000_000 },
        }),
      }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({
        ...jest.requireActual("@/lib/agent/triggers/earnings"),
        fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }),
      }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({
        ...jest.requireActual("@/lib/market-data/sec-filings"),
        fetchBookFilings: async () => ({ byTicker: new Map() }),
      }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({
        step: {
          run: async (_name: string, fn: () => Promise<unknown>) => fn(),
          sendEvent: async (_id: string, e: { name: string; data: Record<string, unknown> }) => {
            sent.push(e);
          },
        },
      });
    });
  } finally {
    jest.useRealTimers();
    error.mockRestore();
  }
  return { sent, errors };
}

describe("one trigger the check can't read", () => {
  it("is logged with its id and stock, and every other trigger, on that stock and the next, still fires", async () => {
    const { sent, errors } = await pass();
    const fired = sent.filter((e) => e.name === "app/thesis.trigger.fired").map((e) => `${e.data.ticker}:${e.data.triggerId}`);
    expect(fired.sort()).toEqual(["AAA:aaa-trail", "BBB:bbb-floor"]);
    const failed = errors.filter((l) => l.includes("CHECK FAILED"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/on AAA: trigger aaa-bad \(thesis thesis_AAA\)/);
    expect(failed[0]).toMatch(/cannot read this trigger/);
  });
});
