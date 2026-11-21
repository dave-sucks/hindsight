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
import type { StockTable } from "@/lib/agent/stock-table";
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

/**
 * MU's "Review if below $95" is left off: since a review fires when it is true (2026-11-17) it is due
 * on its own at this read, and these cases are about the card and the note.
 */
const MU_PRICE_REVIEW = "d9b6bc8d-017f-4355-8e8c-fe315084db87";

function seed(c: Case, { card = true, activity = c.activity, earlier = [] }: Options = {}): Record<string, Row[]> {
  const id = c.thesis.id;
  const order = (o: Row): Row => ({ userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, orderType: "MARKET", rejectionMessage: null, ...dated(o, ["createdAt", "expiresAt", "updatedAt"]), thesisId: id, positionId: c.order.positionId, environment: "LIVE", symbol: c.thesis.ticker, side: "SELL", intent: "CLOSE", closeReason: "STOP" });
  return {
    agentConfig: [agentConfigRow({ id: c.analyst.id, name: c.analyst.name })],
    thesis: [thesisRow({ ...dated(c.thesis, ["createdAt", "lastReviewedAt", "researchUpdatedAt"]), analystId: c.analyst.id, triggers: ((c.thesis.triggers ?? []) as Row[]).filter((t) => t.id !== MU_PRICE_REVIEW) })],
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
  const screen = result.data as { theses?: Row[]; quiet_theses?: Row[] };
  const row = screen.theses?.find((r) => r.ticker === ticker) ?? null;
  const quiet = screen.quiet_theses?.find((r) => r.ticker === ticker) ?? null;
  return {
    row,
    quiet,
    // The stock's line of the stock table: what the model reads of a quiet stock.
    waiting: (result.data as { stocks?: StockTable }).stocks?.rows.find((r) => r.ticker === ticker)?.waiting ?? null,
    modelRow: row ? (rowForModel(row, { named: false, size: "short" }) as Row) : null,
  };
}

describe.each(CASES)("%s at the 11-16 morning read: a sale card waits, and a high note is on the stock", (ticker, c) => {
  it("is one quiet line that says the sale card waits: the note puts it on no list, and the card is the owner's", async () => {
    const { row, quiet, waiting } = await morningRead(seed(c), c);

    expect(row).toBeNull();
    expect(quiet).not.toBeNull();
    // The sell tool refuses a second sale while it waits (below).
    expect(waiting).toBe("sell 10");
  });

  it("the sale itself is not asked again: no situation and no lead", async () => {
    const { quiet } = await morningRead(seed(c), c);

    expect(quiet?.situations ?? []).toEqual([]);
    expect(quiet?.needsAction ?? null).toBeNull();
  });

  it("with no card waiting, the same rows put the sale first: the card is what silences it", async () => {
    const { row } = await morningRead(seed(c, { card: false }), c);

    expect(row?.situations).toEqual(["PROTECTIVE_SALE"]);
    expect(row?.needsAction).toMatchObject({ kind: "TRIGGER_MATCHING_NOW", action: "EXIT" });
  });

  it("a sale that fired and no run has answered is the card's too: still not asked again", async () => {
    // The fire is open: no run has written on the stock since it.
    const open = c.activity.filter((u) => u.type === "TRIGGER_FIRED");
    const { row, quiet } = await morningRead(seed(c, { activity: open }), c);

    expect(row).toBeNull();
    expect(quiet?.needsAction ?? null).toBeNull();
  });

  it("a sale the principal declined before is the card's too: not asked again while a new card waits", async () => {
    const declined = { id: `declined_${ticker}`, status: "REJECTED", rejectionMessage: "not yet", quantity: 10, createdAt: "2026-11-10T15:00:00.000Z", updatedAt: "2026-11-10T16:00:00.000Z", expiresAt: null, triggerIds: [String((c.thesis.triggers as Row[]).find((t) => t.action === "EXIT")?.id)] };
    const waiting = await morningRead(seed(c, { earlier: [declined] }), c);
    expect(waiting.row).toBeNull();
    expect(waiting.quiet?.needsAction ?? null).toBeNull();

    // The same history with no card waiting is the declined sale's, asked again.
    const none = await morningRead(seed(c, { card: false, earlier: [declined] }), c);
    expect((none.row?.situations as string[] | undefined)?.[0]).toBe("PROTECTIVE_SALE");
    expect(none.row?.needsAction).toMatchObject({ kind: "SALE_DECLINED" });
  });
});

describe("a stock with only the sale card is still a quiet line", () => {
  it.each(CASES)("%s, a run has written since the note: nothing but the card, so nothing listed", async (_ticker, c) => {
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

  it.each(CASES)("%s: the read listed nothing, so the run owes nothing on it and closes", async (_ticker, c) => {
    const { message, status } = await closeOut(c, c.activity);

    expect(message).toBe("");
    expect(status).toBe("COMPLETE");
  });

});

describe("a sale that already waits is a refusal: the sell tool says the card is the owner's to answer", () => {
  const sellNow = (c: Case, args: Row, card = true) =>
    at(fx.at, () => replayTool("sell", "sell", { seed: seed(c, { card }), args: { ticker: c.thesis.ticker, ...args }, ctx: ctxOf(c), quotes: { [c.thesis.ticker]: c.price } }));

  it.each(CASES)("%s: a second sale, whole or part, is refused while the card waits, and no order is written or sent", async (ticker, c) => {
    for (const args of [{ belief_survived: true }, { percent: 50 }]) {
      const { result, sends, db } = await sellNow(c, args);
      const data = result.data as { success?: boolean; status?: string; message?: string };
      expect([data.success, data.status]).toEqual([false, "FAILED"]);
      expect(data.message).toBe("A sale of 10 $" + ticker + " shares already waits for the owner. That card is theirs to answer: approve, edit or decline it. Say what you found in your note, or raise the sale's price with edit_triggers.");
      expect(sends).toEqual([]);
      expect(db.store.order).toHaveLength(1);
    }
  });

  it.each(CASES)("%s: with no card waiting, the sale is not refused for one", async (_ticker, c) => {
    const { result } = await sellNow(c, { belief_survived: true }, false);
    expect(JSON.stringify(result)).not.toContain("already waits for the owner");
  });
});

it("the fixture holds only the rows the read uses, no text, under the cap", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(12 * 1024);
  expect(fx.note.body).toBe("(not kept)");
  for (const c of [fx.nvda, fx.mu]) for (const t of c.thesis.triggers) expect(t.rationale).toBe("(not kept)");
});
