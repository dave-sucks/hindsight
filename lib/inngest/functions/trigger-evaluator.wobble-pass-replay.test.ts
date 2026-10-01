/**
 * trigger-evaluator.wobble-pass-replay.test.ts — a buy the trigger run passes
 * because the price slipped back under its level is not used up (DAV-343).
 *
 * AAPL, Secular Compounder, 2026-09-30. At 09:30:22 ET the 5-minute check
 * fired the buy above $331 at $331.47. Twenty seconds later the trigger run
 * (cmuo57v4i000804jt4sad97p2) read $330.83 and passed: "the live quote at
 * execution was $330.83, back below the level, so the required live-quote
 * confirmation failed". At the next check, 09:35:20, AAPL traded $332.42 and
 * kept going. On main the buy was spent: its 1-day cooldown refused the
 * second fire, and had it got past that, the trigger run's four-hour "this
 * buy was already checked" rule would have dropped it.
 *
 * Replayed on one database through the whole sequence: the evaluator's own
 * cron handler at 09:30:22, the run's two rows exactly as it wrote them, the
 * re-arm step the trigger run now takes, the evaluator again at 09:35:20.
 * AAPL's row, its analyst's and account's rules, the run's rows and the tape
 * (Alpaca, sip) are in lib/agent/__fixtures__/aapl-wobble-pass-2026-09-30.json.
 */
import raw from "@/lib/agent/__fixtures__/aapl-wobble-pass-2026-09-30.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { RearmDecision } from "@/lib/agent/triggers/rearm";

type Row = Record<string, unknown>;
const fx = raw as unknown as {
  thesisBefore: Row & { id: string; createdAt: string; triggers: Trigger[] };
  firedAt: string;
  analyst: { id: string; name: string; setupIds: string[]; minConfidence: number; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  run: { id: string; createdAt: string };
  runRows: Array<Row & { type: string; triggerId: string | null; priceAtTime: number; timestamp: string; rationale: string }>;
  tape: { priorClose: number; dayOpen: number; fire: { at: string; price: number }; nextCheck: { at: string; price: number } };
};

const BUY = fx.thesisBefore.triggers.find((t) => t.action === "ENTER")!;
const PASS = fx.runRows.find((r) => r.type !== "TRIGGER_FIRED")!;

function book(): PrismaDouble {
  return prismaDouble({
    thesis: [
      thesisRow({
        ...fx.thesisBefore,
        createdAt: new Date(fx.thesisBefore.createdAt),
        researchRun: {
          agentConfigId: fx.analyst.id,
          agentConfig: { name: fx.analyst.name, setupIds: fx.analyst.setupIds, enabled: true },
        },
      }),
    ],
    agentConfig: [
      agentConfigRow({ id: fx.analyst.id, accountId: REPLAY_ACCOUNT_ID, triggers: fx.analyst.triggers, minConfidence: fx.analyst.minConfidence, enabled: true }),
    ],
    account: [accountRow({ triggers: fx.account.triggers, triggersSeededAt: new Date(fx.account.triggersSeededAt) })],
  });
}

const fakeClock = (at: Date) =>
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });

