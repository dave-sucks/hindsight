/**
 * sale-card-note.replay.test.ts — a sale card waiting for the principal
 * silences that sale, and nothing else on the stock.
 *
 * Production, Mon 2026-11-16, the 8:00 ET morning reads. The 7:30 Market
 * Reviewer wrote a high-impact note on NVDA and MU, pinned to 11-19, so each
 * stock was in "a note to answer" on the runs of the analyst that holds it
 * (PEAD Specialist, Secular Compounder). Both had a sale card waiting for the
 * principal, and a waiting sale took the whole stock off the list: each read
 * showed them as one quiet line, `situations: []`, and no analyst answered the
 * note. Since cards stopped expiring (#976) that is every stock with a card
 * open: NVDA, MU, IOT and PLTR, a third of the account, out of the morning
 * runs until the principal answers, with their review clocks, reports and notes.
 *
 * The rule: the card silences only that sale. The run does not propose it
 * again or argue it; every other situation on the stock still lists it, and
 * the row says the card waits (`proposal_waiting`).
 *
 * The rows are production's, through get_theses' and complete_run's real entry
 * points, with every price and count replaced by a round stand-in and no text
 * kept (lib/agent/__fixtures__/sale-card-pinned-note-2026-11-16.json).
 */
import { statSync } from "fs";
import fx from "@/lib/agent/__fixtures__/sale-card-pinned-note-2026-11-16.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, agentConfigRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import { rowForModel } from "@/lib/agent/row-for-model";

const FIXTURE = "lib/agent/__fixtures__/sale-card-pinned-note-2026-11-16.json";

interface Case {
  analyst: { id: string; name: string };
  price: number;
  thesis: Row & { id: string; ticker: string };
  position: Row;
  order: Row;
  activity: Row[];
}
const CASES: Array<[string, Case]> = [
  ["NVDA", fx.nvda as unknown as Case],
  ["MU", fx.mu as unknown as Case],
];

const dated = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) && typeof v === "string" ? new Date(v) : v]));

interface Options {
  /** The sale card waiting for the principal (the production state). */
  card?: boolean;
  /** The stock's audit lines; the fixture's by default. */
  activity?: Row[];
  /** Orders the principal answered before, as the read counts them. */
  earlier?: Row[];
}

function seed(c: Case, { card = true, activity = c.activity, earlier = [] }: Options = {}): Record<string, Row[]> {
  const id = c.thesis.id;
  const order = (o: Row): Row => ({ userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, orderType: "MARKET", rejectionMessage: null, ...dated(o, ["createdAt", "expiresAt", "updatedAt"]), thesisId: id, positionId: c.order.positionId, environment: "LIVE", symbol: c.thesis.ticker, side: "SELL", intent: "CLOSE", closeReason: "STOP" });
  return {
    agentConfig: [agentConfigRow({ id: c.analyst.id, name: c.analyst.name })],
    thesis: [thesisRow({ ...dated(c.thesis, ["createdAt", "lastReviewedAt", "researchUpdatedAt"]), analystId: c.analyst.id })],
    position: [positionRow({ ...dated(c.position, ["openedAt"]), analystId: c.analyst.id, symbol: c.thesis.ticker, environment: "LIVE" })],
    order: [...(card ? [order(c.order)] : []), ...earlier.map(order)],
    thesisUpdate: activity.map((u) => thesisUpdateRow({ ...dated(u, ["timestamp"]), thesisId: id })),
    sharedNote: [{ ...dated(fx.note as unknown as Row, ["pinnedUntil", "createdAt"]), userId: REPLAY_USER_ID, eventDate: null, analystId: null }],
  };
}

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

const ctxOf = (c: Case, extra: Row = {}) => ({ analystId: c.analyst.id, runMode: "MORNING_PLAN", runEnvironment: "LIVE" as const, ...extra });

