/**
 * sale-waiting.replay.test.ts — a sale waiting for the principal's approval
 * is off the agent's work list, as a waiting buy is (the owner's ruling,
 * 2026-10-14). The principal's answer is the next step; when the proposal
 * expires, the floor fires again on its own.
 *
 * A sale proposal lives a day, so the 8 AM run usually finds yesterday's sale
 * still waiting. Until this, the stock stayed flagged; close_position handed
 * back the waiting order, and nothing the run could do answered the flag:
 *
 *  - MU, 2026-10-13 08:00 ET (PEAD Specialist): the 10-12 sale was waiting.
 *    complete_run refused the run over MU's lapsed sale; the run saved a
 *    conviction edit to get past it, its note saying it took the stop. Nothing
 *    sold.
 *  - NVDA, 2026-10-09 08:00 ET: its fired $236 sale was the stock's only work,
 *    its 10-08 proposal waiting. The run's note said it took the stop. Nothing
 *    sold.
 *
 * Production rows, read-only (sale-waiting-2026-10.json, with MU's row and
 * orders from sale-lapses-2026-10-13.json), through get_theses' and
 * complete_run's real entry points.
 */
import { statSync } from "fs";
import waiting from "@/lib/agent/__fixtures__/sale-waiting-2026-10.json";
import lapses from "@/lib/agent/__fixtures__/sale-lapses-2026-10-13.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID, REPLAY_ANALYST_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { rowForModel } from "@/lib/agent/row-for-model";
import type { Trigger } from "@/lib/agent/triggers/types";

const FIXTURE = "lib/agent/__fixtures__/sale-waiting-2026-10.json";

type Run = { id: string; mode: string; startedAt: string };
type Event = { type: string; createdAt: string; payload: Row };
const fx = waiting as unknown as {
  analystTriggers: Row[];
  accountTriggers: Row[];
  accountTriggersSeededAt: string;
  mu: { run: Run; activity: Row[]; runRows: Row[]; events: Event[]; expired: { at: string; price: number; order: Row; activity: Row[] } };
  nvda: { run: Run; price: number; readSituations: string[]; says: string[]; thesis: Row & { id: string; triggers: Trigger[] }; position: Row; order: Row; activity: Row[]; events: Event[] };
};
const mu = lapses.mu as unknown as { at: string; price: number; thesis: Row & { id: string }; position: Row; orders: Array<Row & { id: string; status: string }>; readThen: Row };

const dated = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) && typeof v === "string" ? new Date(v) : v]));
/** Every order carries its thesis in production; the lapse fixture left the id off. */
const orderRow = (thesisId: string, o: Row): Row => ({ userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, orderType: "MARKET", rejectionMessage: null, ...dated(o, ["createdAt", "expiresAt", "updatedAt"]), thesisId });
const lines = (thesisId: string, rows: Row[]) => rows.map((u) => thesisUpdateRow({ ...dated(u, ["timestamp"]), thesisId }));
const runRow = (r: Run): Row => ({ id: r.id, status: "RUNNING", mode: r.mode, agentConfigId: REPLAY_ANALYST_ID, parameters: {}, startedAt: new Date(r.startedAt), completedAt: null });
const eventRows = (runId: string, events: Event[]): Row[] => events.map((e, i) => ({ id: `ev_${i}`, runId, type: e.type, title: e.type, message: null, payload: e.payload, createdAt: new Date(e.createdAt) }));
/** The analyst's and the account's rules, which every holding inherits. */
const ladders = () => ({
  agentConfig: [agentConfigRow({ triggers: fx.analystTriggers })],
  account: [accountRow({ triggers: fx.accountTriggers, triggersSeededAt: new Date(fx.accountTriggersSeededAt) })],
});

