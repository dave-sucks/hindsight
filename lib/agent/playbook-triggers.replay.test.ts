/**
 * playbook-triggers.replay.test.ts — a playbook's triggers, written by the
 * Writer, the buy proposal and the fill, on real production calls.
 *
 *   1. The Writer. HTFL (2026-11-13): its decision names MA_PULLBACK, and
 *      the save writes exactly MA_PULLBACK's watch triggers, each marked,
 *      priced by code (T1: the decision carries no trigger). ZTS
 *      (2026-11-16): a view no playbook fits names none; the save writes
 *      nothing, and its reviews come after the save, through edit_triggers.
 *   2. AAPL (the trigger run's buy, 2026-11-13, BASE_BREAKOUT): place_trade
 *      names the sell price and nothing else; the pending position saves it
 *      and its targetPrice stays empty.
 *   3. Approved and filled: the buy, the Stop watching trigger and the
 *      playbook's watch triggers come off, the trigger written by hand
 *      stays, and "Sell if below" goes on; nothing else (2026-11-19). Then
 *      After the buy puts the playbook's holding triggers on by reference,
 *      each priced from the chart and the fill: the Trim at the prior high
 *      above the buy, else twice the risk above it (the chart's last swing
 *      high, $351.73, is under the $359.50 fill: $427.84), the one-risk
 *      review, and the triggers written at the fill.
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
import { playbookRefs } from "@/lib/agent/knowledge/playbooks";
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
/** What the buy filled at: After the buy prices the holding's triggers from it. */
const FILL = 359.5;
const RISK = Math.round((FILL - SALE) * 100) / 100; // $34.17
const ONE_RISK = Math.round((RISK / FILL) * 10000) / 100; // 9.5%
// The prior high ($351.73, Oct 23) is under the fill, so the Trim is twice the risk above it.
const TRIM = Math.round((FILL + 2 * RISK) * 100) / 100; // $427.84
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

/** The holding's triggers in the stock's playbook, by reference, the floor's aside (it is on): what After the buy puts on. */
const holdingRefs = (templates = PLAYBOOK_TEMPLATES.BASE_BREAKOUT) =>
  playbookRefs(templates).filter((r) => r.template.writtenOn !== "WATCH" && !(r.template.action === "EXIT" && JSON.stringify(r.template.predicate).includes("{sellPrice}"))).map((r) => r.ref);