/** One pass of the 5-minute check at `at`, with AAPL at `price`. Returns the fires it sent. */
async function check(db: PrismaDouble, at: Date, price: number): Promise<Array<{ data: Row }>> {
  const sent: Array<{ data: Row }> = [];
  fakeClock(at);
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Row>) | undefined;
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
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith("/quote?symbol=AAPL")
            ? {
                data: {
                  c: price,
                  pc: fx.tape.priorClose,
                  o: fx.tape.dayOpen,
                  dp: ((price - fx.tape.priorClose) / fx.tape.priorClose) * 100,
                  t: Math.floor(at.getTime() / 1000),
                },
              }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({
        getTodaySessionBars: async () => ({ AAPL: { close: price, high: price, low: fx.tape.dayOpen, volume: 5_000_000 } }),
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
          sendEvent: async (_id: string, e: { data: Row }) => void sent.push(e),
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent.filter((e) => e.data.triggerId === BUY.id);
}

/**
 * A trigger run on the buy: its ResearchRun row and the two rows it writes
 * (TRIGGER_FIRED, then its close-out at `passPrice`), then the step the run
 * now takes once the agent is done.
 */
async function triggerRun(
  db: PrismaDouble,
  opts: { id: string; at: Date; passPrice: number; triedToBuy?: "order" | "refused" },
): Promise<RearmDecision> {
  const done = new Date(opts.at.getTime() + 20_000);
  db.store.researchRun.push({
    id: opts.id,
    mode: "INTRADAY_TACTICAL",
    status: "COMPLETE",
    createdAt: opts.at,
    agentConfigId: fx.analyst.id,
    parameters: { triggerId: BUY.id, thesisId: fx.thesisBefore.id, action: "ENTER" },
  });
  db.store.thesisUpdate.push(
    { id: `${opts.id}_fired`, thesisId: fx.thesisBefore.id, runId: opts.id, type: "TRIGGER_FIRED", triggerId: BUY.id, priceAtTime: fx.tape.fire.price, timestamp: opts.at },
    { id: `${opts.id}_pass`, thesisId: fx.thesisBefore.id, runId: opts.id, type: PASS.type, triggerId: BUY.id, priceAtTime: opts.passPrice, rationale: PASS.rationale, timestamp: done },
  );
  if (opts.triedToBuy === "order") {
    db.store.order.push({ id: `${opts.id}_order`, thesisId: fx.thesisBefore.id, symbol: "AAPL", side: "BUY", intent: "OPEN", status: "AWAITING_APPROVAL", createdAt: done });
  }
  if (opts.triedToBuy === "refused") {
    db.store.gateRejection.push({ id: `${opts.id}_refused`, tool: "place_trade", gateCode: "composite_below_minimum", summary: "Refused", runId: opts.id, ticker: "AAPL", createdAt: done });
  }
  let decision!: RearmDecision;
  fakeClock(new Date(done.getTime() + 5_000));
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      const { rearmBuyAfterPass } = await import("@/lib/agent/triggers/rearm");
      decision = await rearmBuyAfterPass({ runId: opts.id, runStartedAt: opts.at, thesisId: fx.thesisBefore.id, trigger: BUY });
    });
  } finally {
    jest.useRealTimers();
  }
  return decision;
}

/** What the trigger run's four-hour rule sees on the next fire: the buy as resolved, and the last run. */
async function checkedAlready(db: PrismaDouble): Promise<boolean> {
  let out!: boolean;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    const { resolveThesisLadder } = await import("@/lib/agent/triggers/load-levels");
    const { enterAlreadyChecked } = await import("@/lib/agent/triggers/rearm");
    const thesis = db.store.thesis[0] as unknown as Parameters<typeof resolveThesisLadder>[0];
    const buy = resolveThesisLadder(thesis, undefined).find((t) => t.id === BUY.id)!;
    const runs = (db.store.researchRun as Array<{ createdAt: Date }>).slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    out = enterAlreadyChecked(runs[0], buy);
  });
  return out;
}

const FIRE_AT = new Date(fx.tape.fire.at);
const NEXT_CHECK = new Date(fx.tape.nextCheck.at);
const RUN_AT = new Date(fx.run.createdAt);
const at = (hhmmss: string) => new Date(`2026-09-30T${hhmmss}Z`);

describe("the fixture is the production case", () => {
  it("the buy fired at $331.47, the run passed at $330.83, and the price was $332.42 at the next check", () => {
    expect(BUY).toMatchObject({ action: "ENTER", predicate: { kind: "PRICE_ABOVE", level: 331 }, cooldownDays: 1 });
    expect(fx.tape.priorClose).toBeLessThan(331); // the crossing holds all day
    expect(fx.tape.fire.price).toBeCloseTo(331.47, 2);
    expect(PASS).toMatchObject({ triggerId: BUY.id, priceAtTime: 330.83 });
    expect(fx.tape.nextCheck.price).toBeGreaterThan(331);
  });
});

describe("AAPL 2026-09-30 — a pass on a 64-cent wobble", () => {
  it("the 09:35 check at $332.42 fires the buy again, and the trigger run checks it", async () => {
    const db = book();
    expect(await check(db, FIRE_AT, fx.tape.fire.price)).toHaveLength(1);

    const decision = await triggerRun(db, { id: fx.run.id, at: RUN_AT, passPrice: PASS.priceAtTime });
    expect(decision).toEqual({ rearm: true, level: 331, priceAtPass: 330.83, rearmsToday: 1 });
    // Said on the run, in words.
    expect(db.store.runEvent).toEqual([
      expect.objectContaining({
        runId: fx.run.id,
        type: "buy_rearmed",
        message:
          "$AAPL was $330.83 at the check, back under the $331 level, so this pass does not use up the buy. The next check that finds it past $331 today fires it again (1 of 3 today).",
      }),
    ]);

    // On main this check sent nothing: the buy was in its 1-day cooldown.
    const refire = await check(db, NEXT_CHECK, fx.tape.nextCheck.price);
    expect(refire).toEqual([expect.objectContaining({ data: expect.objectContaining({ action: "ENTER", firedPrice: fx.tape.nextCheck.price }) })]);
    // …and the run it wakes is not dropped as "already checked".
    expect(await checkedAlready(db)).toBe(false);
    // The first fire is still on the trigger (the sheet's "Fired …" and the spent-buy flag read it).
    const buy = (db.store.thesis[0].triggers as Trigger[]).find((t) => t.id === BUY.id)!;
    expect(buy.lastFiredAt).toBe(NEXT_CHECK.toISOString());
  });

  it("with the price still under the level at the next check, nothing fires — the buy waits for the crossing", async () => {
    const db = book();
    await check(db, FIRE_AT, fx.tape.fire.price);
    await triggerRun(db, { id: fx.run.id, at: RUN_AT, passPrice: PASS.priceAtTime });
    expect(await check(db, NEXT_CHECK, 330.6)).toEqual([]);
  });
});

