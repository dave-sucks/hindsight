/**
 * lifecycle.replay.test.ts — a stock's whole life, end to end, after the
 * level columns went (2026-11-16): a stock has triggers and nothing else.
 *
 * HTFL's real Writer mint (2026-11-13 18:46 ET), then every step a stock
 * goes through, each one through the code path production takes, on one
 * database carried from step to step:
 *
 *   1. the mint lands WATCHING with its buy, its Stop watching line (on the
 *      close), its review and its playbook's watch clock (marked WATCH);
 *      what the agent reads back is the triggers' sentences, never a level
 *      key;
 *   2. the buy fires: place_trade with sell_if_below and sell_reason, and
 *      the playbook's take-profit (with_buy) at the prior high; the pending
 *      position holds them and the size reads them;
 *   3. approved, then filled: the buy, the Stop watching line and the
 *      playbook's watch clock come off, the review written by hand stays,
 *      "Sell if below" and the take-profit (a Trim) go on with their
 *      reasons, the playbook's fill templates are written, the stock is
 *      HOLDING;
 *   4. the "Sell if below" line fires: the sale's label comes from it;
 *   5. a sale that keeps the stock on watch takes its Sell lines off;
 *   6. another watch's Stop watching line fires: it retires, and its waiting
 *      buy is withdrawn;
 *   7. the homepage Activity shows each of those once, with its label.
 *
 * Only the database, the broker, the quote vendors and the clock are doubled.
 */
import type { z } from "zod";
import raw from "@/lib/agent/__fixtures__/lifecycle-htfl-2026-11-13.json";
import {
  replayTool,
  prismaDouble,
  oldLevelFieldsAsTriggerOps,
  triggerSentences,
  agentConfigRow,
  accountRow,
  thesisRow,
  positionRow,
  REPLAY_ANALYST_ID,
  REPLAY_USER_ID,
  REPLAY_ACCOUNT_ID,
  type Row,
} from "@/lib/replay";
import type { StoreSeed } from "@/lib/replay/prisma-double";
import { validateThesisDecision, type ThesisDecisionInput, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { protectiveExitCloseReason } from "@/lib/agent/triggers/types";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";
import type * as Writer from "@/lib/agent/run-thesis-writer";

const fx = raw as unknown as { run: { id: string; ticker: string; price: number }; decision: Record<string, unknown> };
const T = "HTFL";
const OLD_KEYS = /entry_?price|target_?price|stop_?loss/i;
/** A trigger run's model call on a fired buy: the sale comes with it. */
const SALE = 48.61;
const SALE_REASON = "Below $48.61 the 50-day failed as support and the pullback is a trend break: 1 ATR under the average.";
/** MA_PULLBACK's take-profit, at the prior high the pullback came from: the Writer's own $60.56 (its target_basis). */
const TAKE = 60.56;
const TAKE_REASON = "The prior swing high of $60.56 from October 29, the high the pullback came from.";
/** The playbook's watch clock, as the Writer writes it now. */
const WATCH_CLOCK = { predicate: { watch: "repeat", value: 7 }, action: "REVIEW", rationale: "Re-checks that the 50-day is still rising.", playbook: "WATCH" };

// ── The one database the steps share ──────────────────────────────────────
let store: StoreSeed = {
  agentConfig: [agentConfigRow({ setupIds: ["MA_PULLBACK"], autoStopOnBuy: null, autoStopPct: null })],
  account: [accountRow({ autoStopOnBuy: false, requireApprovalBuysPaper: true, requireApprovalSellsPaper: true })],
};
const rows = (table: string) => (store[table as keyof StoreSeed] ?? []) as Row[];
const thesisOf = (ticker = T) => rows("thesis").find((t) => t.ticker === ticker && t.status !== "RETIRED") ?? rows("thesis").find((t) => t.ticker === ticker)!;
const triggersOf = (ticker = T) => (thesisOf(ticker).triggers ?? []) as Trigger[];

/** Run code against the shared database, with the broker and quotes doubled; keep what it wrote. */
async function onStore<R>(price: number, fn: () => Promise<R>): Promise<R> {
  const db = prismaDouble(store);
  let out!: R;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "PKTEST", secretKey: "s", baseUrl: "https://paper-api.alpaca.markets" }) }));
    jest.doMock("@/lib/alpaca", () => ({
      placeMarketOrder: async () => ({ id: `alpaca_${Math.random().toString(36).slice(2)}`, status: "accepted" }),
      closePositionPartial: async () => ({ id: "alpaca_close", status: "accepted" }),
      closePosition: async () => ({ id: "alpaca_close", status: "accepted" }),
      getLatestPrice: async () => price,
      getLatestPrices: async () => ({ [T]: price }),
      getOrder: jest.fn(),
      getOrderByClientOrderId: jest.fn(),
    }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
    out = await fn();
  });
  store = db.store as StoreSeed;
  return out;
}

