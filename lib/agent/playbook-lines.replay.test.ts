/**
 * playbook-lines.replay.test.ts — a playbook's templates, written by the
 * Writer, the buy proposal and the fill, on real production calls.
 *
 *   1. The Writer. HTFL: this PR's prompt, the real model, on the
 *      ground-truth data recorded 2026-11-13; its call, saved, writes
 *      exactly MA_PULLBACK's On a watch lines, each marked. ZTS
 *      (2026-11-16): a view no setup fits names none and carries the
 *      reviews that bring it back; nothing is marked a playbook's.
 *   2. AAPL (the trigger run's buy, 2026-11-13, BASE_BREAKOUT): place_trade
 *      names the sale and the playbook's other With the buy lines, the
 *      take-profit and the one-risk review, each with its reason; the
 *      pending position holds them and the card reads each as its sentence.
 *   3. Approved and filled: the buy, the Stop watching line and the watch
 *      lines from the playbook come off, the line written by hand stays,
 *      the sale and the take-profit (a Trim, never a review) go on, and the
 *      playbook's fill templates go on.
 *   4. The take-profit changed in Edit & Approve goes on at your price, as
 *      your line.
 *
 * The AAPL call is the recorded one; the sale and its reason are the ones
 * the run named that day, and the take-profit and the one-risk review are
 * filled from the chart its get_stock_data read, by the templates' rules.
 */
import raw from "@/lib/agent/__fixtures__/playbook-lines-2026-11.json";
import { replayTool, prismaDouble, triggerSentences, agentConfigRow, accountRow, thesisRow, REPLAY_ANALYST_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import type { StoreSeed } from "@/lib/replay/prisma-double";
import { validateThesisDecision, type ThesisDecisionInput, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { buySentences } from "@/lib/proposals/buy-lines";
import { PLAYBOOK_TEMPLATES } from "@/lib/agent/knowledge/playbook-templates";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { z } from "zod";

const fx = raw as unknown as {
  zts: { run: { id: string }; decision: Record<string, unknown> };
  htfl: { run: { id: string; price: number }; decision: Record<string, unknown> };
  aapl: {
    placeTrade: Record<string, unknown> & { entry_price: number; thesis_id: string };
    named: { stop_loss: number; stop_basis: string };
    chart: { swings: { lastHigh: { price: number; date: string }; lastLow: { price: number } } };
    thesis: { id: string; ticker: string; horizon: string; status: string; direction: string; conviction: string; setupId: string; triggers: Trigger[] };
  };
};
const T = "AAPL";
const BUY = fx.aapl.placeTrade.entry_price; // $359.36
const SALE = fx.aapl.named.stop_loss; // $325.33, the Nov 3 swing low
const RISK = Math.round((BUY - SALE) * 100) / 100; // $34.03
// The prior high ($351.73, Oct 23) is under the buy, so the take-profit is twice the risk above it.
const TAKE = Math.round((BUY + 2 * RISK) * 100) / 100; // $427.42
const ONE_RISK = Math.round((RISK / BUY) * 10000) / 100; // 9.47%
const WITH_BUY = [
  { action: "TRIM", predicate: { watch: "price", is: "above", value: TAKE }, rationale: `No high above the $${BUY} buy: the last swing high, $${fx.aapl.chart.swings.lastHigh.price}, is under it, so the take-profit is twice the $${RISK} risk above the buy.` },
  { action: "REVIEW", predicate: { watch: "move", is: "above", value: ONE_RISK, variable: "entry" }, rationale: `Up one risk (${ONE_RISK}%, the $${RISK} to the sale over the buy): raise the sale to the buy price.` },
];
/** The Writer's lines as it writes them now: the breakout's watch clock, from the playbook. */
const WATCH_CLOCK: Trigger = { id: "clock-watch", action: "REVIEW", predicate: { watch: "repeat", value: 7 }, rationale: "The base can extend and its pivot move.", playbook: "WATCH" };

let store: StoreSeed;
const rows = (table: string) => (store[table as keyof StoreSeed] ?? []) as Row[];
const thesis = () => rows("thesis").find((t) => t.ticker === T)!;
const lines = () => (thesis().triggers ?? []) as Trigger[];
const lineFor = (sentence: string) => lines().find((t) => triggerSentences({ triggers: [t] } as Row)[0] === sentence);

function seed() {
  store = {
    agentConfig: [agentConfigRow({ setupIds: ["BASE_BREAKOUT"], autoStopOnBuy: null, autoStopPct: null })],
    account: [accountRow({ autoStopOnBuy: false, requireApprovalBuysPaper: true })],
    thesis: [thesisRow({ ...fx.aapl.thesis, triggers: [...fx.aapl.thesis.triggers, WATCH_CLOCK] })],
  };
}

async function onStore<R>(price: number, fn: () => Promise<R>): Promise<R> {
  const db = prismaDouble(store);
  let out!: R;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "PKTEST", secretKey: "s", baseUrl: "https://paper-api.alpaca.markets" }) }));
    jest.doMock("@/lib/alpaca", () => ({ placeMarketOrder: async () => ({ id: "alpaca_buy", status: "accepted" }), getLatestPrice: async () => price, getLatestPrices: async () => ({ [T]: price }), getOrder: jest.fn(), getOrderByClientOrderId: jest.fn() }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
    out = await fn();
  });
  store = db.store as StoreSeed;
  return out;
}