const MU_ID = mu.thesis.id;
const muSeed = (orders: Row[] = mu.orders, activity: Row[] = fx.mu.activity) => ({
  ...ladders(),
  thesis: [thesisRow(dated(mu.thesis, ["createdAt", "lastReviewedAt", "researchUpdatedAt", "catalystDate"]))],
  position: [positionRow({ ...dated(mu.position, ["openedAt"]), symbol: "MU", environment: "LIVE" })],
  order: orders.map((o) => orderRow(MU_ID, o)),
  thesisUpdate: lines(MU_ID, activity),
});

const nv = fx.nvda;
const nvSeed = () => ({
  ...ladders(),
  thesis: [thesisRow({ ...dated(nv.thesis, ["createdAt", "lastReviewedAt", "researchUpdatedAt"]), ticker: "NVDA" })],
  position: [positionRow({ ...dated(nv.position, ["openedAt"]), symbol: "NVDA", environment: "LIVE" })],
  order: [orderRow(nv.thesis.id, nv.order)],
  thesisUpdate: lines(nv.thesis.id, nv.activity),
});

/** The clock at a production moment; the double's timers stay real. */
async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await fn();
  } finally {
    jest.useRealTimers();
  }
}

type Read = { row: Row | null; quiet: Row | null; modelRow: Row | null; modelLine: string | null };

