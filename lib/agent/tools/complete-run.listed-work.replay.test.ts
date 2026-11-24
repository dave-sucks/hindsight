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
 * stamps and trigger state are the read's own; AAPL's and WST's buys are their
 * levels before the 09:30 move. Lines before the read: since each stock's last
 * answer, plus its last plan edit. No note text, no quantities; a rule's words
 * are dropped.
 *
 * Plan checks, stale research and "no setup named" were deleted on
 * 2026-11-13: six of the 12 were listed by those alone (AAPL, BWXT, CRWD, TRV
 * and WST by stale research; ISRG by stale research and a plan check), so the
 * same read lists six now.
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
/** The opening read: 08:03 ET, and the 12 stocks it listed as work in production. */
const READ_AT = "2026-11-13T13:03:30.000Z";
const LISTED = ["AAPL", "ASML", "BWXT", "CEG", "CRWD", "EME", "ETN", "GEV", "ISRG", "NOW", "TRV", "WST"];
/** The six that stay listed with the three situations gone. */
const LISTED_NOW = ["ASML", "CEG", "EME", "ETN", "GEV", "NOW"];
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

/** The book as the run read it; with the run's own answers when `answered` (saved with no note when `noteless`, 2026-11-18), and `more` stocks saved after it. */
function seed(answered: boolean, noteless = false, more: Fx["theses"] = []): Record<string, Row[]> {
  const run = { id: REPLAY_RUN_ID, status: "RUNNING", mode: "MORNING_PLAN", agentConfigId: REPLAY_ANALYST_ID, parameters: {}, startedAt: new Date("2026-11-13T13:03:26.258Z"), completedAt: null };
  // A line's run mode only titles it in the feed, so the fixture does not keep it.
  const line = (u: Row & { runId?: string; mode?: string }): Row => ({
    triggerId: null, runId: null, summary: null, rationale: null, fieldChanges: {}, priceAtTime: null, positionAtTime: null,
    signalIds: [], tradeId: null, verdict: null, verdictLine: null, answersUpdateId: null, answers: null, triggerAction: null, triggerCondition: null,
    ...dated(u, ["timestamp"]),
    run: u.mode ? { mode: u.mode } : null,
  });
  const answers = answered
    ? fx.runAnswers.map(([thesisId, at], i) => line({ id: `answer_${i}`, thesisId, type: noteless ? "UPDATED" : "REVIEWED", timestamp: at, runId: REPLAY_RUN_ID, mode: "MORNING_PLAN", ...(noteless ? { fieldChanges: { noNote: { from: null, to: true } } } : {}) }))
    : [];
  return {
    researchRun: [run],
    runEvent: [{ id: "ev_summary", runId: REPLAY_RUN_ID, type: "run_summary", title: "Run summary", message: null, payload: {}, createdAt: new Date("2026-11-13T13:04:40Z") }],
    agentConfig: [agentConfigRow({ triggers: fx.analyst.triggers.map(rule), setupIds: fx.analyst.setupIds, maxOpenPositions: fx.analyst.maxOpenPositions })],
    account: [accountRow({ triggers: fx.account.triggers.map(rule), triggersSeededAt: new Date(fx.account.triggersSeededAt), setupOverrides: fx.account.setupOverrides })],
    thesis: [...fx.theses, ...more].map(stored).map((t) =>
      thesisRow({
        // The fixture leaves out empty columns; the row builder's defaults are a plan this stock may not have.
        direction: null, setupId: null, horizon: null, entryPrice: null, targetPrice: null, stopLoss: null, catalystDate: null, closedAt: null, triggerState: {},
        ...dated(t, ["createdAt", "lastReviewedAt", "researchUpdatedAt", "catalystDate", "closedAt"]),
        // The read takes the newest-saved first; the fixture keeps no save time, so a stock's is its last review.
        updatedAt: new Date((t.updatedAt as string | undefined) ?? (t.lastReviewedAt as string)),
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

/** Fifteen quiet stocks saved after every stock in the fixture: FTNT's row, which nothing lists, under other names. */
const FILLERS: Fx["theses"] = Array.from({ length: 15 }, (_, i) => ({
  ...fx.theses.find((t) => t.ticker === "FTNT")!,
  id: `t_Q${i}`,
  ticker: `Q${i}`,
  updatedAt: "2026-11-13T12:00:00.000Z",
}));
const quotes = Object.fromEntries([...fx.theses, ...FILLERS].map((t) => [t.ticker, t.price]));
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
async function listedByTheRead(more: Fx["theses"] = []): Promise<{ listed: string[]; leftOut: string | undefined }> {
  const { result, crashed } = await at(READ_AT, () =>
    replayTool("get-theses", "getTheses", { seed: seed(false, false, more), args: { limit: 25, detail: "actionable" }, ctx, quotes }),
  );
  expect(crashed).toBe(false);
  const data = result.data as { theses?: Array<{ ticker: string }>; left_out?: string };
  return { listed: (data.theses ?? []).map((r) => r.ticker).sort(), leftOut: data.left_out };
}

/** complete_run at the run's second call (08:05 ET): its refusal, and the tickers it names. */
async function closeOut(answered: boolean, noteless = false, more: Fx["theses"] = []): Promise<{ message: string; owed: string[]; status: unknown }> {
  const { result, crashed, db } = await at("2026-11-13T13:05:25.000Z", () =>
    replayTool("complete-run", "completeRun", { seed: seed(answered, noteless, more), args: {}, ctx, quotes }),
  );
  expect(crashed).toBe(false);
  const message = String((result.data as { error?: string } | undefined)?.error ?? "");
  const owed = Array.from(message.matchAll(/\b([A-Z]{1,5}) \(t_\1\)/g), (m) => m[1]).sort();
  return { message, owed, status: db.store.researchRun[0].status };
}

describe("Secular Compounder, 2026-11-13: the close-out owes what the read listed", () => {
  it("the run's second complete_run, every answer it wrote on the record: refused, naming CEG, EME and ASML with their situations", async () => {
    const { message, owed, status } = await closeOut(true);
    // In production this call completed the run with these three and AAPL unanswered; AAPL was owed for stale research alone.
    expect(owed).toEqual(["ASML", "CEG", "EME"]);
    expect(status).toBe("RUNNING");
    // CEG's floor had fired and was still past: a fired sale stays on the list (2026-11-17).
    expect(message).toMatch(/CEG \(t_CEG\): possible sale;/);
    expect(message).not.toMatch(/AAPL/);
    expect(message).toMatch(/EME \(t_EME\): review/);
    expect(message).toMatch(/ASML \(t_ASML\): review/);
  });

  it("the close-out's owed set is the read's listed set: the 12 the run's read listed, less the six the deleted situations alone listed", async () => {
    const { listed } = await listedByTheRead();
    const { owed } = await closeOut(false);
    expect(owed).toEqual(listed);
    expect(listed).toEqual(LISTED_NOW);
    expect(LISTED.filter((t) => !LISTED_NOW.includes(t))).toEqual(["AAPL", "BWXT", "CRWD", "ISRG", "TRV", "WST"]);
    // FTNT was in a situation only by a plan check that did not list; it is quiet and not owed.
    expect(owed).not.toContain("FTNT");
  });

  it("the fixture holds the read's rows and no more, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(20_000);
    expect(fx.theses.map((t) => t.ticker).sort()).toEqual([...LISTED, "FTNT"].sort());
  });

  it("a change saved with no note answers nothing: the same answers saved without a note owe what no answers owe", async () => {
    const none = await closeOut(false);
    const noteless = await closeOut(true, true);
    expect(noteless.owed).toEqual(none.owed);
    expect(noteless.status).toBe("RUNNING");
  }, 30_000);
});

describe("the same book with 15 more stocks: 28 stocks, and a read limited to 25", () => {
  it("lists every stock in work and cuts only quiet ones, so the close-out owes what the read listed", async () => {
    const { listed, leftOut } = await listedByTheRead(FILLERS);
    const { owed } = await closeOut(false, false, FILLERS);
    // On main the read cut by when each stock was saved: ETN, ASML and EME (the oldest) were left out with their
    // work, the close-out still owed them, and the read listed only CEG, GEV and NOW.
    expect(listed).toEqual(LISTED_NOW);
    expect(owed).toEqual(listed);
    // 28 stocks, 25 shown: three quiet ones are the three left out.
    expect(leftOut).toMatch(/^3 more stocks match this read/);
  });

  it("keeps every stock in work when they alone outnumber the limit", async () => {
    const { result } = await at(READ_AT, () =>
      replayTool("get-theses", "getTheses", { seed: seed(false, false, FILLERS), args: { limit: 4, detail: "actionable" }, ctx, quotes }),
    );
    const data = result.data as { theses: Array<{ ticker: string }>; quiet_theses: unknown[] };
    expect(data.theses.map((t) => t.ticker).sort()).toEqual(LISTED_NOW);
    expect(data.quiet_theses).toHaveLength(0);
  });
});