/** The trigger run's recorded buy, with the sale it named and the playbook's other With the buy lines. */
async function propose() {
  const buy = fx.aapl.thesis.triggers.find((t) => t.action === "ENTER")!;
  const r = await replayTool("place-trade", "placeTrade", {
    seed: store,
    args: { ...fx.aapl.placeTrade, sell_if_below: SALE, sell_reason: fx.aapl.named.stop_basis, with_buy: WITH_BUY },
    ctx: { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, firedTrigger: { id: buy.id, action: buy.action, ticker: T } },
    quotes: { [T]: BUY },
  });
  expect(r.refused).toBe(false);
  store = r.db.store as StoreSeed;
  return rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!;
}

/** Approve (with edits, if any), then fill, as production does. */
async function approveAndFill(order: Row, edits?: { targetPrice?: number }) {
  const withPosition = () => {
    const o = rows("order").find((x) => x.id === order.id)!;
    const position = rows("position").find((p) => p.id === o.positionId);
    store = { ...store, order: rows("order").map((x) => (x.id === o.id ? { ...x, position } : x)) };
    return { ...o, position } as Row;
  };
  withPosition();
  const outcome = await onStore(BUY, async () => (await import("@/lib/proposals/execute")).approveProposal(String(order.id), REPLAY_USER_ID, edits));
  expect(outcome).toMatchObject({ ok: true, intent: "OPEN" });
  const approved = withPosition();
  await onStore(359.5, async () => {
    const { __test__ } = await import("@/lib/inngest/functions/reconcile-orders");
    await __test__.applyFillByIntent(approved as never, 359.5, Number(approved.quantity), new Date());
  });
}

