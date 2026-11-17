/**
 * playbook-triggers.replay.test.ts — a playbook's triggers, written by the
 * Writer, the buy proposal and the fill, on real production calls.
 *
 *   1. The Writer. HTFL: this PR's prompt, the real model, on the
 *      ground-truth data recorded 2026-11-13; its call, saved, writes
 *      exactly MA_PULLBACK's watch triggers, each marked. ZTS (2026-11-16):
 *      a view no playbook fits names none and carries the reviews that
 *      bring it back; nothing is marked a playbook's.
 *   2. AAPL (the trigger run's buy, 2026-11-13, BASE_BREAKOUT): place_trade
 *      names the sell price and the playbook's other triggers that come with
 *      the buy (the Trim and the one-risk review), each with its reason; the
 *      pending position saves them as they are, its targetPrice stays empty,
 *      and the card reads each as its sentence.
 *   3. Approved and filled: the buy, the Stop watching trigger and the
 *      playbook's watch triggers come off, the trigger written by hand
 *      stays, "Sell if below" and the Trim (never a review) go on, and the
 *      playbook's triggers written at the fill go on.
 *   4. Edit & Approve changes the sell price only; the Trim goes on as the
 *      analyst named it.
 *
 * The AAPL call is the recorded one; the sell price and its reason are the
 * ones the run named that day, and the Trim and the one-risk review take
 * their prices from the chart its get_stock_data read, by the playbook's
 * rules.
 */
import raw from "@/lib/agent/__fixtures__/playbook-triggers-2026-11.json";
import { replayTool, prismaDouble, triggerSentences, agentConfigRow, accountRow, thesisRow, REPLAY_ANALYST_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import type { StoreSeed } from "@/lib/replay/prisma-double";
import { validateThesisDecision, type ThesisDecisionInput, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { buyTriggerSentences } from "@/lib/proposals/buy-triggers";
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
// The prior high ($351.73, Oct 23) is under the buy price, so the Trim is twice the risk above it.
const TRIM = Math.round((BUY + 2 * RISK) * 100) / 100; // $427.42
const ONE_RISK = Math.round((RISK / BUY) * 10000) / 100; // 9.47%
const TRIGGERS_WITH_BUY = [
  { action: "TRIM", predicate: { watch: "price", is: "above", value: TRIM }, rationale: `No high above the $${BUY} buy: the last swing high, $${fx.aapl.chart.swings.lastHigh.price}, is under it, so the Trim is twice the $${RISK} risk above the buy price.` },
  { action: "REVIEW", predicate: { watch: "move", is: "above", value: ONE_RISK, variable: "entry" }, rationale: `Up one risk (${ONE_RISK}%, the $${RISK} to the sell price over the buy price): raise the sell price to the buy price.` },
];
/** The Writer's triggers as it writes them now: the breakout's watch clock, from the playbook. */
const WATCH_CLOCK: Trigger = { id: "clock-watch", action: "REVIEW", predicate: { watch: "repeat", value: 7 }, rationale: "The base can extend and its pivot move.", playbook: "WATCH" };

let store: StoreSeed;
const rows = (table: string) => (store[table as keyof StoreSeed] ?? []) as Row[];
const thesis = () => rows("thesis").find((t) => t.ticker === T)!;
const stockTriggers = () => (thesis().triggers ?? []) as Trigger[];
const triggerFor = (sentence: string) => stockTriggers().find((t) => triggerSentences({ triggers: [t] } as Row)[0] === sentence);

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

/** The trigger run's recorded buy, with the sell price it named and the playbook's other triggers that come with the buy. */
async function propose() {
  const buy = fx.aapl.thesis.triggers.find((t) => t.action === "ENTER")!;
  const r = await replayTool("place-trade", "placeTrade", {
    seed: store,
    args: { ...fx.aapl.placeTrade, sell_if_below: SALE, sell_reason: fx.aapl.named.stop_basis, triggers_with_buy: TRIGGERS_WITH_BUY },
    ctx: { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, firedTrigger: { id: buy.id, action: buy.action, ticker: T } },
    quotes: { [T]: BUY },
  });
  expect(r.refused).toBe(false);
  store = r.db.store as StoreSeed;
  return rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!;
}

/** Approve (with edits, if any), then fill, as production does. */
async function approveAndFill(order: Row, edits?: { stopLoss?: number }) {
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

describe("the Writer writes its playbook's watch triggers", () => {
  it("HTFL: the real model on this PR's prompt writes exactly MA_PULLBACK's watch triggers, each marked, and saves them", async () => {
    const htfl = await writerMint("HTFL", fx.htfl.run, fx.htfl.decision, fx.htfl.run.price);
    expect(htfl).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: "MA_PULLBACK" });
    const watch = PLAYBOOK_TEMPLATES.MA_PULLBACK.filter((t) => t.writtenOn === "WATCH");
    expect(triggerSentences(htfl)).toEqual(watch.map((t) => sentenceOf(t as unknown as Trigger)));
    expect((htfl.triggers as Trigger[]).map((t) => [t.playbook, t.source])).toEqual(watch.map(() => ["WATCH", "AGENT"]));
    // Each with the model's own reason, and the on-fire choice the template names (none: the action's default).
    for (const t of htfl.triggers as Trigger[]) expect(t.rationale.length).toBeGreaterThan(20);
    expect((htfl.triggers as Trigger[]).map((t) => t.fireMode)).toEqual(["ASK_NOW", "NEXT_MORNING", "ASK_NOW"]);
  });

  it("ZTS 2026-11-16: a view no playbook fits names none and carries the reviews that bring it back; no trigger is a playbook's", async () => {
    const zts = await writerMint("ZTS", fx.zts.run, fx.zts.decision, 83.84);
    expect(zts).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: null });
    expect(triggerSentences(zts)).toEqual(["Review if within 7 days before earnings", "Review if above $89.29"]);
    expect((zts.triggers as Trigger[]).filter((t) => t.playbook)).toEqual([]);
  });
});