/** The 8:00 read of one analyst's stock: the screen's row or quiet line, what the model reads of the row, and the guidance sent. */
async function morningRead(rows: Record<string, Row[]>, c: Case) {
  const ticker = c.thesis.ticker;
  const { result, crashed } = await at(fx.at, () =>
    replayTool("get-theses", "getTheses", { seed: rows, args: { detail: "actionable" }, ctx: ctxOf(c), quotes: { [ticker]: c.price } }),
  );
  if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 2000)}`);
  const screen = result.data as { theses?: Row[]; quiet_theses?: Row[]; guidance?: Record<string, string> };
  const row = screen.theses?.find((r) => r.ticker === ticker) ?? null;
  const quiet = screen.quiet_theses?.find((r) => r.ticker === ticker) ?? null;
  return {
    row,
    quiet,
    modelRow: row ? (rowForModel(row, { named: false, size: "short" }) as Row) : null,
    guidance: screen.guidance ?? {},
  };
}

describe.each(CASES)("%s at the 11-16 morning read: a sale card waits, and a high note is pinned on the stock", (ticker, c) => {
  it("is listed in a note to answer, and the row says the sale card waits", async () => {
    const { row, quiet, modelRow, guidance } = await morningRead(seed(c), c);

    expect(quiet).toBeNull();
    expect(row).not.toBeNull();
    expect(row?.situations).toEqual(["NOTE_TO_ANSWER"]);
    // The text an agent is sent for it travels with the read.
    expect(Object.keys(guidance)).toEqual(["NOTE_TO_ANSWER"]);
    // The row says the card waits: the run answers with a note or an edit, not a second sale.
    expect(modelRow?.proposal_waiting).toMatch(/^sell 10 sh, placed 11-13 09:\d\d ET$/);
    expect(String(row?.context)).toContain("Agent note to NVDA, MU");
  });

  it("the sale itself is not asked again: no sale in its situations, no sale as its lead", async () => {
    const { row } = await morningRead(seed(c), c);

    expect(row?.situations).not.toContain("PROTECTIVE_SALE");
    expect(row?.needsAction).toBeNull();
  });

  it("with no card waiting, the same rows put the sale first: the card is what silences it", async () => {
    const { row } = await morningRead(seed(c, { card: false }), c);

    expect(row?.situations).toEqual(["PROTECTIVE_SALE", "NOTE_TO_ANSWER"]);
    expect(row?.needsAction).toMatchObject({ kind: "TRIGGER_MATCHING_NOW", action: "EXIT" });
  });

  it("a sale that fired and no run has answered is the card's too: still not asked again", async () => {
    // The fire is open: no run has written on the stock since it.
    const open = c.activity.filter((u) => u.type === "TRIGGER_FIRED");
    const { row } = await morningRead(seed(c, { activity: open }), c);

    expect(row?.situations).toEqual(["NOTE_TO_ANSWER"]);
    expect(row?.needsAction).toBeNull();
  });

  it("a sale the principal declined before is the card's too: not asked again while a new card waits", async () => {
    const declined = { id: `declined_${ticker}`, status: "REJECTED", rejectionMessage: "not yet", quantity: 10, createdAt: "2026-11-10T15:00:00.000Z", updatedAt: "2026-11-10T16:00:00.000Z", expiresAt: null, triggerIds: [String((c.thesis.triggers as Row[]).find((t) => t.action === "EXIT")?.id)] };
    const waiting = await morningRead(seed(c, { earlier: [declined] }), c);
    expect(waiting.row?.situations).toEqual(["NOTE_TO_ANSWER"]);
    expect(waiting.row?.needsAction).toBeNull();

    // The same history with no card waiting is the declined sale's, asked again.
    const none = await morningRead(seed(c, { card: false, earlier: [declined] }), c);
    expect((none.row?.situations as string[] | undefined)?.[0]).toBe("PROTECTIVE_SALE");
    expect(none.row?.needsAction).toMatchObject({ kind: "SALE_DECLINED" });
  });
});

describe("a stock with only the sale card is still a quiet line", () => {
  it.each(CASES)("%s, the note answered: nothing but the card, so nothing listed", async (_ticker, c) => {
    // A run wrote on the stock after the note: it leaves the note's situation, and the card alone is not work.
    const answered = [...c.activity, { id: "act_answer", type: "REVIEWED", triggerId: null, timestamp: "2026-11-16T12:45:00.000Z", runId: "run_answered", priceAtTime: null, summary: "Reviewed", fieldChanges: {} }];
    const { row, quiet } = await morningRead(seed(c, { activity: answered }), c);

    expect(row).toBeNull();
    expect(quiet).not.toBeNull();
  });
});

describe("complete_run owes the stocks the read lists, a sale card waiting or not", () => {
  const RUN = { id: "run_morning_1116", mode: "MORNING_PLAN", status: "RUNNING", agentConfigId: "", parameters: {}, startedAt: new Date(fx.at), completedAt: null };
  const summary = { id: "ev_summary", runId: RUN.id, type: "run_summary", title: "Run summary", message: "Reviewed the book.", payload: {}, createdAt: new Date("2026-11-16T13:02:00.000Z") };

  async function closeOut(c: Case, activity: Row[]) {
    const rows = { ...seed(c, { activity }), researchRun: [{ ...RUN, agentConfigId: c.analyst.id }], runEvent: [summary] };
    const { result, crashed, db } = await at("2026-11-16T13:03:00.000Z", () =>
      replayTool("complete-run", "completeRun", { seed: rows, args: {}, ctx: ctxOf(c, { runId: RUN.id }), quotes: { [c.thesis.ticker]: c.price } }),
    );
    expect(crashed).toBe(false);
    return { message: String((result.data as { error?: string } | undefined)?.error ?? ""), status: db.store.researchRun[0].status };
  }

  it.each(CASES)("%s: refused until the run answers the pinned note, naming a note to answer", async (ticker, c) => {
    const { message, status } = await closeOut(c, c.activity);

    expect(status).toBe("RUNNING");
    expect(message).toContain(`${ticker} (${c.thesis.id}): a note to answer`);
  });

  it.each(CASES)("%s: accepted once a run's note is on the stock after the pinned one", async (_ticker, c) => {
    const note = { id: "act_run_note", type: "REVIEWED", triggerId: null, timestamp: "2026-11-16T13:02:30.000Z", runId: RUN.id, priceAtTime: null, summary: "Reviewed", fieldChanges: {} };
    const { message, status } = await closeOut(c, [...c.activity, note]);

    expect(message).toBe("");
    expect(status).toBe("COMPLETE");
  });
});

it("the fixture holds only the rows the read uses, no text, under the cap", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(12 * 1024);
  expect(fx.note.body).toBe("(not kept)");
  for (const c of [fx.nvda, fx.mu]) for (const t of c.thesis.triggers) expect(t.rationale).toBe("(not kept)");
});