/** After the buy's edit_triggers, each holding trigger by its reference, as its run sends them (lib/proposals/after-buy.ts). */
async function afterTheBuy(refs = holdingRefs()) {
  const r = await replayTool("edit-triggers", "editTriggers", {
    seed: store,
    args: { add: refs.map((ref) => ({ playbook_trigger: ref })) },
    ctx: { runMode: "AFTER_BUY", analystId: REPLAY_ANALYST_ID, runStock: { ticker: T, thesisId: fx.aapl.thesis.id, triggerId: "" } },
    quotes: { [T]: FILL },
  });
  store = r.db.store as StoreSeed;
  return r;
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
  await onStore(FILL, async () => {
    const { __test__ } = await import("@/lib/inngest/functions/reconcile-orders");
    await __test__.applyFillByIntent(approved as never, FILL, Number(approved.quantity), new Date());
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
  const call = w.buildWriterSaveCall({ childRunId: run.id, analystId: REPLAY_ANALYST_ID, ticker, mode: "mint", reason: "discovery" } as never, { currentPrice: price, priceStructure: null } as never, v.decision as ValidatedThesisDecision, {}, null, (id) => PLAYBOOK_TEMPLATES[id as keyof typeof PLAYBOOK_TEMPLATES]);
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
  it("HTFL: naming MA_PULLBACK, the save writes exactly its watch triggers, each marked", async () => {
    const htfl = await writerMint("HTFL", fx.htfl.run, fx.htfl.decision, fx.htfl.run.price);
    expect(htfl).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: "MA_PULLBACK" });
    const watch = PLAYBOOK_TEMPLATES.MA_PULLBACK.filter((t) => t.writtenOn === "WATCH");
    expect(triggerSentences(htfl)).toEqual(watch.map((t) => sentenceOf(t as unknown as Trigger)));
    expect((htfl.triggers as Trigger[]).map((t) => [t.playbook, t.source])).toEqual(watch.map(() => ["WATCH", "AGENT"]));
    // Each with the playbook's reason, and the on-fire choice the template names (none: the action's default).
    expect((htfl.triggers as Trigger[]).map((t) => t.rationale)).toEqual(watch.map((t) => t.rationale));
    expect((htfl.triggers as Trigger[]).map((t) => t.fireMode)).toEqual(["ASK_NOW", "NEXT_MORNING", "ASK_NOW"]);
  });

  it("ZTS 2026-11-16: a view no playbook fits names none, and the save writes no trigger: its reviews come after it", async () => {
    const zts = await writerMint("ZTS", fx.zts.run, fx.zts.decision, 83.84);
    expect(zts).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: null });
    expect(zts.triggers).toEqual([]);
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

  it("3. filled: the watch triggers come off, the one written by hand stays, Sell if below goes on, and nothing else; After the buy then puts the holding's triggers on from the chart and the fill", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(rows("order").find((o) => o.symbol === T && o.intent === "OPEN")!);
    jest.useRealTimers();
    expect(thesis().status).toBe("HOLDING");
    // The fill: written by hand on the watch (an agent's) stays; the sale goes on; the buy, the Stop watching trigger and the watch clock are gone.
    expect(triggerSentences(thesis()).sort()).toEqual(["Review if above $406.68", `Sell if below $${SALE}`].sort());
    expect(triggerFor(`Sell if below $${SALE}`)!.rationale).toBe(fx.aapl.named.stop_basis);
    // After the buy: BASE_BREAKOUT's holding triggers by reference, priced from the chart and the $359.50 fill.
    const r = await afterTheBuy();
    expect(r.refused).toBe(false);
    expect(triggerSentences(thesis()).sort()).toEqual(
      ["Review if above $406.68", `Sell if below $${SALE}`, `Trim 50% if above $${TRIM}`, `Review if above ${ONE_RISK}% from our entry`, "Review every 7 days", "Review 28 days after the buy"].sort(),
    );
    expect(stockTriggers().map((t) => t.id)).not.toEqual(expect.arrayContaining(["clock-watch"]));
    expect(triggerFor("Review every 7 days")).toMatchObject({ playbook: "FILL" });
    expect(triggerFor(`Review if above ${ONE_RISK}% from our entry`)).toMatchObject({ playbook: "PROPOSAL", rationale: ONE_RISK_REASON });
    // AAPL's last swing high ($351.73) is under the fill, so the Trim is twice the $34.17 risk above it: $427.84.
    expect(triggerFor(`Trim 50% if above $${TRIM}`)).toMatchObject({ action: "TRIM", trimPct: 50, playbook: "PROPOSAL", rationale: TRIM_REASON });
  });

  it("4. Edit & Approve changes the sell price only: yours goes on, and the Trim and the one-risk review read it", async () => {
    seed();
    const order = await propose();
    jest.useFakeTimers({ now: new Date("2026-11-13T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    await approveAndFill(order, { stopLoss: 330 });
    jest.useRealTimers();
    expect(triggerFor("Sell if below $330")).toMatchObject({ action: "EXIT", source: "PRINCIPAL" });
    await afterTheBuy();
    // One risk to the price you approved: ($359.50 − $330) ÷ $359.50; the Trim twice that risk above the fill.
    expect(triggerFor(`Review if above ${Math.round(((FILL - 330) / FILL) * 10000) / 100}% from our entry`)).toMatchObject({ playbook: "PROPOSAL" });
    expect(triggerFor(`Trim 50% if above $${(FILL + 2 * (FILL - 330)).toFixed(2)}`)).toMatchObject({ playbook: "PROPOSAL", rationale: TRIM_REASON });
    expect(rows("position").find((p) => p.id === order.positionId)).toMatchObject({ stopLoss: 330 });
    expect(rows("position").find((p) => p.id === order.positionId)!.targetPrice ?? null).toBeNull();
  });

});


/**
 * #1003 fixed forward (2026-11-17), on the same AAPL rows: a playbook trigger
 * edited on the watch is still the playbook's at the fill; a trim size the
 * owner set reaches the holding (through After the buy since 2026-11-19); a
 * playbook trigger never overwrites the owner's; a sale back to watch keeps
 * what doesn't need a position and writes nothing.
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

  it("a trim size the owner set on the playbook reaches the holding: with a prior high above the buy, After the buy puts the Trim at it, at the owner's size", async () => {
    seed();
    // Settings → Playbook: the owner set BASE_BREAKOUT's Trim to 30%.
    const templates = PLAYBOOK_TEMPLATES.BASE_BREAKOUT.map((t) => (t.action === "TRIM" ? { ...t, trimPct: 30 } : t));
    store = { ...store, account: [accountRow({ autoStopOnBuy: false, requireApprovalBuysPaper: true, playbooks: { BASE_BREAKOUT: templates }, playbooksSeededAt: new Date("2026-11-10T00:00:00Z") })] };
    mockChart = aaplChart(380);
    try {
      const order = await proposeWith({ ...fx.aapl.placeTrade, ...sale });
      fillNow();
      await approveAndFill(order);
      jest.useRealTimers();
      expect(stockTriggers().some((t) => t.action === "TRIM")).toBe(false);
      await afterTheBuy(holdingRefs(templates));
    } finally {
      mockChart = aaplChart();
    }
    expect(triggerFor("Trim 30% if above $380")).toMatchObject({ action: "TRIM", trimPct: 30, playbook: "PROPOSAL", rationale: TRIM_REASON });
  });

  it("a playbook trigger never overwrites one the owner wrote: the fill writes none, and After the buy's Trim beside his is refused with why", async () => {
    seed();
    // The owner wrote a Trim himself; the playbook's Trim, at the $380 prior high, would be one of the same kind.
    const his: Trigger = { id: "owners-trim", action: "TRIM", trimPct: 25, predicate: { watch: "price", is: "above", value: 400 }, rationale: "My own trim.", source: "PRINCIPAL" };
    setTriggers([...stockTriggers(), his]);
    mockChart = aaplChart(380);
    let r!: Awaited<ReturnType<typeof afterTheBuy>>;
    try {
      const order = await proposeWith({ ...fx.aapl.placeTrade, ...sale });
      fillNow();
      await approveAndFill(order);
      jest.useRealTimers();
      expect(triggerFor("Trim 50% if above $380")).toBeUndefined();
      r = await afterTheBuy();
    } finally {
      mockChart = aaplChart();
    }
    expect(triggerFor("Trim 25% if above $400")).toMatchObject({ source: "PRINCIPAL" });
    expect(triggerFor("Trim 50% if above $380")).toBeUndefined();
    const ops = (r.result.data?.trigger_ops ?? []) as Array<{ ok: boolean; text: string; reason?: string }>;
    expect(ops.find((o) => !o.ok && o.text.includes("Trim 50% if above $380"))?.reason).toBe(`The principal wrote Trim 25% if above $400 on $AAPL, and ${holdingRefs().find((ref) => ref === "H2")} would replace it: theirs stays. To change theirs, edit it by id with your reason.`);
  });

  it("after an add, the Trim's reference re-prices the playbook's Trim already on the stock, around the new average: the same trigger, a new number", async () => {
    seed();
    const order = await propose();
    fillNow();
    await approveAndFill(order);
    jest.useRealTimers();
    await afterTheBuy();
    const before = triggerFor(`Trim 50% if above $${TRIM}`)!;
    // An add moves the average to $370: twice the $44.67 risk to the $325.33 floor above it is $459.34.
    store = { ...store, position: rows("position").map((p) => (p.symbol === T ? { ...p, avgCost: 370 } : p)) };
    const r = await afterTheBuy([playbookRefs(PLAYBOOK_TEMPLATES.BASE_BREAKOUT).find((x) => x.template.action === "TRIM")!.ref]);
    expect(r.refused).toBe(false);
    expect(triggerFor("Trim 50% if above $459.34")).toMatchObject({ id: before.id, action: "TRIM", playbook: "PROPOSAL" });
    expect(stockTriggers().filter((t) => t.action === "TRIM")).toHaveLength(1);
  });

  it("sold back to watch: the owner's review and the holding's clock stay, what needs a position comes off, and nothing is written", async () => {
    seed();
    const order = await propose();
    fillNow();
    await approveAndFill(order);
    jest.useRealTimers();
    await afterTheBuy();
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
