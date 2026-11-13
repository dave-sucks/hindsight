/**
 * complete-run.listed-work.replay.test.ts — a run owes an answer on exactly
 * the stocks its read listed as work.
 *
 * Production, the Secular Compounder's morning run of 2026-11-13: its opening
 * get_theses listed 12 stocks. complete_run asked about 6 and finished with
 * four never answered: CEG (the owner's edit, unanswered), and AAPL, EME and
 * ASML (sold earlier, back on watch, so still carrying a closedAt the
 * close-out filtered on). The close-out had its own list; now it reads the
 * read's (loadStockFacts + listsTheStock).
 *
 * The rows are production's as they stood at the opening read (08:03 ET),
 * read-only, in lib/agent/__fixtures__/closeout-secular-2026-11-13.json: the
 * 12 listed stocks and FTNT, quiet though in a situation. Review dates, fire
 * stamps and trigger state are the read's own; AAPL's buy is its level before
 * the 09:30 move. Lines before the read: since each stock's last answer, plus
 * its last plan edit. No note text, no quantities; a rule's words are dropped.
 */
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/closeout-secular-2026-11-13.json";
import {
  replayTool,
  thesisRow,
  positionRow,
  agentConfigRow,
  accountRow,
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
  REPLAY_USER_ID,
  type Row,
} from "@/lib/replay";

const FIXTURE = "lib/agent/__fixtures__/closeout-secular-2026-11-13.json";
/** The opening read: 08:03 ET, and the 12 stocks it listed as work. */
const READ_AT = "2026-11-13T13:03:30.000Z";
const LISTED = ["AAPL", "ASML", "BWXT", "CEG", "CRWD", "EME", "ETN", "GEV", "ISRG", "NOW", "TRV", "WST"];
type Fx = {
  theses: Array<Row & { id: string; ticker: string; price: number }>;
  analyst: { triggers: Row[]; setupIds: string[]; maxOpenPositions: number };
  account: { triggers: Row[]; triggersSeededAt: string; setupOverrides: Row | null };
  positions: Row[];
  orders: Row[];
  updates: Array<Row & { runId?: string }>;
  runAnswers: Array<[string, string]>;
};
const fx = fixture as unknown as Fx;

/** A stored rule; its words are not kept in the fixture, and the parse wants some. */
const rule = (t: Row): Row => ({ rationale: "(not kept)", ...t });
/** The row without the read's price, which goes to the quote double instead. */
const stored = ({ price, ...t }: Fx["theses"][number]): Row => (void price, t);
const date = (v: unknown) => (typeof v === "string" ? new Date(v) : v ?? null);
const dated = (r: Row, keys: string[]): Row => ({ ...r, ...Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, date(r[k])])) });

/** The book as the run read it; with the run's own answers when `answered`. */
function seed(answered: boolean): Record<string, Row[]> {
  const run = { id: REPLAY_RUN_ID, status: "RUNNING", mode: "MORNING_PLAN", agentConfigId: REPLAY_ANALYST_ID, parameters: {}, startedAt: new Date("2026-11-13T13:03:26.258Z"), completedAt: null };
  // A line's run mode only titles it in the feed, so the fixture does not keep it.
  const line = (u: Row & { runId?: string; mode?: string }): Row => ({
    triggerId: null, runId: null, summary: null, rationale: null, fieldChanges: {}, priceAtTime: null, positionAtTime: null,
    signalIds: [], tradeId: null, verdict: null, verdictLine: null, answersUpdateId: null, answers: null, triggerAction: null, triggerCondition: null,
    ...dated(u, ["timestamp"]),
    run: u.mode ? { mode: u.mode } : null,
  });
  const answers = answered
    ? fx.runAnswers.map(([thesisId, at], i) => line({ id: `answer_${i}`, thesisId, type: "REVIEWED", timestamp: at, runId: REPLAY_RUN_ID, mode: "MORNING_PLAN" }))
    : [];
  return {
    researchRun: [run],
    runEvent: [{ id: "ev_summary", runId: REPLAY_RUN_ID, type: "run_summary", title: "Run summary", message: null, payload: {}, createdAt: new Date("2026-11-13T13:04:40Z") }],
    agentConfig: [agentConfigRow({ triggers: fx.analyst.triggers.map(rule), setupIds: fx.analyst.setupIds, maxOpenPositions: fx.analyst.maxOpenPositions })],
    account: [accountRow({ triggers: fx.account.triggers.map(rule), triggersSeededAt: new Date(fx.account.triggersSeededAt), setupOverrides: fx.account.setupOverrides })],
    thesis: fx.theses.map(stored).map((t) =>
      thesisRow({
        // The fixture leaves out empty columns; the row builder's defaults are a plan this stock may not have.
        direction: null, setupId: null, horizon: null, entryPrice: null, targetPrice: null, stopLoss: null, catalystDate: null, closedAt: null, triggerState: {},
        ...dated(t, ["createdAt", "lastReviewedAt", "researchUpdatedAt", "catalystDate", "closedAt"]),
        triggers: ((t.triggers as Row[] | undefined) ?? []).map(rule),
        researchRun: { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: "Secular Compounder", setupIds: fx.analyst.setupIds } },
      }),
    ),
    position: fx.positions.map((p) => positionRow({ ...dated(p, ["openedAt"]), quantity: 1, initialQty: 1, environment: "LIVE" })),
    order: fx.orders.map((o) => ({
      userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", quantity: 1, orderType: "MARKET", rationale: null, rejectionMessage: null,
      alpacaConfirmedAt: null, filledPrice: null, ...dated(o, ["createdAt", "expiresAt", "updatedAt"]),
    })),
    thesisUpdate: [...fx.updates.map(line), ...answers],
  };
}

