/**
 * A fall in the market starts one Portfolio Manager run for the account, and
 * no run on any stock. The case is the week of Mon 2026-11-16, with SPY's own
 * prices at the five-minute checks (Alpaca's consolidated bars, each check
 * reading the bar's open):
 *
 *   Mon 11-16  prior close 754.37 · 14:35 739.43 (-1.98%) · 14:40 739.20 (-2.01%) · 14:45 738.59 · close 739.95 (-1.91%)
 *   Fri 11-20  prior close 715.87 · 12:00 704.23 (-1.63%) · 12:05 700.89 (-2.09%) · close 689.81 (-3.64%)
 *   Mon 11-23  prior close 689.81 · 9:35 718.55 (+4.17%)
 *
 * The rules are the two the migration writes on every account, read out of the
 * migration itself, so what fires here is what is saved.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID } from "@/lib/replay";
import { addProblem, actionProblem, sentenceOf, TRIGGER_TYPES } from "@/lib/agent/triggers/condition";
import { triggerInputSchema, triggersArraySchema } from "@/lib/agent/triggers/schema";

const ANALYST = "cmmmh0wxu000004js7yoyzvlf";
const MIGRATION = readFileSync(join(process.cwd(), "prisma/migrations/20261123010000_account_market_triggers/migration.sql"), "utf8");
/** The rule as the migration saves it. */
const SAVED: Array<Record<string, unknown>> = JSON.parse(/DEFAULT '(\[.*\])';/.exec(MIGRATION)![1]);
/** A rule every stock inherits, beside it: a 7% fall on the day sends the stock to its analyst. */
const BIG_DAY = { id: "rule-big-day", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "move", is: "below", value: 7, variable: "prev_close" }, rationale: "A big day gets a look." };

const MARKET_FIRED = "app/market.trigger.fired";
const STOCK_FIRED = "app/thesis.trigger.fired";
type Sent = { name: string; data: Record<string, unknown> };

function book() {
  const run = { agentConfigId: ANALYST, agentConfig: { name: "PEAD Specialist", setupIds: [], enabled: true } };
  return prismaDouble({
    thesis: [
      thesisRow({ id: "nvda", ticker: "NVDA", status: "HOLDING", direction: "LONG", triggers: [], researchRun: run }),
      thesisRow({ id: "wst", ticker: "WST", status: "WATCHING", direction: "LONG", triggers: [], researchRun: run }),
    ],
    agentConfig: [agentConfigRow({ id: ANALYST, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true, tradingEnvironment: "PAPER" })],
    account: [accountRow({ triggers: [BIG_DAY], triggersSeededAt: new Date("2026-09-01T00:00:00Z"), marketTriggers: SAVED })],
    accountMembership: [{ id: "m1", accountId: REPLAY_ACCOUNT_ID, userId: REPLAY_USER_ID, role: "OWNER" }],
    position: [positionRow({ id: "pos_nvda", analystId: ANALYST, symbol: "NVDA", avgCost: 218.23, quantity: 10, openedAt: new Date("2026-08-31T13:53:39Z") })],
  });
}

