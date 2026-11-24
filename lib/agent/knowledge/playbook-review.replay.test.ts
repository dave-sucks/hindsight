/**
 * Three playbook fixes from the playbook review (2026-11-17), through the evaluator's cron handler.
 *
 * 1. PEAD's buy is the gap holding: "Buy if above {gapDayMid}". Written on days 1–3 it is already
 *    true, so it fires at the next check (since 2026-11-23; it waited for the close). No stock is on
 *    the PEAD playbook yet; AAOI (PEAD Specialist, WATCHING) stands in with its 2026-11-11 gap as the
 *    11-16 snapshot stores it (+6.8%, low $51.53, middle $54.74) and its closes ($55.86 on 11-11,
 *    $52.85 on 11-12). The buy reads only the gap's middle.
 * 2. The Compounder's watch ends on a close below the 200-day, not the 52-week low ($118.15 on ACN,
 *    52% under its $247.70 close). ACN, its 11-16 snapshot (200-day $190.26).
 * 3. A watch's list has no analyst or account rule on our position: the Secular Compounder's
 *    from-entry and from-the-high reviews, as stored, are not on ACN's; on a holding they are.
 * 5. The pullback's Stop watching reads on the close. BWXT 2026-11-16, its real tape and 11-13 snapshot
 *    (50-day $137.48, 20-day volume 1,262,188): under the line all day and over 1.5× the pace at 1:40 PM.
 */
import raw from "@/lib/agent/__fixtures__/acn-buys-2026-11-17.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import { PLAYBOOK_TEMPLATES } from "@/lib/agent/knowledge/playbook-templates";
import { fillTemplate } from "@/lib/agent/knowledge/setups";
import { resolveLadder } from "@/lib/agent/triggers/levels";
import { applyTriggerOps } from "@/lib/agent/triggers/ops";
import { sentenceOf, type When } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

type Row = Record<string, unknown>;
const acn = raw as unknown as { thesis: Row & { id: string; createdAt: string }; analyst: { id: string; name: string }; migrated: Array<Row & { id: string; action: string }>; snapshot: IndicatorSnapshot };
const PEAD_ANALYST = "cmnhxpjio000004jvox6kl6c7";
const AAOI = "cmw99w97q002e08jo16m2w0vk";

/** The playbook's watch triggers, filled the way the Writer fills them. */
function watchTriggers(id: keyof typeof PLAYBOOK_TEMPLATES, levels: Record<string, number>): Trigger[] {
  return PLAYBOOK_TEMPLATES[id]
    .filter((t) => t.writtenOn === "WATCH")
    .map((t, i) => ({ id: `${id}-${i}`, action: t.action, source: "AGENT", playbook: "WATCH", fireMode: t.action === "REVIEW" ? "NEXT_MORNING" : "ASK_NOW", rationale: t.rationale, predicate: fillTemplate(t.predicate, (name) => levels[name]) }) as unknown as Trigger);
}