/** The morning read of one stock: the screen's row or quiet entry, and what the model reads of it (the one row builder). */
async function morningRead(seed: Record<string, Row[]>, when: string, ticker: string, price: number): Promise<Read> {
  return at(when, async () => {
    const { result, crashed } = await replayTool("get-theses", "getTheses", { seed, args: { detail: "actionable" }, ctx: { runEnvironment: "LIVE" }, quotes: { [ticker]: price } });
    if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 2000)}`);
    const screen = result.data as { theses?: Row[]; quiet_theses?: Row[] };
    const row = screen.theses?.find((r) => r.ticker === ticker) ?? null;
    const quiet = screen.quiet_theses?.find((r) => r.ticker === ticker) ?? null;
    return {
      row,
      quiet,
      modelRow: row ? (rowForModel(row, { named: false, size: "short" }) as Row) : null,
      modelLine: quiet ? (rowForModel(quiet, { named: false, size: "line" }) as string) : null,
    };
  });
}

/** When the run wrote its summary: the first complete_run came seconds after. */
const summaryAt = (events: Event[]) => events.find((e) => e.type === "run_summary")!.createdAt;

async function completeRun(seed: Record<string, Row[]>, when: string, run: Run, quotes: Record<string, number>) {
  return at(when, () => replayTool("complete-run", "completeRun", { seed: { ...seed, researchRun: [runRow(run)] }, args: {}, ctx: { runId: run.id, runEnvironment: "LIVE" }, quotes }));
}

describe("MU 10-13 08:00 ET: the 10-12 sale is waiting, so it is not the run's work", () => {
  it("the read: no sale situation, the open review still flags, and the row says the sale waits", async () => {
    // The run's own read: MU flagged for the sale, with its review beside it.
    expect(mu.orders.map((o) => o.status)).toEqual(["EXPIRED", "EXPIRED", "EXPIRED", "EXPIRED", "AWAITING_APPROVAL"]);
    expect((mu.readThen.needsAction as Row).kind).toBe("SALE_DECLINED");

    const { row, modelRow } = await morningRead(muSeed(), fx.mu.run.startedAt, "MU", mu.price);
    expect(row?.situations).toEqual(["REVIEW_DUE"]);
    // The lead is the -4% day review that fired 10-12 09:35 ET and no run had answered.
    expect(row?.needsAction).toMatchObject({ kind: "TRIGGER_FIRED", triggerId: "t6", action: "REVIEW" });
    expect((row?.needsAction as Row).alsoFired).toBeUndefined();
    // The facts stay on the row: the waiting sale, and the lapses before it.
    expect(modelRow?.proposal_waiting).toBe("sell 13 sh, placed 10-12 09:30 ET, expires 10-13 09:30 ET");
    expect(row?.heldThroughFloor).toMatchObject({ floorPrice: 1005, declined: 0, lapsed: 2 });
  });

  it("complete_run accepts the run at its first call: the note answered the review, and the sale was never its to answer", async () => {
    const seed = { ...muSeed(mu.orders, [...fx.mu.activity, ...fx.mu.runRows]), runEvent: eventRows(fx.mu.run.id, fx.mu.events) };
    const { result, db, crashed } = await completeRun(seed, summaryAt(fx.mu.events), fx.mu.run, { MU: mu.price });

    expect(crashed).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
    // The REVIEWED note was all the run wrote on MU before that call.
    expect(fx.mu.runRows.map((r) => r.type)).toEqual(["REVIEWED"]);
  });

  it("with no line on MU at all, complete_run asks only for the open review, not the sale", async () => {
    const seed = { ...muSeed(), runEvent: eventRows(fx.mu.run.id, fx.mu.events) };
    const { result, crashed } = await completeRun(seed, summaryAt(fx.mu.events), fx.mu.run, { MU: mu.price });

    expect(crashed).toBe(false);
    const text = JSON.stringify(result);
    expect(result.summary).toMatch(/refused/i);
    expect(text).toContain("MU (cmrp6chyu000h04l5roqq5ha1): trigger fired: REVIEW (Review if below 4% from yesterday's close)");
    expect(text).not.toMatch(/lapse|Sell if below|declined/i);
  });
});

describe("MU 10-13 14:00:57 UTC: the 10-12 sale has expired, so the sale is back", () => {
  it("no sale waits: the lapsed sale leads again, now three lapses", async () => {
    const e = fx.mu.expired;
    const orders = mu.orders.map((o) => (o.status === "AWAITING_APPROVAL" ? { ...o, ...e.order } : o));
    const { row, modelRow } = await morningRead(muSeed(orders, [...fx.mu.activity, ...fx.mu.runRows, ...e.activity]), e.at, "MU", e.price);

    expect(row?.situations).toEqual(expect.arrayContaining(["PROTECTIVE_SALE"]));
    expect(row?.needsAction).toMatchObject({ kind: "SALE_DECLINED", declineCount: 0, lapseCount: 3, floorPrice: 1005 });
    expect(modelRow?.proposal_waiting).toBeUndefined();
  });
});

describe("NVDA 10-09 08:00 ET: the fired $236 sale was its only work, and that sale was waiting", () => {
  it("the row is the read's: each trigger says what the read showed", () => {
    expect(nv.thesis.triggers.map((t) => sentenceOf(t, true))).toEqual(nv.says);
    expect(nv.readSituations).toEqual(["PROTECTIVE_SALE"]);
  });

  it("the read: NVDA is a quiet line, and the line says the sale waits", async () => {
    const { row, quiet, modelLine } = await morningRead(nvSeed(), nv.run.startedAt, "NVDA", nv.price);
    expect(row).toBeNull();
    expect(quiet).not.toBeNull();
    expect(modelLine).toBe(
      "NVDA · held · LONG · PEAD · $230.48 · entry $218.23 · target $322.00 · floor $236.00 · proposal waiting: sell 33 sh, placed 10-08 09:31 ET, expires 10-09 09:31 ET · review 10-14 · score 8 · id cmtg9nbdy000204jpc6cwawgg",
    );
  });

  it("complete_run accepts the run with no line on NVDA", async () => {
    const seed = { ...nvSeed(), runEvent: eventRows(nv.run.id, nv.events) };
    const { result, db, crashed } = await completeRun(seed, summaryAt(nv.events), nv.run, { NVDA: nv.price });
    expect(crashed).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
  });
});

it("the fixture holds only the fields the read and complete_run use, under the cap", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(12 * 1024);
  for (const t of fx.analystTriggers) expect(t.rationale).toMatch(/not kept/);
});