const fake = (at: Date) =>
  jest.useFakeTimers({ now: at, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
const step = (sent: Sent[]) => ({ run: async (_name: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: Sent) => void sent.push(e) });

/**
 * One pass of the trigger check at `at`, with SPY at `spy` against `prior`.
 * `stampedAt` is when the quote printed: a minute before the check, unless a test says otherwise.
 * Every stock is down 1% on the day: no stock's rule is true.
 */
async function pass(db: ReturnType<typeof prismaDouble>, at: Date, spy: number, prior: number, stampedAt: Date = new Date(at.getTime() - 60_000)) {
  const sent: Sent[] = [];
  fake(at);
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) => {
          const t = Math.floor(stampedAt.getTime() / 1000);
          if (path === "/quote?symbol=SPY") return { data: { c: spy, pc: prior, o: prior, t } };
          return path.startsWith("/quote?symbol=") ? { data: { c: 99, pc: 100, o: 100, t } } : { data: null };
        },
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ NVDA: { close: 99, high: 100, low: 98, volume: 1 }, WST: { close: 99, high: 100, low: 98, volume: 1 } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/trading/water-mark", () => ({ raiseWaterMarks: async (found: unknown) => found, raiseMarksFromDayBars: async () => undefined }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ event: undefined, step: step(sent) });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent;
}

/** The agent scheduler handed the fire: the runs it starts, each with who it is for and its message. */
async function schedulerOn(db: ReturnType<typeof prismaDouble>, event: Sent) {
  const runs: Array<{ agent: string; accountId: string; environment: string; message: unknown }> = [];
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    jest.doMock("@/lib/agent/discovery/run", () => ({ DISCOVERY_RUN: {} }));
    jest.doMock("@/lib/agent/portfolio-manager/run", () => ({ PORTFOLIO_MANAGER_RUN: { record: { id: "portfolio_manager" } } }));
    jest.doMock("@/lib/agent/engine/run", () => ({
      runAgentAsRun: async (agent: { record: { id: string } }, t: { accountId: string; environment: string }, message: unknown) => {
        runs.push({ agent: agent.record.id, accountId: t.accountId, environment: t.environment, message });
        return { runId: `run_${runs.length}`, status: "COMPLETE" };
      },
    }));
    await import("@/lib/inngest/functions/agent-scheduler");
    await handler!({ event, step: step([]) });
  });
  return runs;
}

