/**
 * The five-minute check's own handler, replayed from Monday 2026-11-16 09:30 ET (production rows, read only):
 *
 * - GEV (held, the Secular Compounder): its review and its two sales fired in one pass and made TWO runs one
 *   second apart, both editing GEV's triggers, the second's removal of a trigger "not on this thesis" because
 *   the first had already made it. The account's 6% trail, the thesis's floor and a thesis review.
 * - PRAX (watched, the Catalyst Event PM): the 08:02 morning run wrote two filing rules (8-K items 7.01 and
 *   8.01). At 09:30 both fired on the 8-K of Nov 12 (accession 0001689548-26-000091) that the stock's
 *   account-level rule had already fired on the Friday it was written, and made two runs fourteen seconds
 *   apart. A new rule has no memory of the filings that came out before it.
 *
 * Only the edges are doubled (database, vendors, clock). Levels are round numbers, not the production ones.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import type { SecFiling } from "@/lib/market-data/sec-events";

const COMPOUNDER = "cmqb2ntaa001u04k0compounder";
const CATALYST = "cmqb2ntaa001u04k0catalyst0";

// ── GEV ──────────────────────────────────────────────────────────────────
const GEV_REVIEW = { id: "ae04d898-9865-42c5-885b-0107dac18a49", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 95 }, rationale: "Look if it breaks 95.", cooldownDays: 1 };
const GEV_FLOOR = { id: "8861139d-9300-438c-9903-0aac1e68cc1b", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 150 }, rationale: "The floor.", cooldownDays: 1 };
// The account's rule: sell when the price gives back 6% from the high since we bought.
const TRAIL = { id: "bd941c67-a53a-41b8-918f-d303ec3b5e66", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "move", is: "below", value: 6, variable: "peak" }, rationale: "The trail.", cooldownDays: 1 };

// ── PRAX ─────────────────────────────────────────────────────────────────
const ACCOUNT_FILING = { id: "b5b2a019-ca09-4595-990c-33f34e4b4657", action: "REVIEW", source: "PRINCIPAL", fireMode: "NEXT_MORNING", predicate: { match: "any", conditions: [{ watch: "filing", variable: "item:8.01" }, { watch: "filing", variable: "item:7.01" }] }, rationale: "An 'other events' or press-release filing.", cooldownDays: 1 };
const RULE_701 = { id: "a05c58e2-ca04-4f8f-afac-bdd527d0f832", action: "REVIEW", source: "AGENT", fireMode: "ASK_NOW", predicate: { watch: "filing", variable: "item:7.01" }, rationale: "A press release.", cooldownDays: 0 };
const RULE_801 = { id: "3ca27b95-3f67-48a2-9b83-b7829294ddd4", action: "REVIEW", source: "AGENT", fireMode: "ASK_NOW", predicate: { watch: "filing", variable: "item:8.01" }, rationale: "Other events.", cooldownDays: 0 };
const NOV_12_8K: SecFiling = {
  accession: "0001689548-26-000091",
  cik: "0001689548",
  ticker: "PRAX",
  form: "8-K",
  rootForm: "8-K",
  items: ["7.01", "8.01"],
  filedDate: "2026-11-12",
  tier: "CONTEXT",
  url: "https://www.sec.gov/Archives/edgar/data/1689548/000168954826000091/prax-20261112.htm",
};
const PRAX_CREATED = new Date("2026-11-13T18:47:48.290Z");
const WRITTEN_AT = "2026-11-16T13:02:22.000Z"; // the 08:02 ET morning run

const MONDAY_0930 = new Date("2026-11-16T14:30:00Z");

type Sent = { name: string; data: Record<string, unknown> };

/** One pass of the evaluator against `db` at `at`, with the vendors doubled. */
async function pass(db: PrismaDouble, opts: { at?: Date; ticker: string; price: number; prevClose: number; filings?: SecFiling[] }) {
  const at = opts.at ?? MONDAY_0930;
  const sent: Sent[] = [];
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith("/quote?symbol=")
            ? { data: { c: opts.price, pc: opts.prevClose, o: opts.prevClose, dp: ((opts.price - opts.prevClose) / opts.prevClose) * 100, t: Math.floor(at.getTime() / 1000) } }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ [opts.ticker]: { close: opts.price, high: opts.price, low: opts.price, volume: 1_000_000 } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({
        ...jest.requireActual("@/lib/market-data/sec-filings"),
        fetchBookFilings: async () => ({ byTicker: new Map(opts.filings ? [[opts.ticker, opts.filings]] : []) }),
      }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({
        step: {
          run: async (_name: string, fn: () => Promise<unknown>) => fn(),
          sendEvent: async (_id: string, e: Sent) => void sent.push(e),
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  const rows = (db.store.thesisUpdate ?? []) as Array<Record<string, unknown>>;
  return {
    events: sent.filter((e) => e.name === "app/thesis.trigger.fired").map((e) => e.data as { triggerId: string; action: string; ticker: string; firedContext?: string; coFired?: Array<{ triggerId: string; action?: string; firedContext?: string }> }),
    writtenDown: rows.filter((r) => r.type === "TRIGGER_FIRED").map((r) => r.triggerId),
  };
}

// ── GEV ──────────────────────────────────────────────────────────────────

function gevDb(extra: { researchRun?: Array<Record<string, unknown>> } = {}) {
  return prismaDouble({
    thesis: [
      thesisRow({
        id: "gev",
        ticker: "GEV",
        status: "HOLDING",
        direction: "LONG",
        triggers: [GEV_REVIEW, GEV_FLOOR],
        researchRun: { agentConfigId: COMPOUNDER, agentConfig: { name: "Secular Compounder", setupIds: [], enabled: true } },
      }),
    ],
    agentConfig: [agentConfigRow({ id: COMPOUNDER, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
    account: [accountRow({ triggers: [TRAIL], triggersSeededAt: new Date("2026-08-05T12:00:00Z") })],
    position: [positionRow({ id: "pos_gev", analystId: COMPOUNDER, symbol: "GEV", avgCost: 80, peakPrice: 100, openedAt: new Date("2026-10-01T16:59:56Z") })],
    ...extra,
  });
}
const gevPass = (db: PrismaDouble, at?: Date) => pass(db, { at, ticker: "GEV", price: 90, prevClose: 97 });

describe("GEV 2026-11-16 09:30 — a review and two sales in one pass", () => {
  it("is ONE run: the sale leads, the other sale and the review ride in it (main: two events, one second apart)", async () => {
    const { events, writtenDown } = await gevPass(gevDb());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ triggerId: GEV_FLOOR.id, action: "EXIT", ticker: "GEV" });
    expect(events[0].coFired?.map((c) => [c.triggerId, c.action])).toEqual([
      [TRAIL.id, "EXIT"],
      [GEV_REVIEW.id, "REVIEW"],
    ]);
    // The trigger run writes each one's Activity line; the check writes none for a fire it runs.
    expect(writtenDown).toEqual([]);
  });

  it("all three are stamped fired, so none asks again at 09:35", async () => {
    const db = gevDb();
    await gevPass(db);
    const next = await gevPass(db, new Date(MONDAY_0930.getTime() + 5 * 60_000));
    // The sales stand daily but wait out their rest; the review fired once on its crossing.
    expect(next.events).toEqual([]);
  });

  it("while GEV's last run is still going: no second run; the review is written down, the sales ask again once it ends", async () => {
    const db = gevDb({ researchRun: [{ id: "run_going", mode: "INTRADAY_TACTICAL", status: "RUNNING", createdAt: new Date(MONDAY_0930.getTime() - 4 * 60_000), parameters: { thesisId: "gev", triggerId: GEV_REVIEW.id } }] });
    const during = await gevPass(db);
    expect(during.events).toEqual([]);
    expect(during.writtenDown).toEqual([GEV_REVIEW.id]);
    // Unstamped: no cooldown started on either sale.
    const stored = (db.store.thesis[0].triggers as Array<{ id: string; lastFiredAt?: string }>);
    expect(stored.find((t) => t.id === GEV_FLOOR.id)?.lastFiredAt).toBeUndefined();
    expect(db.store.thesis[0].triggerState).toEqual({});

    // The run ends; the next pass asks again, and the review is not asked twice.
    db.store.researchRun[0].status = "COMPLETE";
    const after = await gevPass(db, new Date(MONDAY_0930.getTime() + 5 * 60_000));
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ triggerId: GEV_FLOOR.id, action: "EXIT" });
    expect(after.events[0].coFired?.map((c) => c.triggerId)).toEqual([TRAIL.id]);
  });

  it("a run still marked RUNNING after fifteen minutes died; it holds nothing", async () => {
    const db = gevDb({ researchRun: [{ id: "run_dead", mode: "INTRADAY_TACTICAL", status: "RUNNING", createdAt: new Date(MONDAY_0930.getTime() - 20 * 60_000), parameters: { thesisId: "gev" } }] });
    expect((await gevPass(db)).events).toHaveLength(1);
  });
});

// ── PRAX ─────────────────────────────────────────────────────────────────

function praxDb(thesis: { createdAt: Date; triggers: Array<Record<string, unknown>> }) {
  return prismaDouble({
    thesis: [
      thesisRow({
        id: "prax",
        ticker: "PRAX",
        status: "WATCHING",
        direction: "LONG",
        createdAt: thesis.createdAt,
        triggers: thesis.triggers,
        // The account rule fired on the Nov 12 8-K the Friday the thesis was written.
        triggerState: { [ACCOUNT_FILING.id]: { firedAt: "2026-11-13T18:50:06.175Z", firedFilings: [NOV_12_8K.accession] } },
        researchRun: { agentConfigId: CATALYST, agentConfig: { name: "Catalyst Event PM", setupIds: [], enabled: true } },
      }),
    ],
    agentConfig: [agentConfigRow({ id: CATALYST, accountId: REPLAY_ACCOUNT_ID, triggers: [ACCOUNT_FILING], enabled: true })],
    account: [accountRow({ triggers: [], triggersSeededAt: new Date("2026-08-05T12:00:00Z") })],
  });
}
const praxPass = (db: PrismaDouble, filings: SecFiling[]) => pass(db, { ticker: "PRAX", price: 322, prevClose: 323, filings });
const stamped = { writtenAt: WRITTEN_AT };

describe("PRAX 2026-11-16 09:30 — two new filing rules on a filing already read", () => {
  it("fire on nothing: the Nov 12 8-K came out before the thesis (main: two runs, 14 seconds apart)", async () => {
    const db = praxDb({ createdAt: PRAX_CREATED, triggers: [RULE_701, RULE_801] });
    const { events, writtenDown } = await praxPass(db, [NOV_12_8K]);
    expect(events).toEqual([]);
    expect(writtenDown).toEqual([]);
    // Nothing was stamped either: the rules still have no memory, and need none.
    expect((db.store.thesis[0].triggers as Array<{ lastFiredAt?: string }>).map((t) => t.lastFiredAt)).toEqual([undefined, undefined]);
  });

  it("fire on nothing on an older thesis too, when the rules carry the time the morning run wrote them", async () => {
    const db = praxDb({ createdAt: new Date("2026-06-12T15:00:00Z"), triggers: [{ ...RULE_701, ...stamped }, { ...RULE_801, ...stamped }] });
    expect((await praxPass(db, [NOV_12_8K])).events).toEqual([]);
  });

  it("a filing the day the rules were written still fires, once, as one run that names it", async () => {
    const db = praxDb({ createdAt: new Date("2026-06-12T15:00:00Z"), triggers: [{ ...RULE_701, ...stamped }, { ...RULE_801, ...stamped }] });
    const sameDay: SecFiling = { ...NOV_12_8K, accession: "0001689548-26-000099", filedDate: "2026-11-16" };
    const { events } = await praxPass(db, [sameDay, NOV_12_8K]);
    expect(events).toHaveLength(1);
    expect(events[0].triggerId).toBe(RULE_701.id);
    expect(events[0].firedContext).toContain("Nov 16");
    expect(events[0].firedContext).not.toContain("Nov 12");
    expect(events[0].coFired).toEqual([expect.objectContaining({ triggerId: RULE_801.id, action: "REVIEW" })]);
    // Both remember the new filing and only it.
    expect((db.store.thesis[0].triggers as Array<{ firedFilings?: string[] }>).map((t) => t.firedFilings)).toEqual([[sameDay.accession], [sameDay.accession]]);
  });

  it("a rule from before the time was stamped is held to its thesis's day alone, and so fires on the Nov 12 8-K of an older thesis", async () => {
    const db = praxDb({ createdAt: new Date("2026-06-12T15:00:00Z"), triggers: [RULE_701] });
    const { events } = await praxPass(db, [NOV_12_8K]);
    expect(events.map((e) => e.triggerId)).toEqual([RULE_701.id]);
  });
});