/** A tool through the replay harness, on the shared database. */
async function tool(module: string, exportName: string, args: Record<string, unknown>, ctx: Record<string, unknown>, price: number) {
  const r = await replayTool(module, exportName, { seed: store, args, ctx, quotes: { [T]: price } });
  if (r.crashed) throw new Error(`${exportName} crashed: ${JSON.stringify(r.result).slice(0, 1500)}`);
  store = r.db.store as StoreSeed;
  return r;
}

const proposalOf = (intent: string) => rows("order").filter((o) => o.symbol === T && o.intent === intent).at(-1)!;
/** The double joins nothing: an order carries its position inline, as the approval and the fill read it. */
function withItsPosition(order: Row): Row {
  const position = rows("position").find((p) => p.id === order.positionId);
  store = { ...store, order: rows("order").map((o) => (o.id === order.id ? { ...o, position } : o)) };
  return { ...order, position };
}

/** HTFL's recorded decision as the Writer writes it now: its levels are triggers. */
function htflDecision(): ValidatedThesisDecision {
  const { add_triggers, ...rest } = oldLevelFieldsAsTriggerOps(fx.decision, [], "LONG");
  const v = validateThesisDecision({ ...rest, triggers: [...((add_triggers ?? []) as unknown[]), WATCH_CLOCK] } as unknown as ThesisDecisionInput, { mode: "mint", existingStatus: null, currentPrice: fx.run.price });
  expect(v.errors).toEqual([]);
  expect("riskReward" in v).toBe(false);
  return v.decision as ValidatedThesisDecision;
}

