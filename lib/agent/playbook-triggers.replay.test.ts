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
 *      names the sell price and nothing else; the pending position saves it
 *      and its targetPrice stays empty.
 *   3. Approved and filled: the buy, the Stop watching trigger and the
 *      playbook's watch triggers come off, the trigger written by hand
 *      stays, "Sell if below" goes on, and the fill writes the playbook's
 *      triggers that come with the buy from the chart then and the buy: the
 *      Trim at the prior high above the buy, else twice the risk above it
 *      (the chart's last swing high, $351.73, is under the buy: $427.42),
 *      and the one-risk review. Then the playbook's triggers written at the
 *      fill go on.
 *   4. Edit & Approve changes the sell price only; the Trim and the one-risk
 *      review read the price you approved.
 *
 * The AAPL call is the recorded one; the sell price and its reason are the
 * ones the run named that day, and the chart at the fill is the one its
 * get_stock_data read.
 */
import raw from "@/lib/agent/__fixtures__/playbook-triggers-2026-11.json";
import { replayTool, prismaDouble, triggerSentences, agentConfigRow, accountRow, thesisRow, REPLAY_ANALYST_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import type { StoreSeed } from "@/lib/replay/prisma-double";
import { validateThesisDecision, type ThesisDecisionInput, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
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
const ONE_RISK = Math.round((RISK / BUY) * 10000) / 100; // 9.47%
// The prior high ($351.73, Oct 23) is under the buy price, so the Trim is twice the risk above it, as the run wrote it that day.
const TRIM = Math.round((BUY + 2 * RISK) * 100) / 100; // $427.42
const TRIM_REASON = "The prior high above the buy, else twice the risk above the buy.";
/** BASE_BREAKOUT's one-risk review, as the fill writes it. */
const ONE_RISK_REASON = "One risk: (the buy price − the sell price) ÷ the buy price. Once it is up one risk, the run raises the sell price to the buy price.";

/** The chart at the fill (lib/proposals/fill-chart.ts): AAPL's, as its get_stock_data read it that day, unless a test sets its own prior high. */
const aaplChart = (priorHigh?: number) => ({
  price: BUY,
  swings: priorHigh == null ? fx.aapl.chart.swings : { ...fx.aapl.chart.swings, lastHigh: { price: priorHigh, date: "2026-11-12" } },
  gaps: [],
  base: null,
  range: { high20: BUY, low20: SALE, high52w: BUY, low52w: 200, pctBelow52wHigh: 0, pctAbove52wLow: 80 },
});
let mockChart: unknown = aaplChart();
jest.mock("@/lib/proposals/fill-chart", () => ({ loadFillChart: async () => mockChart }));
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

/** The trigger run's recorded buy, with the sell price it named. */
async function propose() {
  const buy = fx.aapl.thesis.triggers.find((t) => t.action === "ENTER")!;
  const r = await replayTool("place-trade", "placeTrade", {
    seed: store,
    args: { ...fx.aapl.placeTrade, sell_if_below: SALE, sell_reason: fx.aapl.named.stop_basis },
    ctx: { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, firedTrigger: { id: buy.id, action: buy.action, ticker: T }, runStock: { ticker: T, thesisId: fx.aapl.thesis.id, triggerId: buy.id } },
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

  it("2. the buy names the sell price and nothing else; the pending position saves it", async () => {
    await propose();
    const position = rows("position").find((p) => p.symbol === T)!;
    expect(position).toMatchObject({ status: "PENDING_APPROVAL", stopLoss: SALE, stopReason: fx.aapl.named.stop_basis });
    expect(position.targetPrice ?? null).toBeNull();
    expect(position).not.toHaveProperty("buyTriggers");
    expect(thesis().status).toBe("WATCHING");
  });

  it("3. filled: the watch triggers come off, the one written by hand stays, Sell if below, the Trim and the one-risk review go on from the chart and the buy, and the fill triggers go on", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!);
    jest.useRealTimers();
    expect(thesis().status).toBe("HOLDING");
    expect(triggerSentences(thesis()).sort()).toEqual(
      [
        // Written by hand on the watch, by an agent: stays.
        "Review if above $406.68",
        // The sell price, and the playbook's triggers that come with the buy, priced from the chart and the buy.
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
    expect(triggerFor(`Review if above ${ONE_RISK}% from our entry`)).toMatchObject({ playbook: "PROPOSAL", rationale: ONE_RISK_REASON });
    expect(triggerFor(`Sell if below $${SALE}`)!.rationale).toBe(fx.aapl.named.stop_basis);
    // AAPL's last swing high ($351.73) is under the $359.36 buy, so the Trim is twice the $34.03 risk above the buy: $427.42, the price the run wrote that day.
    expect(triggerFor(`Trim 50% if above $${TRIM}`)).toMatchObject({ action: "TRIM", trimPct: 50, playbook: "PROPOSAL", rationale: TRIM_REASON });
  });

  it("4. Edit & Approve changes the sell price only: yours goes on, and the Trim and the one-risk review read it", async () => {
    seed();
    const order = await propose();
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(order, { stopLoss: 330 });
    jest.useRealTimers();
    expect(triggerFor("Sell if below $330")).toMatchObject({ action: "EXIT", source: "PRINCIPAL" });
    // One risk to the price you approved: ($359.36 − $330) ÷ $359.36; the Trim twice that risk above the buy.
    expect(triggerFor(`Review if above ${Math.round(((BUY - 330) / BUY) * 10000) / 100}% from our entry`)).toMatchObject({ playbook: "PROPOSAL" });
    expect(triggerFor(`Trim 50% if above $${Math.round((BUY + 2 * (BUY - 330)) * 100) / 100}`)).toMatchObject({ playbook: "PROPOSAL", rationale: TRIM_REASON });
    expect(rows("position").find((p) => p.id === order.positionId)).toMatchObject({ stopLoss: 330 });
    expect(rows("position").find((p) => p.id === order.positionId)!.targetPrice ?? null).toBeNull();
  });

});


/**
 * #1003 fixed forward (2026-11-17), on the same AAPL rows: a playbook trigger
 * edited on the watch is still the playbook's at the fill; a trim size the
 * owner set reaches the fill; a trigger that comes with the buy never
 * overwrites the owner's; a sale back to watch keeps what doesn't need a
 * position and writes nothing.
 */
describe("AAPL 2026-11-13, fixed forward", () => {
  afterEach(() => jest.useRealTimers());
  const fillNow = () => jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  const setTriggers = (triggers: Trigger[]) => (store = { ...store, thesis: rows("thesis").map((t) => (t.ticker === T ? { ...t, triggers } : t)) });
  const buy = () => fx.aapl.thesis.triggers.find((t) => t.action === "ENTER")!;
  const proposeWith = async (args: Record<string, unknown>) => {
    const r = await replayTool("place-trade", "placeTrade", {
      seed: store,
      args,
      // The trigger run's stock, as tactical-run.ts hands it: its schema asks the model for none of it.
      ctx: { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, firedTrigger: { id: buy().id, action: buy().action, ticker: T }, runStock: { ticker: T, thesisId: fx.aapl.thesis.id, triggerId: buy().id } },
      quotes: { [T]: BUY },
    });
    expect(r.refused).toBe(false);
    store = r.db.store as StoreSeed;
    return rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!;
  };
  const sale = { sell_if_below: SALE, sell_reason: fx.aapl.named.stop_basis };

  it("a watch trigger of the playbook's, edited (its number, or into another kind by the owner), still comes off at the fill", async () => {
    const { applyTriggerOps } = await import("@/lib/agent/triggers/ops");
    const ops = [
      { op: "edit" as const, id: WATCH_CLOCK.id, value: 14, rationale: "Every 14 days." },
      { op: "replace" as const, id: WATCH_CLOCK.id, trigger: { id: "", action: "REVIEW" as const, predicate: { watch: "report" as const, is: "before" as const, value: 5 }, rationale: "Five days before the report." } },
    ];
    for (const op of ops) {
      seed();
      const edited = applyTriggerOps({ stored: stockTriggers(), ops: [op], direction: "LONG", status: "WATCHING", actor: op.op === "edit" ? "AGENT" : "PRINCIPAL", mintId: () => "clock-edited" });
      expect(edited.results[0]).toMatchObject({ ok: true });
      const was = edited.triggers.find((t) => t.id === edited.results[0].id)!;
      expect(was.playbook).toBe("WATCH");
      setTriggers(edited.triggers);
      const order = await propose();
      fillNow();
      await approveAndFill(order);
      jest.useRealTimers();
      expect(stockTriggers().some((t) => t.id === was.id)).toBe(false);
    }
  });

  it("a trim size the owner set on the playbook reaches the fill: with a prior high above the buy, the fill writes the Trim at it, at the owner's size", async () => {
    seed();
    // Settings → Playbook: the owner set BASE_BREAKOUT's Trim to 30%.
    const templates = PLAYBOOK_TEMPLATES.BASE_BREAKOUT.map((t) => (t.action === "TRIM" ? { ...t, trimPct: 30 } : t));
    store = { ...store, account: [accountRow({ autoStopOnBuy: false, requireApprovalBuysPaper: true, playbooks: { BASE_BREAKOUT: templates }, playbooksSeededAt: new Date("2026-11-10T00:00:00Z") })] };
    mockChart = aaplChart(380);
    try {
      const order = await proposeWith({ ...fx.aapl.placeTrade, ...sale });
      fillNow();
      await approveAndFill(order);
    } finally {
      mockChart = aaplChart();
    }
    expect(triggerFor("Trim 30% if above $380")).toMatchObject({ action: "TRIM", trimPct: 30, playbook: "PROPOSAL", rationale: TRIM_REASON });
  });

  it("a trigger that comes with the buy never overwrites one the owner wrote: his stays, and the fill's line names the one not written", async () => {
    seed();
    // The owner wrote a Trim himself; the playbook's Trim, at the $380 prior high, would be one of the same kind.
    const his: Trigger = { id: "owners-trim", action: "TRIM", trimPct: 25, predicate: { watch: "price", is: "above", value: 400 }, rationale: "My own trim.", source: "PRINCIPAL" };
    setTriggers([...stockTriggers(), his]);
    mockChart = aaplChart(380);
    try {
      const order = await proposeWith({ ...fx.aapl.placeTrade, ...sale });
      fillNow();
      await approveAndFill(order);
    } finally {
      mockChart = aaplChart();
    }
    expect(triggerFor("Trim 25% if above $400")).toMatchObject({ source: "PRINCIPAL" });
    expect(triggerFor("Trim 50% if above $380")).toBeUndefined();
    const line = rows("thesisUpdate").find((u) => u.type === "STATUS_CHANGED" && String(u.summary).includes("HOLDING"))!;
    const said = (line.fieldChanges as { triggerOps: { to: Array<{ text: string }> } }).triggerOps.to.map((o) => o.text);
    expect(said).toContain("Kept your Trim 25% if above $400; the buy's Trim 50% if above $380 not written");
  });

  it("sold back to watch: the owner's review and the holding's clock stay, what needs a position comes off, and nothing is written", async () => {
    seed();
    const order = await propose();
    fillNow();
    await approveAndFill(order);
    jest.useRealTimers();
    const owners: Trigger = { id: "owners-review", action: "REVIEW", predicate: { watch: "price", is: "below", value: 300 }, rationale: "Under $300 I look again.", source: "PRINCIPAL" };
    setTriggers([...stockTriggers(), owners]);
    const before = stockTriggers();
    const position = rows("position").find((p) => p.symbol === T)!;
    await onStore(430, async () =>
      (await import("@/lib/proposals/thesis-flips")).closeThesisForPosition({ analystId: REPLAY_ANALYST_ID, ticker: T, positionId: String(position.id), closeReason: "TARGET", rationale: null, priceAtTime: 430 }),
    );
    expect(thesis().status).toBe("WATCHING");
    expect(triggerSentences(thesis()).sort()).toEqual(["Review every 7 days", "Review if above $406.68", "Review if below $300"].sort());
    // Nothing new: every trigger left was on the holding, as it was.
    for (const t of stockTriggers()) expect(before).toContainEqual(t);
    // The CLOSED row names each one that came off.
    const closed = rows("thesisUpdate").find((u) => u.type === "CLOSED")!;
    const removed = before.filter((t) => !stockTriggers().some((x) => x.id === t.id));
    expect(removed.length).toBeGreaterThan(0);
    expect((closed.fieldChanges as { triggerOps: { to: Array<{ op: string; id: string; text: string }> } }).triggerOps.to).toEqual(
      removed.map((t) => ({ op: "remove", id: t.id, text: `Removed: ${sentenceOf(t)}` })),
    );
  });
});