describe("any other pass still spends the buy", () => {
  it("chased: the run passed with the price past the level", async () => {
    const db = book();
    await check(db, FIRE_AT, fx.tape.fire.price);
    const decision = await triggerRun(db, { id: fx.run.id, at: RUN_AT, passPrice: 339.5 });
    expect(decision).toEqual({ rearm: false, why: "level-still-held" });
    expect(await check(db, NEXT_CHECK, fx.tape.nextCheck.price)).toEqual([]);
    expect(db.store.runEvent ?? []).toEqual([]);
  });

  it("the setup's own confirmation: the run passed at $331.47, over the level, waiting for the close", async () => {
    const db = book();
    await check(db, FIRE_AT, fx.tape.fire.price);
    const decision = await triggerRun(db, { id: fx.run.id, at: RUN_AT, passPrice: fx.tape.fire.price });
    expect(decision).toEqual({ rearm: false, why: "level-still-held" });
    expect(await check(db, NEXT_CHECK, fx.tape.nextCheck.price)).toEqual([]);
  });

  it("the run tried to buy — a proposal, or place_trade refused it on the score", async () => {
    for (const triedToBuy of ["order", "refused"] as const) {
      const db = book();
      await check(db, FIRE_AT, fx.tape.fire.price);
      const decision = await triggerRun(db, { id: fx.run.id, at: RUN_AT, passPrice: PASS.priceAtTime, triedToBuy });
      expect(decision).toEqual({ rearm: false, why: "tried-to-buy" });
      expect(await check(db, NEXT_CHECK, fx.tape.nextCheck.price)).toEqual([]);
    }
  });
});

describe("a stock hovering on its level", () => {
  it("wakes the analyst at most three more times that day", async () => {
    const db = book();
    // 09:30 fire, then a pass under the level after every fire.
    const checks = ["13:30:22", "13:35:20", "13:40:20", "13:45:20", "13:50:20", "13:55:20"];
    const fires: string[] = [];
    const decisions: RearmDecision[] = [];
    for (const [i, t] of checks.entries()) {
      const sent = await check(db, at(t), 331.4);
      if (sent.length === 0) continue;
      fires.push(t);
      decisions.push(await triggerRun(db, { id: `run_${i}`, at: new Date(at(t).getTime() + 11_000), passPrice: 330.9 }));
    }
    // The first fire and three re-fires; the fourth pass spends it.
    expect(fires).toEqual(["13:30:22", "13:35:20", "13:40:20", "13:45:20"]);
    expect(decisions.map((d) => (d.rearm ? d.rearmsToday : d.why))).toEqual([1, 2, 3, "day-limit"]);
    // The next fire, were there one, would be dropped as already checked.
    expect(await checkedAlready(db)).toBe(true);
  });

  it("the next day starts a fresh count", async () => {
    let decideBuyRearm!: typeof import("@/lib/agent/triggers/rearm").decideBuyRearm;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: book() }));
      ({ decideBuyRearm } = await import("@/lib/agent/triggers/rearm"));
    });
    const yesterday = ["2026-09-30T13:31:00Z", "2026-09-30T13:36:00Z", "2026-09-30T13:41:00Z"];
    const decision = decideBuyRearm({
      trigger: BUY,
      status: "WATCHING",
      closeOut: { triggerId: BUY.id, priceAtTime: 330.9 },
      triedToBuy: false,
      rearmedAt: yesterday,
      now: new Date("2026-10-01T13:36:00Z"),
    });
    expect(decision).toMatchObject({ rearm: true, rearmsToday: 1 });
  });
});