const quotes = Object.fromEntries(fx.theses.map((t) => [t.ticker, t.price]));
const ctx = { runMode: "MORNING_PLAN", runEnvironment: "LIVE", maxOpenPositions: fx.analyst.maxOpenPositions };

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

/** The run's verbatim opening read: the tickers it listed as work. */
async function listedByTheRead(): Promise<string[]> {
  const { result, crashed } = await at(READ_AT, () =>
    replayTool("get-theses", "getTheses", { seed: seed(false), args: { limit: 25, detail: "actionable" }, ctx, quotes }),
  );
  expect(crashed).toBe(false);
  return ((result.data as { theses?: Array<{ ticker: string }> }).theses ?? []).map((r) => r.ticker).sort();
}

/** complete_run at the run's second call (08:05 ET): its refusal, and the tickers it names. */
async function closeOut(answered: boolean): Promise<{ message: string; owed: string[]; status: unknown }> {
  const { result, crashed, db } = await at("2026-11-13T13:05:25.000Z", () =>
    replayTool("complete-run", "completeRun", { seed: seed(answered), args: {}, ctx, quotes }),
  );
  expect(crashed).toBe(false);
  const message = String((result.data as { error?: string } | undefined)?.error ?? "");
  const owed = Array.from(message.matchAll(/\b([A-Z]{1,5}) \(t_\1\)/g), (m) => m[1]).sort();
  return { message, owed, status: db.store.researchRun[0].status };
}

describe("Secular Compounder, 2026-11-13: the close-out owes what the read listed", () => {
  it("the run's second complete_run, every answer it wrote on the record: refused, naming CEG, AAPL, EME and ASML with their situations", async () => {
    const { message, owed, status } = await closeOut(true);
    // In production this call completed the run with all four unanswered.
    expect(owed).toEqual(["AAPL", "ASML", "CEG", "EME"]);
    expect(status).toBe("RUNNING");
    expect(message).toMatch(/CEG \(t_CEG\): your word unanswered/);
    expect(message).toMatch(/AAPL \(t_AAPL\): research stale/);
    expect(message).toMatch(/EME \(t_EME\): review due/);
    expect(message).toMatch(/ASML \(t_ASML\): review due/);
  });

  it("the close-out's owed set is the read's listed set, and both are the 12 the run's read listed", async () => {
    const listed = await listedByTheRead();
    const { owed } = await closeOut(false);
    expect(owed).toEqual(listed);
    expect(listed).toEqual(LISTED);
    // FTNT is in a situation (a plan check that does not list) and is not owed.
    expect(owed).not.toContain("FTNT");
  });

  it("the fixture holds the read's rows and no more, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(20_000);
    expect(fx.theses.map((t) => t.ticker).sort()).toEqual([...LISTED, "FTNT"].sort());
  });
});