describe("AAPL 2026-11-13: the breakout buy, its proposal and its fill", () => {
  beforeAll(seed);
  afterAll(() => jest.useRealTimers());

  it("2. the buy names the sell price and the playbook's other triggers, each with its reason; the pending position saves them as they are and the card says each", async () => {
    await propose();
    const position = rows("position").find((p) => p.symbol === T)!;
    expect(position).toMatchObject({ status: "PENDING_APPROVAL", stopLoss: SALE, stopReason: fx.aapl.named.stop_basis });
    expect(position.targetPrice ?? null).toBeNull();
    expect((position.buyTriggers as Trigger[]).map((t) => [t.action, t.predicate, t.playbook, t.source, t.rationale])).toEqual(TRIGGERS_WITH_BUY.map((t) => [t.action, t.predicate, "PROPOSAL", "AGENT", t.rationale]));
    // What the proposal card shows (app/api/theses/[id] reads the position into buyTriggerSentences).
    expect(buyTriggerSentences(position as never)).toEqual([`Sell if below $${SALE}`, `Trim 50% if above $${TRIM}`, `Review if above ${ONE_RISK}% from our entry`]);
    expect(thesis().status).toBe("WATCHING");
  });

  it("3. filled: the watch triggers come off, the one written by hand stays, Sell if below, the Trim and the fill triggers go on", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!);
    jest.useRealTimers();
    expect(thesis().status).toBe("HOLDING");
    expect(triggerSentences(thesis()).sort()).toEqual(
      [
        // Written by hand on the watch, by an agent: stays.
        "Review if above $406.68",
        // The sell price and the triggers that came with the buy.
        `Sell if below $${SALE}`,
        `Trim 50% if above $${TRIM}`,
        `Review if above ${ONE_RISK}% from our entry`,
        // BASE_BREAKOUT's triggers written at the fill (the seed: this account hasn't edited its playbook).
        "Review every 7 days",
        "Review 28 days after the buy",
      ].sort(),
    );
    // The buy, the Stop watching trigger and the Writer's watch clock are gone; the clock that is there is the fill's.
    expect(stockTriggers().map((t) => t.id)).not.toEqual(expect.arrayContaining(["clock-watch"]));
    expect(triggerFor("Review every 7 days")).toMatchObject({ playbook: "FILL", source: "DEFAULT" });
    expect(triggerFor(`Trim 50% if above $${TRIM}`)).toMatchObject({ action: "TRIM", playbook: "PROPOSAL", source: "AGENT", rationale: TRIGGERS_WITH_BUY[0].rationale });
    expect(triggerFor(`Review if above ${ONE_RISK}% from our entry`)).toMatchObject({ playbook: "PROPOSAL", rationale: TRIGGERS_WITH_BUY[1].rationale });
    expect(triggerFor(`Sell if below $${SALE}`)!.rationale).toBe(fx.aapl.named.stop_basis);
  });

  it("4. Edit & Approve changes the sell price only: yours goes on, and the Trim goes on as the analyst named it", async () => {
    seed();
    const order = await propose();
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(order, { stopLoss: 330 });
    jest.useRealTimers();
    expect(triggerFor("Sell if below $330")).toMatchObject({ action: "EXIT", source: "PRINCIPAL" });
    expect(triggerFor(`Trim 50% if above $${TRIM}`)).toMatchObject({ action: "TRIM", source: "AGENT", rationale: TRIGGERS_WITH_BUY[0].rationale });
    expect(rows("position").find((p) => p.id === order.positionId)).toMatchObject({ stopLoss: 330 });
    expect(rows("position").find((p) => p.id === order.positionId)!.targetPrice ?? null).toBeNull();
  });

});
