/**
 * A high note from the Market Reviewer starts a look through a trigger the
 * owner saved, and only through one. The case: Friday 2026-11-13, the 7:30 AM
 * note on NVDA (its CEO resigned), marked high, with the account rule "Review
 * if the Market Reviewer writes a high note on it" set to Send to Agent. The
 * check runs when the note is saved, before the session; the note's text here
 * is a stand-in (the repo keeps no note text).
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID } from "@/lib/replay";
import { sentenceOf, whenValid } from "@/lib/agent/triggers/condition";
import { conditionProblem } from "@/lib/agent/triggers/condition/check";
import { MEASURES, TRIGGER_TYPES } from "@/lib/agent/triggers/condition/catalog";

const ANALYST = "cmmmh0wxu000004js7yoyzvlf";
const RULE = { id: "rule-high-note", action: "REVIEW", fireMode: "ASK_NOW", predicate: { watch: "note" }, rationale: "Something happened to the company that could change what we do today." };
const SAVED_AT = new Date("2026-11-13T12:31:00Z"); // 7:31 AM ET, a Friday, before the session
const note = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: REPLAY_USER_ID,
  author: "MARKET_REVIEWER",
  runId: "run_reviewer",
  body: "Nvidia said its chief executive resigned, effective today.",
  audience: "STOCKS",
  analystId: null,
  tickers: ["NVDA"],
  eventDate: null,
  pinnedUntil: null,
  impact: "high",
  effect: "weaker",
  prices: null,
  createdAt: new Date(at),
  ...over,
});

function book(rule: Record<string, unknown> | null, notes: Array<Record<string, unknown>>) {
  const run = { agentConfigId: ANALYST, agentConfig: { name: "PEAD Specialist", setupIds: [], enabled: true } };
  return prismaDouble({
    thesis: [
      thesisRow({ id: "nvda", ticker: "NVDA", status: "HOLDING", direction: "LONG", triggers: [], researchRun: run }),
      thesisRow({ id: "wst", ticker: "WST", status: "WATCHING", direction: "LONG", triggers: [], researchRun: run }),
    ],
    agentConfig: [agentConfigRow({ id: ANALYST, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
    account: [accountRow({ triggers: rule ? [rule] : [], triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
    position: [positionRow({ id: "pos_nvda", analystId: ANALYST, symbol: "NVDA", avgCost: 218.23, quantity: 10, openedAt: new Date("2026-08-31T13:53:39Z") })],
    sharedNote: notes,
  });
}

/** One pass of the check on `db` at `at`: started by the saved note (`event`), or by the clock. */
async function pass(db: ReturnType<typeof prismaDouble>, at: Date, event?: { name: string }) {
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  let returned: Record<string, unknown> | undefined;
  jest.useFakeTimers({ now: at, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) => (path.startsWith("/quote?symbol=") ? { data: { c: 162.26, pc: 170.1, o: 170.1, dp: -4.6, t: Math.floor(at.getTime() / 1000) - 60_000 } } : { data: null }),
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({}) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      returned = await handler!({
        event,
        step: { run: async (_name: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: { name: string; data: Record<string, unknown> }) => void sent.push(e) },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { fired: sent.filter((e) => e.name === "app/thesis.trigger.fired").map((e) => e.data), returned };
}
const NOTES_SAVED = { name: "app/market-notes.saved" };

describe("NVDA, Fri 2026-11-13: the Market Reviewer's high note, with the owner's rule saved", () => {
  it("the rule reads as one sentence, and the form accepts it on the account, an analyst or a stock, as a review only", () => {
    expect(sentenceOf(RULE as never)).toBe("Review if the Market Reviewer writes a high note on it");
    expect(whenValid(RULE.predicate)).toBe(true);
    for (const level of ["ACCOUNT", "ANALYST", "THESIS"] as const) expect([level, conditionProblem({ watch: "note" }, { level, held: false })]).toEqual([level, null]);
    expect(MEASURES.note.actions).toEqual(["REVIEW"]);
    expect(TRIGGER_TYPES.find((t) => t.id === "news")?.measures.map((m) => m.id)).toEqual(["note"]);
  });

  it("the saved note starts the check before the session, and NVDA gets one run that is handed the note", async () => {
    const db = book(RULE, [note("n1", "2026-11-13T12:30:40Z")]);
    const { fired, returned } = await pass(db, SAVED_AT, NOTES_SAVED);
    expect(returned).not.toMatchObject({ skipped: "market-closed" });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ thesisId: "nvda", ticker: "NVDA", triggerId: RULE.id, action: "REVIEW" });
    expect(fired[0].firedContext).toBe(`The Market Reviewer's high note on NVDA, 11-13 07:30: "Nvidia said its chief executive resigned, effective today."`);
  });

  it("one run per stock per note: the passes in market hours that day don't fire it again, and a new high note the next week does", async () => {
    const db = book(RULE, [note("n1", "2026-11-13T12:30:40Z")]);
    expect((await pass(db, SAVED_AT, NOTES_SAVED)).fired).toHaveLength(1);
    expect((await pass(db, new Date("2026-11-13T14:35:00Z"))).fired).toEqual([]);
    expect((await pass(db, new Date("2026-11-13T21:22:00Z"))).fired).toEqual([]);
    (db.store.sharedNote as Array<Record<string, unknown>>).push(note("n2", "2026-11-16T12:30:10Z", { body: "Nvidia named a new chief executive." }));
    const monday = await pass(db, new Date("2026-11-16T12:31:00Z"), NOTES_SAVED);
    expect(monday.fired.map((f) => f.thesisId)).toEqual(["nvda"]);
    expect(String(monday.fired[0].firedContext)).toContain("Nvidia named a new chief executive.");
  });

  it("a note the clock's pass finds first fires there: the saved-note pass is not the only way in", async () => {
    const db = book(RULE, [note("n1", "2026-11-13T12:30:40Z")]);
    expect((await pass(db, new Date("2026-11-13T14:35:00Z"))).fired.map((f) => f.thesisId)).toEqual(["nvda"]);
  });

  it("a medium or a low note starts nothing, and neither does a note on another stock or one older than a day", async () => {
    for (const notes of [
      [note("m", "2026-11-13T12:30:40Z", { impact: "medium" })],
      [note("l", "2026-11-13T12:30:40Z", { impact: "low" })],
      [note("other", "2026-11-13T12:30:40Z", { tickers: ["MU"] })],
      [note("old", "2026-11-11T12:30:40Z")],
    ]) {
      expect([notes[0].id, (await pass(book(RULE, notes), SAVED_AT, NOTES_SAVED)).fired]).toEqual([notes[0].id, []]);
    }
  });

  it("until the owner saves the rule, a high note starts no run", async () => {
    expect((await pass(book(null, [note("n1", "2026-11-13T12:30:40Z")]), SAVED_AT, NOTES_SAVED)).fired).toEqual([]);
  });

  it("left on Flag for Review, the fire is written down for the morning run and starts no run", async () => {
    const flagged = { ...RULE, fireMode: "NEXT_MORNING" };
    const db = book(flagged, [note("n1", "2026-11-13T12:30:40Z")]);
    expect((await pass(db, SAVED_AT, NOTES_SAVED)).fired).toEqual([]);
    const rows = ((db.store.thesisUpdate ?? []) as Array<Record<string, unknown>>).filter((r) => r.type === "TRIGGER_FIRED");
    expect(rows.map((r) => [r.thesisId, r.triggerId])).toEqual([["nvda", RULE.id]]);
    expect(String(rows[0].rationale)).toContain("Nvidia said its chief executive resigned");
  });

  it("the pass a saved note starts reads nothing else: a price trigger true before the open doesn't fire on it", async () => {
    const db = book(RULE, [note("n1", "2026-11-13T12:30:40Z")]);
    (db.store.thesis as Array<Record<string, unknown>>)[0].triggers = [{ id: "floor", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 200 }, rationale: "(not kept)" }];
    expect((await pass(db, SAVED_AT, NOTES_SAVED)).fired.map((f) => f.triggerId)).toEqual([RULE.id]);
  });
});