function book(thesis: Row, analystId: string, triggers: Trigger[]): PrismaDouble {
  return prismaDouble({
    thesis: [thesisRow({ ...thesis, triggers, researchRun: { agentConfigId: analystId, agentConfig: { name: "x", setupIds: [], enabled: true } } })],
    agentConfig: [agentConfigRow({ id: analystId, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
    account: [accountRow({ triggers: [], triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
  });
}

/** One pass at `at`, `ticker` at `price` (on the close pass, the day's close). Returns the events sent. */
async function check(db: PrismaDouble, at: Date, ticker: string, price: number, prevClose: number, snapshot?: IndicatorSnapshot, volume = 1_000_000): Promise<Row[]> {
  const sent: Row[] = [];
  jest.useFakeTimers({ now: at, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Row>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith(`/quote?symbol=${ticker}`)
            ? { data: { c: price, pc: prevClose, o: prevClose, dp: ((price - prevClose) / prevClose) * 100, t: Math.floor(at.getTime() / 1000) } }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ [ticker]: { close: price, high: price, low: price, volume } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map(snapshot ? [[ticker, snapshot]] : []) }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: { data: Row }) => void sent.push(e.data) } });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent;
}

describe("1. PEAD: the buy is the gap holding, and it fires at the next check", () => {
  const triggers = watchTriggers("PEAD", { "{gapDayMid}": 54.74, "{gapDayLow}": 51.53 });
  const buy = triggers.find((t) => t.action === "ENTER")!;
  // Written on the gap day (day 1), so the 7-day clock isn't due.
  const aaoi = () => book({ id: AAOI, ticker: "AAOI", status: "WATCHING", direction: "LONG", createdAt: new Date("2026-11-11T16:00:00Z"), lastReviewedAt: new Date("2026-11-11T16:00:00Z") }, PEAD_ANALYST, triggers);

  it("reads as the gap held", () => {
    expect(sentenceOf(buy)).toBe("Buy if above $54.74");
    expect(buy.rationale).toBe("The gap held: above the gap day's middle.");
  });

  it("already true at $56.20 at 11:30 ET: the five-minute check fires it", async () => {
    expect(await check(aaoi(), new Date("2026-11-11T16:30:00Z"), "AAOI", 56.2, 48.32)).toEqual([expect.objectContaining({ triggerId: buy.id, action: "ENTER", firedPrice: 56.2 })]);
  });

  it("a close under the gap's middle ($52.85 on 11-12) is the gap not holding: nothing fires", async () => {
    expect(await check(aaoi(), new Date("2026-11-12T21:20:05Z"), "AAOI", 52.85, 55.86)).toEqual([]);
  });
});

describe("2. The Compounder's watch ends on a close below the 200-day", () => {
  const triggers = watchTriggers("COMPOUNDER_ACCUMULATION", { "{pivot}": 271.76 });
  const stop = triggers.find((t) => t.action === "STOP_WATCHING")!;
  const acnBook = () => book({ ...acn.thesis, createdAt: new Date(acn.thesis.createdAt + "Z"), lastReviewedAt: new Date("2026-11-17T10:00:00Z") }, acn.analyst.id, triggers);

  it("ACN's reads 'Stop watching if below the 200-day average · only on the close'; the 52-week low's is gone", () => {
    expect(sentenceOf(stop)).toBe("Stop watching if below the 200-day average · only on the close");
    expect(stop.rationale).toBe("The uptrend broke; not an accumulation candidate until it's back.");
    expect(JSON.stringify(triggers)).not.toMatch(/low52/);
    expect(triggers.find((t) => t.action === "ENTER" && (t.predicate as { watch?: string; variable?: string }).watch === "price" && (t.predicate as { variable?: string }).variable === "sma50")!.rationale).toBe("The first half, in an uptrend: above a rising 50-day. Already true when written means buy the first half now.");
  });

  it("under the $190.26 200-day at 11:30 ET it does nothing; a close under it retires the watch", async () => {
    const db = acnBook();
    // 11:30 ET under the line, and $193.40 at the close: the watch stays.
    expect((await check(db, new Date("2026-11-18T16:30:00Z"), "ACN", 188.4, 191.2, acn.snapshot)).filter((e) => e.action === "STOP_WATCHING")).toEqual([]);
    await check(db, new Date("2026-11-18T21:20:05Z"), "ACN", 193.4, 191.2, acn.snapshot);
    expect(db.store.thesis[0]).toMatchObject({ status: "WATCHING" });
    await check(db, new Date("2026-11-19T21:20:05Z"), "ACN", 189.5, 193.4, acn.snapshot);
    expect(db.store.thesis[0]).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED" });
  });
});

describe("3. A watch's list has no analyst or account rule on our position", () => {
  const rule = (id: string, predicate: When) => ({ id, action: "REVIEW", source: "PRINCIPAL", fireMode: "NEXT_MORNING", rationale: "(as set)", predicate }) as unknown as Trigger;
  // The Secular Compounder's rules as stored on 2026-11-17, and two shapes none stores yet.
  const COMPOUNDER = [
    rule("06506e39", { is: "below", value: 15, watch: "move", variable: "peak" }),
    rule("cf39ff35", { is: "below", watch: "price", variable: "sma200" }),
    rule("a6d188ee", { is: "above", value: 15, watch: "move", variable: "entry" }),
    rule("98f6fe80", { is: "below", value: 15, watch: "move", variable: "entry" }),
    rule("days-after-buy", { is: "after", value: 60, watch: "from_date", variable: "buy" }),
    rule("and-entry", { match: "all", conditions: [{ is: "above", value: 10, watch: "move", variable: "entry" }, { watch: "volume", value: 2 }] } as When),
  ];
  const own = acn.migrated as unknown as Trigger[];
  const ruleIds = (state: "WATCHING" | "HELD") => resolveLadder({ thesis: own, analyst: COMPOUNDER, account: [], state, direction: "LONG" }).filter((t) => t.inherited).map((t) => t.id);

  it("on ACN, a watch: only the 200-day review comes from the analyst", () => {
    expect(ruleIds("WATCHING")).toEqual(["cf39ff35"]);
  });

  it("on a holding, every one applies", () => {
    expect(ruleIds("HELD").sort()).toEqual(COMPOUNDER.map((t) => t.id).sort());
  });

  it("the stock's own triggers are read as stored: a watch's own 'Review 60 days after the buy' stays on its list", () => {
    const withOwn = [...own, rule("own-after-buy", { is: "after", value: 60, watch: "from_date", variable: "buy" })];
    expect(resolveLadder({ thesis: withOwn, analyst: [], account: [], state: "WATCHING", direction: "LONG" }).map((t) => t.id)).toContain("own-after-buy");
  });
});

describe("4. edit_triggers sets 'only on the close' on an average, as the save does", () => {
  // V's own "Review if below the 200-day average", as stored on 2026-11-17.
  const review = { id: "ee9ddbea-391f-446c-8672-744a31ba6ad7", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", rationale: "(as set)", predicate: { is: "below", watch: "price", variable: "sma200" } } as unknown as Trigger;
  const edit = (t: Trigger, close: boolean) => applyTriggerOps({ stored: [t], ops: [{ op: "edit", id: t.id, close }], direction: "LONG", status: "HOLDING", actor: "AGENT", mintId: () => "x" });

  it("V's 200-day review: on the close", () => {
    const out = edit(review, true);
    expect(out.results[0]).toMatchObject({ ok: true });
    expect(out.triggers[0].predicate).toEqual({ is: "below", watch: "price", variable: "sma200", settings: { close: true } });
    expect(sentenceOf(out.triggers[0])).toBe("Review if below the 200-day average · only on the close");
  });

  it("a high still can't wait for the close: the timing is as it was", () => {
    const high = { ...review, id: "high", predicate: { is: "above", watch: "price", variable: "high52" } } as unknown as Trigger;
    expect(edit(high, true).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/on the close is for a typed price or an average/) });
  });
});

describe("5. The pullback's Stop watching waits for a heavy close below the 50-day", () => {
  const snapshot = { ...acn.snapshot, asOf: "2026-11-13", sma: { ...acn.snapshot.sma, 50: 137.48 }, volumeAvg20: 1_262_188 } as IndicatorSnapshot;
  const PRIOR_CLOSE = 122.97;
  const seen = new Date("2026-11-16T12:00:00Z");
  const bwxt = () => book({ id: "bwxt", ticker: "BWXT", status: "WATCHING", direction: "LONG", createdAt: seen, lastReviewedAt: seen }, PEAD_ANALYST, watchTriggers("MA_PULLBACK", {}));

  it("doesn't fire during the session, at 1.59× the pace at 1:40 PM, and fires on the 2.04× close under the line", async () => {
    const db = bwxt();
    await check(db, new Date("2026-11-16T15:00:00Z"), "BWXT", 120.41, PRIOR_CLOSE, snapshot, 177_054);
    await check(db, new Date("2026-11-16T18:40:00Z"), "BWXT", 116.8, PRIOR_CLOSE, snapshot, 883_263);
    expect(db.store.thesis[0]).toMatchObject({ status: "WATCHING" });
    await check(db, new Date("2026-11-16T21:20:05Z"), "BWXT", 117.09, PRIOR_CLOSE, snapshot, 2_578_982);
    expect(db.store.thesis[0]).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED" });
  });

  it("a light close under the line leaves the watch", async () => {
    const db = bwxt();
    await check(db, new Date("2026-11-16T21:20:05Z"), "BWXT", 117.09, PRIOR_CLOSE, snapshot, 1_500_000);
    expect(db.store.thesis[0]).toMatchObject({ status: "WATCHING" });
  });
});