const marketRule = (db: ReturnType<typeof prismaDouble>) => ((db.store.account as Array<Record<string, unknown>>)[0].marketTriggers as Array<Record<string, string | undefined>>)[0];
const et = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-05:00`);

describe("the account's market trigger, as saved", () => {
  it("reads as one sentence and parses as a trigger", () => {
    expect(SAVED.map((t) => sentenceOf(t as never))).toEqual(["Run the Portfolio Manager if the S&P is down 2% on the day", "Run the Portfolio Manager if the S&P is up 2% on the day"]);
    expect(triggersArraySchema.safeParse(SAVED).success).toBe(true);
  });

  it("no stock carries it: no Add trigger menu offers the measure, no agent's tool takes the measure or the action, and a save of either is refused", () => {
    expect(TRIGGER_TYPES.flatMap((t) => t.measures.map((m) => m.id))).not.toContain("market");
    const asAgent = triggerInputSchema.safeParse({ predicate: SAVED[0].predicate, action: "REVIEW", rationale: "x" });
    expect(asAgent.success).toBe(false);
    expect(JSON.stringify(asAgent.error?.issues)).not.toContain("market");
    expect(triggerInputSchema.safeParse({ predicate: { watch: "price", is: "below", value: 10 }, action: "RUN_PORTFOLIO_MANAGER", rationale: "x" }).success).toBe(false);
    for (const level of ["THESIS", "ANALYST", "ACCOUNT"] as const) expect(addProblem(SAVED[0].predicate as never, level)).toContain("the account's own trigger");
    for (const ctx of [{ held: true }, { held: false }, { held: false, standing: true }]) expect(actionProblem("RUN_PORTFOLIO_MANAGER", ctx)).toContain("the account's own trigger");
  });

  it("no stock inherits it: what a stock's analyst is handed from the account is its rules for every stock, and nothing from the market column", async () => {
    const db = book();
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      const { loadLevelSources } = await import("@/lib/agent/triggers/load-levels");
      expect((await loadLevelSources([ANALYST])).get(ANALYST)?.account.map((t) => t.id)).toEqual([BIG_DAY.id]);
    });
  });
});

describe("Mon 2026-11-16: the S&P reads down 2.01% at the 2:40 PM check", () => {
  it("at 2:35 PM it is down 1.98%: nothing fires", async () => {
    const db = book();
    expect(await pass(db, et("2026-11-16", "14:35"), 739.43, 754.37)).toEqual([]);
    expect(marketRule(db).lastFiredAt).toBeUndefined();
  });

  it("at 2:40 PM one fire for the account and none for any stock; the scheduler starts one Portfolio Manager run, told why", async () => {
    const db = book();
    const sent = await pass(db, et("2026-11-16", "14:40"), 739.2, 754.37);
    expect(sent.filter((e) => e.name === STOCK_FIRED)).toEqual([]);
    expect(sent.map((e) => e.name)).toEqual([MARKET_FIRED]);
    expect(sent[0].data).toEqual({
      accountId: REPLAY_ACCOUNT_ID,
      triggerId: "market-fall",
      message: `The S&P is down 2.0% today, which fired the account's trigger "Run the Portfolio Manager if the S&P is down 2% on the day".`,
    });
    expect(await schedulerOn(db, sent[0])).toEqual([{ agent: "portfolio_manager", accountId: REPLAY_ACCOUNT_ID, environment: "PAPER", message: sent[0].data.message }]);
  });

  it("the 2:45 PM check, lower still, starts no second run", async () => {
    const db = book();
    expect(await pass(db, et("2026-11-16", "14:40"), 739.2, 754.37)).toHaveLength(1);
    expect(await pass(db, et("2026-11-16", "14:45"), 738.59, 754.37)).toEqual([]);
  });

  it("the close, down 1.91%, finds it false, so it fires again on Friday at 12:05 PM (down 2.09%), and not at 12:00 (down 1.63%)", async () => {
    const db = book();
    await pass(db, et("2026-11-16", "14:40"), 739.2, 754.37);
    expect(await pass(db, et("2026-11-16", "16:20"), 739.95, 754.37, et("2026-11-16", "16:00"))).toEqual([]);
    expect(marketRule(db).falseAtCloseAt).toBe(et("2026-11-16", "16:20").toISOString());
    expect(await pass(db, et("2026-11-20", "12:00"), 704.23, 715.87)).toEqual([]);
    const friday = await pass(db, et("2026-11-20", "12:05"), 700.89, 715.87);
    expect(friday.map((e) => [e.name, e.data.message])).toEqual([[MARKET_FIRED, `The S&P is down 2.1% today, which fired the account's trigger "Run the Portfolio Manager if the S&P is down 2% on the day".`]]);
  });

  it("Friday's close, down 3.64%, finds it still true: it stays fired", async () => {
    const db = book();
    await pass(db, et("2026-11-20", "12:05"), 700.89, 715.87);
    await pass(db, et("2026-11-20", "16:20"), 689.81, 715.87, et("2026-11-20", "16:00"));
    expect(marketRule(db).falseAtCloseAt).toBeUndefined();
  });

  it("Monday 11-23 opens up 4.17%: the rise fires at 9:35 AM, though Friday's close left the fall still fired", async () => {
    const db = book();
    await pass(db, et("2026-11-20", "12:05"), 700.89, 715.87);
    await pass(db, et("2026-11-20", "16:20"), 689.81, 715.87, et("2026-11-20", "16:00"));
    const monday = await pass(db, et("2026-11-23", "09:35"), 718.55, 689.81);
    expect(monday.filter((e) => e.name === STOCK_FIRED)).toEqual([]);
    expect(monday.map((e) => [e.data.triggerId, e.data.message])).toEqual([
      ["market-rise", `The S&P is up 4.2% today, which fired the account's trigger "Run the Portfolio Manager if the S&P is up 2% on the day".`],
    ]);
    expect(await pass(db, et("2026-11-23", "09:40"), 715.63, 689.81)).toEqual([]);
  });

  it("a quote 20 minutes old is not read: nothing fires, and the next check with a fresh one does", async () => {
    const db = book();
    expect(await pass(db, et("2026-11-16", "14:40"), 739.2, 754.37, et("2026-11-16", "14:20"))).toEqual([]);
    expect(marketRule(db).lastFiredAt).toBeUndefined();
    expect(await pass(db, et("2026-11-16", "14:45"), 738.59, 754.37)).toHaveLength(1);
  });

  it("an account whose rule was removed starts nothing", async () => {
    const db = book();
    (db.store.account as Array<Record<string, unknown>>)[0].marketTriggers = [];
    expect(await pass(db, et("2026-11-16", "14:40"), 739.2, 754.37)).toEqual([]);
  });
});