/** A Writer's real call through the save path: the Writer's own save-call builder, the save's schema, record_thesis. */
async function writerMint(ticker: string, run: { id: string }, decision: Record<string, unknown>, price: number) {
  let w!: typeof import("@/lib/agent/run-thesis-writer");
  let schema!: z.ZodTypeAny;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    w = await import("@/lib/agent/run-thesis-writer");
    const { recordThesis } = await import("@/lib/agent/tools/record-thesis");
    schema = (recordThesis({ runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  const v = validateThesisDecision(decision as ThesisDecisionInput, { mode: "mint", existingStatus: null, currentPrice: price });
  expect(v.errors).toEqual([]);
  const call = w.buildWriterSaveCall({ childRunId: run.id, analystId: REPLAY_ANALYST_ID, ticker, mode: "mint", reason: "discovery" } as never, { currentPrice: price } as never, v.decision as ValidatedThesisDecision, {}, null);
  const r = await replayTool("record-thesis", "recordThesis", {
    seed: { agentConfig: [agentConfigRow({ setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"] })], account: [accountRow()] },
    args: schema.parse(call.toolArgs) as Record<string, unknown>,
    ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
    quotes: { [ticker]: price },
  });
  expect(r.refused).toBe(false);
  return r.db.store.thesis.find((t) => t.ticker === ticker)!;
}

describe("the Writer writes its playbook's watch lines", () => {
  it("HTFL: the real model on this PR's prompt writes exactly MA_PULLBACK's On a watch lines, each marked, and saves them", async () => {
    const htfl = await writerMint("HTFL", fx.htfl.run, fx.htfl.decision, fx.htfl.run.price);
    expect(htfl).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: "MA_PULLBACK" });
    const watch = PLAYBOOK_TEMPLATES.MA_PULLBACK.filter((t) => t.writtenOn === "WATCH");
    expect(triggerSentences(htfl)).toEqual(watch.map((t) => sentenceOf(t as unknown as Trigger)));
    expect((htfl.triggers as Trigger[]).map((t) => [t.playbook, t.source])).toEqual(watch.map(() => ["WATCH", "AGENT"]));
    // Each with the model's own reason, and the on-fire choice the template names (none: the action's default).
    for (const t of htfl.triggers as Trigger[]) expect(t.rationale.length).toBeGreaterThan(20);
    expect((htfl.triggers as Trigger[]).map((t) => t.fireMode)).toEqual(["ASK_NOW", "NEXT_MORNING", "ASK_NOW"]);
  });

  it("ZTS 2026-11-16: a view no setup fits names no playbook and carries the reviews that bring it back; no line is a playbook's", async () => {
    const zts = await writerMint("ZTS", fx.zts.run, fx.zts.decision, 83.84);
    expect(zts).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: null });
    expect(triggerSentences(zts)).toEqual(["Review if within 7 days before earnings", "Review if above $89.29"]);
    expect((zts.triggers as Trigger[]).filter((t) => t.playbook)).toEqual([]);
  });
});

describe("AAPL 2026-11-13: the breakout buy, its proposal and its fill", () => {
  beforeAll(seed);
  afterAll(() => jest.useRealTimers());

  it("2. the buy names the sale and the playbook's other lines, each with its reason; the pending position holds them and the card says each", async () => {
    await propose();
    const position = rows("position").find((p) => p.symbol === T)!;
    expect(position).toMatchObject({ status: "PENDING_APPROVAL", stopLoss: SALE, stopReason: fx.aapl.named.stop_basis, targetPrice: TAKE });
    expect((position.buyLines as Trigger[]).map((t) => [t.action, t.playbook, t.source, t.rationale])).toEqual(WITH_BUY.map((l) => [l.action, "PROPOSAL", "AGENT", l.rationale]));
    // What the proposal card shows (app/api/theses/[id] reads the position into buySentences).
    expect(buySentences(position as never)).toEqual([`Sell if below $${SALE}`, `Trim 50% if above $${TAKE}`, `Review if above ${ONE_RISK}% from our entry`]);
    expect(thesis().status).toBe("WATCHING");
  });

  it("3. filled: the watch lines come off, the hand-written line stays, the sale, the take-profit as a Trim and the fill templates go on", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!);
    jest.useRealTimers();
    expect(thesis().status).toBe("HOLDING");
    expect(triggerSentences(thesis()).sort()).toEqual(
      [
        // Written by hand on the watch, by an agent: stays.
        "Review if above $406.68",
        // The sale and the lines the buy came with.
        `Sell if below $${SALE}`,
        `Trim 50% if above $${TAKE}`,
        `Review if above ${ONE_RISK}% from our entry`,
        // BASE_BREAKOUT's fill templates (the seed: this account hasn't edited its playbook).
        "Review every 7 days",
        "Review 28 days after the buy",
      ].sort(),
    );
    // The buy, the Stop watching line and the Writer's watch clock are gone; the clock that is there is the fill's.
    expect(lines().map((t) => t.id)).not.toEqual(expect.arrayContaining(["clock-watch"]));
    expect(lineFor("Review every 7 days")).toMatchObject({ playbook: "FILL", source: "DEFAULT" });
    expect(lineFor(`Trim 50% if above $${TAKE}`)).toMatchObject({ action: "TRIM", playbook: "PROPOSAL", source: "AGENT", rationale: WITH_BUY[0].rationale });
    expect(lineFor(`Review if above ${ONE_RISK}% from our entry`)).toMatchObject({ playbook: "PROPOSAL", rationale: WITH_BUY[1].rationale });
    expect(lineFor(`Sell if below $${SALE}`)!.rationale).toBe(fx.aapl.named.stop_basis);
  });

  it("4. a take-profit changed in Edit & Approve goes on at your price, as your line", async () => {
    seed();
    const order = await propose();
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(order, { targetPrice: 400 });
    jest.useRealTimers();
    expect(lineFor("Trim 50% if above $400")).toMatchObject({ action: "TRIM", source: "PRINCIPAL" });
    expect(lineFor(`Trim 50% if above $${TAKE}`)).toBeUndefined();
    expect(lineFor(`Sell if below $${SALE}`)!.source).toBe("AGENT");
  });
});