/** The Writer's own save-call builder and result reader, and the save's schema. */
async function writerSave() {
  let w!: typeof Writer;
  let schema!: z.ZodTypeAny;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    w = await import("@/lib/agent/run-thesis-writer");
    const { recordThesis } = await import("@/lib/agent/tools/record-thesis");
    schema = (recordThesis({ runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return { build: w.buildWriterSaveCall, read: w.readWriterSaveResult, schema };
}

describe("HTFL's whole life, from the Writer's mint to the homepage", () => {
  afterAll(() => jest.useRealTimers());

  it("1. the Writer's real mint lands WATCHING with its buy, its Stop watching line on the close and its review; the agent reads sentences back", async () => {
    const { build, schema } = await writerSave();
    const call = build({ childRunId: fx.run.id, analystId: REPLAY_ANALYST_ID, ticker: T, mode: "mint", reason: "discovery" } as never, { currentPrice: fx.run.price } as never, htflDecision(), {}, null);
    expect(call.toolName).toBe("record_thesis");
    expect(JSON.stringify(call.toolArgs)).not.toMatch(OLD_KEYS);
    const args = schema.parse(call.toolArgs) as Record<string, unknown>;

    const r = await tool("record-thesis", "recordThesis", args, { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID }, fx.run.price);
    expect(r.refused).toBe(false);
    // The double joins nothing: the new row carries its run inline, as the database's join would give it.
    store = { ...store, thesis: rows("thesis").map((t) => (t.researchRun ? t : { ...t, researchRun: { agentConfigId: REPLAY_ANALYST_ID, environment: "PAPER", agentConfig: { name: "PEAD Specialist", setupIds: ["MA_PULLBACK"] } } })) };
    expect(thesisOf()).toMatchObject({ status: "WATCHING", direction: "LONG", setupId: "MA_PULLBACK" });
    expect(triggerSentences(thesisOf())).toEqual([
      "Buy if above $51.94 · only on the close",
      "Stop watching if below $46.50 · only on the close",
      "Review if above $60.56",
      "Review every 7 days",
    ]);
    // The Writer's watch clock carries its mark; the lines it wrote by hand don't.
    expect(triggersOf().map((t) => t.playbook ?? null)).toEqual([null, null, null, "WATCH"]);
    expect(JSON.stringify(r.result)).not.toMatch(OLD_KEYS);
    expect(thesisOf()).not.toHaveProperty("entryPrice");
  });

  it("2. the buy fires: place_trade names its sale; the pending position holds it and the size reads it", async () => {
    const buy = triggersOf().find((t) => t.action === "ENTER")!;
    const r = await tool(
      "place-trade",
      "placeTrade",
      { ticker: T, direction: "LONG", entry_price: 52.1, thesis_id: thesisOf().id, entry_rationale: "HTFL closed back above its 50-day at $52.10 on volume: the pullback held. Buying at $52.10, sell if below $48.61.", sell_if_below: SALE, sell_reason: SALE_REASON, with_buy: [{ action: "TRIM", predicate: { watch: "price", is: "above", value: TAKE }, rationale: TAKE_REASON }] },
      { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, firedTrigger: { id: buy.id, action: buy.action, ticker: T } },
      52.1,
    );
    expect(r.refused).toBe(false);
    const order = proposalOf("OPEN");
    expect(order.status).toBe("AWAITING_APPROVAL");
    const position = rows("position").find((p) => p.id === order.positionId)!;
    expect(position).toMatchObject({ status: "PENDING_APPROVAL", stopLoss: SALE, stopReason: SALE_REASON, targetPrice: TAKE });
    // Sized by risk to the sale: $1,000 at risk over the $3.49 a share between the buy ($52.10) and the sale ($48.61).
    expect(position.quantity).toBe(286);
    expect((r.result.data?.sizing as string[])[0]).toContain("over $3.49 to the stop");
    // The thesis is still a watch until the fill.
    expect(thesisOf().status).toBe("WATCHING");
  });

  it("3. approved, then filled: the watch's lines come off, Sell if below goes on with its reason, the playbook's fill templates land, HOLDING", async () => {
    const order = proposalOf("OPEN");
    jest.useFakeTimers({ now: new Date("2026-11-17T15:00:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    withItsPosition(order);
    const outcome = await onStore(52.1, async () => (await import("@/lib/proposals/execute")).approveProposal(String(order.id), REPLAY_USER_ID));
    expect(outcome).toMatchObject({ ok: true, intent: "OPEN" });
    const approved = withItsPosition(rows("order").find((o) => o.id === order.id)!);
    await onStore(52.18, async () => {
      const { __test__ } = await import("@/lib/inngest/functions/reconcile-orders");
      await __test__.applyFillByIntent(approved as never, 52.18, Number(approved.quantity), new Date());
    });
    jest.useRealTimers();
    expect(thesisOf().status).toBe("HOLDING");
    const said = triggerSentences(thesisOf());
    expect(said.some((s) => s.startsWith("Buy if"))).toBe(false);
    expect(said.some((s) => s.startsWith("Stop watching"))).toBe(false);
    expect(said).toContain(`Sell if below $${SALE}`);
    expect(triggersOf().find((t) => sentenceOf(t) === `Sell if below $${SALE}`)!.rationale).toBe(SALE_REASON);
    // The take-profit goes on as its template's Trim, never as a review; the review written by hand stays.
    expect(said).toContain(`Trim 50% if above $${TAKE}`);
    expect(triggersOf().find((t) => sentenceOf(t) === `Trim 50% if above $${TAKE}`)).toMatchObject({ action: "TRIM", playbook: "PROPOSAL", rationale: TAKE_REASON });
    expect(said).toContain("Review if above $60.56");
    // The playbook's fill templates for MA_PULLBACK (the seed list), written at the fill; the watch's clock is gone.
    expect(triggersOf().filter((t) => t.playbook === "FILL").map(sentenceOf)).toEqual(["Review every 7 days", "Sell if below the 50-day average and at least 1.5× normal volume", "Review 14 days after the buy"]);
    expect(triggersOf().filter((t) => t.playbook === "WATCH")).toEqual([]);
    expect(rows("position").find((p) => p.id === order.positionId)).toMatchObject({ status: "OPEN", avgCost: 52.18 });
  });

  it("4. the Sell if below line fires on the holding: the sale's label comes from it, whatever the agent called it", async () => {
    const sale = triggersOf().find((t) => t.action === "EXIT" && sentenceOf(t) === `Sell if below $${SALE}`)!;
    const label = protectiveExitCloseReason(sale.predicate, "LONG");
    expect(label).toBe("STOP");
    const r = await tool(
      "close-position",
      "closePosition",
      { ticker: T, reason: "RISK_MANAGEMENT", belief_survived: true },
      { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, protectiveExitReason: label, protectiveExitTriggerLabel: sentenceOf(sale), firedTrigger: { id: sale.id, action: sale.action, ticker: T } },
      48.2,
    );
    expect(r.refused).toBe(false);
    expect(proposalOf("CLOSE")).toMatchObject({ status: "AWAITING_APPROVAL", closeReason: "STOP" });
  });

  it("5. the sale approved, the belief intact: the stock goes back on watch and its Sell lines come off", async () => {
    const order = proposalOf("CLOSE");
    withItsPosition(order);
    const outcome = await onStore(48.2, async () => (await import("@/lib/proposals/execute")).approveProposal(String(order.id), REPLAY_USER_ID));
    expect(outcome).toMatchObject({ ok: true, intent: "CLOSE" });
    const approved = withItsPosition(rows("order").find((o) => o.id === order.id)!);
    await onStore(48.2, async () => {
      const { __test__ } = await import("@/lib/inngest/functions/reconcile-orders");
      await __test__.applyFillByIntent(approved as never, 48.2, Number(approved.quantity), new Date());
    });
    expect(rows("position").find((p) => p.id === order.positionId)).toMatchObject({ status: "CLOSED", closeReason: "STOP" });
    expect(thesisOf().status).toBe("WATCHING");
    expect(triggersOf().filter((t) => t.action === "EXIT")).toEqual([]);
  });

  it("6. another watch's Stop watching line closes below: it retires, and its waiting buy is withdrawn", async () => {
    const line = { id: "line-angx", action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: 4, settings: { close: true } }, rationale: "Below $4 the setup is over.", cooldownDays: 1 } as Trigger;
    const watch = thesisRow({ id: "thesis_angx", ticker: "ANGX", status: "WATCHING", direction: "LONG", triggers: [line] });
    const pending = positionRow({ id: "pos_angx", symbol: "ANGX", status: "PENDING_APPROVAL", stopLoss: 3.8 });
    store = {
      ...store,
      thesis: [...rows("thesis"), watch],
      position: [...rows("position"), pending],
      order: [...rows("order"), { id: "order_angx", positionId: pending.id, position: pending, userId: REPLAY_USER_ID, environment: "PAPER", symbol: "ANGX", side: "BUY", orderType: "MARKET", quantity: 100, status: "AWAITING_APPROVAL", intent: "OPEN", thesisId: watch.id, triggerIds: [], createdAt: new Date(), expiresAt: null }],
    };
    const out = await onStore(3.9, async () => (await import("@/lib/agent/triggers/stop-watching")).stopWatching({ thesisId: "thesis_angx", trigger: line, priceAtTime: 3.9 }));
    expect(out.retired).toBe(true);
    expect(rows("thesis").find((t) => t.id === "thesis_angx")).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED", closeReason: "Stop watching if below $4 · only on the close" });
    expect(rows("order").find((o) => o.id === "order_angx")).toMatchObject({ status: "WITHDRAWN" });
    expect(rows("position").find((p) => p.id === "pos_angx")).toMatchObject({ status: "CANCELLED" });
  });

  it("7. the homepage Activity shows each step once, with its label", async () => {
    const { activityFeed } = await import("@/lib/thesis/activity-feed");
    const { accountActivityLine, oneRowPerProposal } = await import("@/lib/thesis/account-activity");
    // The rows loadAccountActivity reads: each stock's orders and its status lines (account-activity.server.ts).
    const lines = rows("thesisUpdate").filter((u) => (u.fieldChanges as { status?: unknown } | null)?.status != null);
    const feed = rows("thesis").flatMap((t) => {
      const items = activityFeed({
        updates: lines.filter((u) => u.thesisId === t.id) as never,
        orders: rows("order").filter((o) => o.thesisId === t.id) as never,
      });
      return oneRowPerProposal(items).flatMap((i) => accountActivityLine(i, String(t.ticker)) ?? []);
    });
    const of = (ticker: string, kind: string) => feed.filter((l) => l.ticker === ticker && l.kind === kind);
    // No line twice.
    expect(new Set(feed.map((l) => l.id)).size).toBe(feed.length);
    // 1. the mint, and 5. back on watch after the sale: two watch lines, one each.
    expect(of(T, "watching")).toHaveLength(2);
    // 2–3. the buy, once, at its outcome, with the proposal's reason; and the stock becoming a holding.
    expect(of(T, "bought").map((l) => l.text)).toEqual(["Bought 286 shares at $52.18"]);
    expect(of(T, "bought")[0].detail).toContain("sell if below $48.61");
    expect(of(T, "holding")).toHaveLength(1);
    // 4. the sale, once, at its fill, with its loss on the $52.18 cost.
    const sold = of(T, "sold");
    expect(sold).toHaveLength(1);
    expect(sold[0].gain?.dollar).toBeCloseTo((48.2 - 52.18) * 286, 2);
    // 6. the other watch, ended by its own line.
    expect(of("ANGX", "stopped-watching").map((l) => l.text)).toEqual(["Trigger: Stop watching if below $4 · only on the close"]);
    // Nothing on the page names a level of ours.
    expect(JSON.stringify(feed)).not.toMatch(OLD_KEYS);
    expect(feed).toHaveLength(6);
  });
});

/**
 * The chat's discovery path, check-only. The owner's chat (no analyst
 * pinned) sends HTFL to the Writer for the analyst it names; the Writer's
 * model call is the recorded one, and its save goes through the Writer's
 * check (checkDecisionAgainstSave's three steps: the save call, the save's
 * schema, record_thesis in check-only mode). Nothing is saved.
 */
describe("the chat's discovery path, check-only", () => {
  it("dispatch_thesis_research from the chat starts a Writer for the analyst it names; the Writer's decision passes the save's check and nothing is saved", async () => {
    const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
    const chatRun = { id: "run_chat", accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: "PRINCIPAL_CHAT", agentConfigId: null, parameters: {}, startedAt: new Date(), completedAt: null };
    const d = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow({ setupIds: ["MA_PULLBACK"] })], account: [accountRow()], researchRun: [chatRun] },
      args: { ticker: T, mode: "mint", reason: "HTFL beat and raised, then sold off 17%. Write it on the 50-day pullback.", analyst_id: REPLAY_ANALYST_ID },
      ctx: { runId: chatRun.id, runMode: "PRINCIPAL_CHAT", analystId: undefined },
      mocks: {
        "@/lib/market-data/sec-filings": () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }),
        "@/lib/inngest/client": () => ({ inngest: { createFunction: () => ({}), send: async (e: (typeof sent)[number]) => void sent.push(e) } }),
      },
    });
    expect(d.refused).toBe(false);
    expect(d.result.summary).toMatch(/^Dispatched thesis-writer for \$HTFL \(mint\)/);
    const writer = d.db.store.researchRun.find((r) => r.mode === "THESIS_WRITER")!;
    expect(writer).toMatchObject({ agentConfigId: REPLAY_ANALYST_ID, parentRunId: chatRun.id });
    expect(sent).toEqual([expect.objectContaining({ name: "app/thesis.write.requested", data: expect.objectContaining({ childRunId: writer.id, ticker: T, mode: "mint", forceWatchingMint: true }) })]);

    const { build, read, schema } = await writerSave();
    const call = build(sent[0].data as never, { currentPrice: fx.run.price } as never, htflDecision(), {}, null);
    expect(JSON.stringify(call.toolArgs)).not.toMatch(OLD_KEYS);
    const r = await replayTool("record-thesis", "recordThesis", {
      seed: d.db.store,
      args: schema.parse(call.toolArgs) as Record<string, unknown>,
      ctx: { runId: writer.id, runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID, forceWatchingMint: true, dryRun: true },
      quotes: { [T]: fx.run.price },
    });
    expect(read("record_thesis", r.result as never)).toMatchObject({ wouldSave: true, error: null });
    expect(r.db.store.thesis ?? []).toEqual([]);
    expect(r.db.store.thesisUpdate ?? []).toEqual([]);
  });
});
