/**
 * The trigger run's real handler, per fire mode, on production rows (2026-10-22); the model is captured,
 * never called, and the trade tools are the edges. IOT's live floor (Auto) proposes the sale, then the
 * same run writes it up with no trade tools and its note replaces the sale's line (2026-10-28: PLTR's
 * Auto-sell card read a template stitched from the trigger's old note and "Third ask… move the line").
 * V's floor (Send to Agent) asks the analyst; a review set to Send to Agent starts a run; TRV's
 * Auto-buy calls place_trade with the trigger's arguments, then the write-up's note is the buy's whole reason.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";
import { POST_TRADE_WRITEUP, WRITEUP_ASK } from "@/lib/agent/engine/agents/post-trade-writeup";
import { TRIGGER_RUN_ASK } from "@/lib/agent/engine/agents/trigger-run";
import { ownFile } from "@/lib/agent/engine/types";
import { instructionText } from "@/lib/agent/engine/instructions";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const SECULAR = "cmmqxola3000004lbj7c11bfn";

const IOT_FLOOR = { id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", action: "EXIT", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 41.42 }, rationale: "Under your hand-set floor at $41.42."};
const IOT_TARGET = { id: "56e86f78-7e31-43e0-b9c3-7445cc016c69", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "above", value: 52 }, rationale: "Using $52 as the objective."};
const V_FLOOR = { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "Sell if below $395. You set this."};
const TRV_BUY = { id: "6e111cb3-34f8-4d89-a2f5-f7ceff7f8f4b", action: "ENTER", fireMode: "DO_IT", predicate: { watch: "price", is: "above", value: 398.7, settings: { close: true } }, rationale: "I buy when it breaks above $398.70."};

// CEG, Nov 17: its "Sell if below $280" fired at $276.51, the analyst held, and no card ever opened.
const CEG_FLOOR = { id: "ceg-floor-280", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 280 }, rationale: "The floor." };
const CEG_HOLD = "Constellation is still under $280 this morning at about $276, and I'm holding. What changed since yesterday is the stock, not the company.";

const IOT_LINE = 'Your "Sell if below $41.42" came true. It\'s set to Auto-sell.';
const NOTE = "Samsara fell 4% on Oct 22 with software stocks after a weak guide from a peer; nothing in its own news. You own 300 shares at $42.70. Your Auto-sell at $41.42 was hit, so the sale is waiting for you; I'd hold, since nothing that would break the case has happened.";

const stocks = (target: Record<string, unknown> = IOT_TARGET) => ({
  thesis: [
    thesisRow({ id: "iot", ticker: "IOT", status: "HOLDING", direction: "LONG", analystId: PEAD, triggers: [IOT_FLOOR, target] }),
    thesisRow({ id: "v", ticker: "V", status: "HOLDING", direction: "LONG", analystId: SECULAR, triggers: [V_FLOOR] }),
    thesisRow({ id: "trv", ticker: "TRV", status: "WATCHING", direction: "LONG", analystId: SECULAR, triggers: [TRV_BUY] }),
    thesisRow({ id: "ceg", ticker: "CEG", status: "HOLDING", direction: "LONG", analystId: SECULAR, triggers: [CEG_FLOOR] }),
  ],
  position: [
    positionRow({ id: "pos_iot", symbol: "IOT", analystId: PEAD, environment: "LIVE", quantity: 300, avgCost: 42.695 }),
    positionRow({ id: "pos_v", symbol: "V", analystId: SECULAR, environment: "LIVE", quantity: 27, avgCost: 369.25 }),
    positionRow({ id: "pos_ceg", symbol: "CEG", analystId: SECULAR, environment: "LIVE", quantity: 51, avgCost: 282.01 }),
  ],
  agentConfig: [
    agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE", maxOpenPositions: 6 }),
    agentConfigRow({ id: SECULAR, name: "Secular Compounder", tradingEnvironment: "LIVE", maxOpenPositions: 10 }),
  ],
  account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

type Asked = { system: string; prompt: string; tools: string[] };

/** One fire through the handler: what the model was asked, the sale and trade calls, and the rows left behind. */
async function fire(data: { thesisId: string; triggerId: string; analystId: string; ticker: string; action: string; firedPrice: number; recoveryTry?: number; firstFiredAt?: string }, seed: ReturnType<typeof stocks> & { thesisUpdate?: Array<Record<string, unknown>> } = stocks(), model: { note?: string | null; verdict?: string; proposes?: boolean; fails?: boolean } = {}) {
  let thrown: unknown = null;
  let onFailure: unknown = null;
  const db = prismaDouble(seed);
  const create = (m: string, data: Record<string, unknown>) => (db as unknown as Record<string, { create: (a: unknown) => Promise<unknown> }>)[m].create({ data });
  const asked: Asked[] = [];
  const closes: unknown[][] = [];
  const sent: Array<{ name: string; data: unknown }> = [];
  const toolCalls: Array<{ tool: string; args: unknown; ctx: Record<string, unknown> }> = [];
  const blockArgs: unknown[] = [];
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/agent/portfolio-block", () => ({
      loadPortfolioPieces: async (a: unknown) => (blockArgs.push(a), [{ id: "market_numbers", text: "### Market numbers\nSTAND-IN" }, { id: "portfolio_snapshot", text: "### Portfolio snapshot\nSTAND-IN" }]),
    }));
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (c: { onFailure?: unknown }, _t: unknown, fn: typeof handler) => ((onFailure = c.onFailure), (handler = fn), {}), send: jest.fn(async (e: { name: string; data: unknown }) => sent.push(e)) },
    }));
    // The model writes its note the way write_note would: one row on the stock for this run.
    jest.doMock("ai", () => ({
      generateText: jest.fn(async (a: { system: string; prompt: string; tools: Record<string, unknown> }) => {
        asked.push({ system: a.system, prompt: a.prompt, tools: Object.keys(a.tools ?? {}) });
        if (model.fails) throw new Error("the model call failed");
        const run = (db.store.researchRun as Array<{ id: string }>)[0];
        if (model.proposes && !(db.store.order as unknown[] | undefined)?.length) await create("order", { id: "ord_own", positionId: `pos_${data.thesisId}`, symbol: data.ticker, thesisId: data.thesisId, intent: "CLOSE", status: "AWAITING_APPROVAL", expiresAt: null, createdAt: new Date() });
        if (model.note !== null) await create("thesisUpdate", { thesisId: data.thesisId, type: "REVIEWED", summary: "Reviewed", rationale: model.note ?? NOTE, verdict: model.verdict ?? null, runId: run.id, timestamp: new Date() });
        return { steps: [], response: { messages: [] }, text: "" };
      }),
      stepCountIs: () => () => false,
    }));
    jest.doMock("@/lib/agent/model", () => ({ modelFor: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/actions/closeTrade.actions", () => ({
      closeOpenPosition: jest.fn(async (...a: unknown[]) => {
        closes.push(a);
        await create("order", { id: "ord_iot", positionId: a[0], symbol: "IOT", thesisId: data.thesisId, rationale: a[4], status: "AWAITING_APPROVAL", createdAt: new Date(), position: { analystId: data.analystId, symbol: "IOT" } });
        return { kind: "proposed", proposal: { orderId: "ord_iot" } };
      }),
    }));
    jest.doMock("@/lib/trading/manual-order", () => ({ accountCash: async () => 50_000 }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: (ctx: Record<string, unknown>) => {
        // A buy stages its order with the reason it was given (its sizing goes to the reply, never the reason).
        const tool = (name: string) => ({
          execute: jest.fn(async (args: { entry_rationale?: string }) => {
            toolCalls.push({ tool: name, args, ctx });
            if (name === "place_trade") {
              await create("order", { id: "ord_trv", positionId: "pos_trv", symbol: "TRV", thesisId: "trv", intent: "OPEN", rationale: args.entry_rationale, status: "AWAITING_APPROVAL", createdAt: new Date(), position: { analystId: SECULAR, symbol: "TRV" } });
            }
            // A trim waiting for approval: the sale writes no decision row until it fills.
            if (name === "sell") {
              const a = args as { note?: string };
              await create("order", { id: "ord_iot_trim", positionId: "pos_iot", symbol: "IOT", thesisId: "iot", intent: "PARTIAL_CLOSE", rationale: a.note, status: "AWAITING_APPROVAL", createdAt: new Date(), position: { analystId: PEAD, symbol: "IOT" } });
            }
            return { ok: true, summary: name === "place_trade" ? "Proposed: LONG 27 $TRV" : "Partial close proposed: IOT (-30%)" };
          }),
        });
        return { place_trade: tool("place_trade"), add: tool("add"), sell: tool("sell"), get_theses: { execute: async () => ({ ok: false }) } };
      },
    }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({
      event: { data },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    }).catch((err: unknown) => void (thrown = err));
  });
  if (thrown && !model.fails) throw thrown;
  for (const m of ["@/lib/agent/portfolio-block", "ai", "@/lib/agent/model", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/actions/closeTrade.actions", "@/lib/trading/manual-order", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  const rows = (m: string) => (db.store as Record<string, Array<Record<string, unknown>>>)[m] ?? [];
  // The run page opens with the saved thread's first message (run-thread.ts).
  const thread = rows("runMessage").find((m) => m.role === "thread");
  const opening = thread ? (JSON.parse(String(thread.content))[0] as { content: Array<{ text: string }> }).content.map((p) => p.text).join("") : null;
  return { asked, closes, sent, toolCalls, blockArgs, runs: rows("researchRun"), orders: rows("order"), updates: rows("thesisUpdate"), opening, thrown, onFailure };
}

describe("a trigger run that fails", () => {
  const REVIEW = { ...IOT_TARGET, fireMode: "ASK_NOW" };

  it("ends failed, so the failure handler can try the fire again", async () => {
    const r = await fire({ thesisId: "iot", triggerId: REVIEW.id, analystId: PEAD, ticker: "IOT", action: "REVIEW", firedPrice: 52.1 }, stocks(REVIEW), { fails: true });
    expect(r.runs[0]).toMatchObject({ status: "FAILED" });
    expect((r.thrown as Error).name).toBe("NonRetriableError");
    expect(r.onFailure).toEqual(expect.any(Function));
  });

  it("a sale still opens its card when the analyst's run fails", async () => {
    const r = await fire({ thesisId: "v", triggerId: V_FLOOR.id, analystId: SECULAR, ticker: "V", action: "EXIT", firedPrice: 394.5 }, stocks(), { fails: true });
    expect(r.closes).toHaveLength(1);
    expect((r.thrown as Error).name).toBe("NonRetriableError");
  });

  it("a fire tried again keeps its one Activity line, now on the new run", async () => {
    const firstFiredAt = "2026-11-24T15:05:00.000Z";
    const line = { id: "line_1", thesisId: "iot", type: "TRIGGER_FIRED", triggerId: REVIEW.id, runId: "run_failed", summary: "Review if above $52", timestamp: new Date("2026-11-24T15:05:10Z") };
    const r = await fire({ thesisId: "iot", triggerId: REVIEW.id, analystId: PEAD, ticker: "IOT", action: "REVIEW", firedPrice: 52.1, recoveryTry: 1, firstFiredAt }, { ...stocks(REVIEW), thesisUpdate: [line] });
    const lines = r.updates.filter((u) => u.type === "TRIGGER_FIRED");
    expect(lines).toHaveLength(1);
    expect(lines[0].runId).toBe(r.runs[0].id);
  });
});

const IOT_TRIM = { id: "7a1c2b3d-0000-4000-8000-000000000001", action: "TRIM", fireMode: "DO_IT", trimPct: 30, predicate: { watch: "price", is: "above", value: 48 }, rationale: "Take some off into strength."};

describe("the trigger run's Market and portfolio block", () => {
  it("is loaded once for the analyst's book and printed before the stock's row", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_FLOOR.id, analystId: PEAD, ticker: "IOT", action: "EXIT", firedPrice: 41.3 });
    expect(r.blockArgs).toEqual([expect.objectContaining({ environment: "LIVE", accountId: expect.any(String) })]);
    const prompt = r.asked[0].prompt;
    expect(`${r.asked[0].system}${prompt}`.split("## Market and portfolio")).toHaveLength(2);
    expect(prompt.indexOf("## Market and portfolio")).toBeLessThan(prompt.indexOf("$IOT, its row (get_theses)"));
  });
});

describe("the trigger run, by fire mode", () => {
  it("IOT's Auto-trim with approval on: the trim waits for approval, and the write-up still lands on it (it has no decision row yet)", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_TRIM.id, analystId: PEAD, ticker: "IOT", action: "TRIM", firedPrice: 48.2 }, stocks(IOT_TRIM));
    expect(r.toolCalls).toEqual([expect.objectContaining({ tool: "sell", args: expect.objectContaining({ percent: 30 }) })]);
    expect(r.asked).toHaveLength(1);
    expect(r.orders.find((o) => o.id === "ord_iot_trim")?.rationale).toBe(NOTE);
    expect(r.sent).toContainEqual({ name: "app/proposal.note.written", data: { orderId: "ord_iot_trim" } });
  });

  it("IOT's Auto-sell: the sale is proposed with one plain line, then the run writes it up with no trade tools and its note replaces the line", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_FLOOR.id, analystId: PEAD, ticker: "IOT", action: "EXIT", firedPrice: 41.3 });
    expect(r.closes).toHaveLength(1);
    expect(r.closes[0].slice(0, 2)).toEqual(["pos_iot", "STOP"]);
    expect(r.closes[0][4]).toBe(IOT_LINE);
    // The run row says a write-up is coming, so the card and the email wait for it.
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE", parameters: expect.objectContaining({ autoTrade: true }) });
    // One write-up: no trade tools, the write-up's own text (no longer a situation, 2026-11-15), the job is the note.
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].tools).not.toEqual(expect.arrayContaining(["place_trade"]));
    expect(r.asked[0].tools.some((t) => ["place_trade", "sell", "add"].includes(t))).toBe(false);
    // The post-trade write-up's own instructions, the same on every run.
    // The analyst it works for, then its own fixed text.
    expect(r.asked[0].system.startsWith("## Analyst:")).toBe(true);
    expect(r.asked[0].system).toContain(instructionText(ownFile(POST_TRADE_WRITEUP)!));
    expect(r.asked[0].system).not.toContain("## Decision framework");
    expect(r.asked[0].prompt).not.toContain("AUTO_TRADE");
    expect(r.asked[0].prompt).toContain("The sale of all 300 shares is proposed and waits for the principal's approval.");
    // The card and the email read the analyst's note, and the email is told it's there.
    expect(r.orders.find((o) => o.id === "ord_iot")?.rationale).toBe(NOTE);
    expect(r.sent).toContainEqual({ name: "app/proposal.note.written", data: { orderId: "ord_iot" } });
    // The fire's own row carries what fired, never the trigger's old note.
    const fireRow = r.updates.find((u) => u.type === "TRIGGER_FIRED");
    expect(fireRow).toMatchObject({ summary: "Sell if below $41.42", triggerAction: "EXIT", triggerCondition: { watch: "price", is: "below", value: 41.42 } });
    expect(fireRow?.rationale ?? null).toBeNull();
  });

  it("V's floor (Send to Agent) asks the analyst first, with the trade tools and no write-up", async () => {
    const r = await fire({ thesisId: "v", triggerId: V_FLOOR.id, analystId: SECULAR, ticker: "V", action: "EXIT", firedPrice: 394.5 });
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].tools).toEqual(expect.arrayContaining(["sell"]));
    expect(r.asked[0].system).toContain("## Decision framework");
    expect(r.runs[0].parameters).not.toHaveProperty("autoTrade");
    // A default note ("Sell if below $395. You set this.") restates the trigger: the run isn't shown it.
    expect(r.asked[0].prompt).not.toContain("You set this.");
  });

  describe("a sale set to Send to Agent always reaches the owner", () => {
    const ceg = { thesisId: "ceg", triggerId: CEG_FLOOR.id, analystId: SECULAR, ticker: "CEG", action: "EXIT", firedPrice: 276.51 };

    it("CEG's hold on Nov 17: the card opens anyway, as a proposal, with the analyst's note as its reason", async () => {
      const r = await fire(ceg, stocks(), { note: CEG_HOLD, verdict: "UNCHANGED" });
      expect(r.asked[0].tools).toEqual(expect.arrayContaining(["sell"]));
      expect(r.closes).toEqual([["pos_ceg", "STOP", undefined, "price_monitor", CEG_HOLD, r.runs[0].id, true, { propose: true, triggerIds: [CEG_FLOOR.id], proposedPrice: 276.51 }]]);
      expect(r.updates.find((u) => u.rationale === CEG_HOLD)?.tradeId).toBe("ord_iot");
      expect(r.sent).toContainEqual({ name: "app/proposal.note.written", data: { orderId: "ord_iot" } });
    });

    it("a note that calls the belief broken means a sale doesn't put the stock back on watch", async () => {
      const r = await fire(ceg, stocks(), { note: CEG_HOLD, verdict: "BROKEN" });
      expect(r.closes[0][6]).toBe(false);
    });

    it("a run that fails with no note still opens the card, with the trigger's sentence", async () => {
      const r = await fire(ceg, stocks(), { note: null });
      expect(r.runs[0].status).toBe("FAILED");
      expect(r.closes).toHaveLength(1);
      expect(r.closes[0][4]).toBe('Your "Sell if below $280" came true.');
      expect(r.closes[0][6]).toBeNull();
    });

    it("a run that proposed the sale itself gets no second card", async () => {
      const r = await fire(ceg, stocks(), { note: CEG_HOLD, verdict: "WEAKER", proposes: true });
      expect(r.closes).toHaveLength(0);
    });

    it("with the approval switch off nothing is sold: the analyst's hold stands", async () => {
      const seed = { ...stocks(), account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: false })] };
      const r = await fire(ceg, seed, { note: CEG_HOLD, verdict: "UNCHANGED" });
      expect(r.closes).toHaveLength(0);
    });
  });

  it("a review set to Send to Agent starts a trigger run, and opens no sale card", async () => {
    const asked = { ...IOT_TARGET, fireMode: "ASK_NOW" };
    const r = await fire({ thesisId: "iot", triggerId: asked.id, analystId: PEAD, ticker: "IOT", action: "REVIEW", firedPrice: 52.4 }, stocks(asked));
    expect(r.asked).toHaveLength(1);
    expect(r.closes).toHaveLength(0);
    // The row wasn't read on this pass, so the message says the trigger's note (it is otherwise on the row, beside its id).
    expect(r.asked[0].prompt).toContain('Its note: "Using $52 as the objective."');
  });

  it("TRV's Auto-buy calls place_trade with the trigger's arguments, paid from cash; the write-up's note is the proposal's whole reason", async () => {
    const r = await fire({ thesisId: "trv", triggerId: TRV_BUY.id, analystId: SECULAR, ticker: "TRV", action: "ENTER", firedPrice: 398.95 });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ tool: "place_trade", args: { ticker: "TRV", direction: "LONG", entry_price: 398.95, thesis_id: "trv" }, ctx: { payFromCash: 50_000, runMode: "INTRADAY_TACTICAL", analystId: SECULAR } });
    expect((r.toolCalls[0].args as { entry_rationale: string }).entry_rationale).toMatch(/^Your ".+" came true\. It's set to Auto-buy\.$/);
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].prompt).toContain("Proposed: LONG 27 $TRV.");
    expect(r.orders.find((o) => o.id === "ord_trv")?.rationale).toBe(NOTE);
    // The note row is stamped with the order it wrote up, so the feed shows them as one line.
    expect(r.updates.find((u) => u.rationale === NOTE)?.tradeId).toBe("ord_trv");
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE" });
  });
});

// Since 2026-11-18 the first message carries the Market and portfolio block, the
// stock's row and the fired trigger; the run page showed all of it as the opening. Its opening is the message, from the trigger check.
describe("what the run page opens with", () => {
  const BLOCKS = ["## Market and portfolio", "STAND-IN", "its row (get_theses)", "## Analyst:"];

  it("a trigger run (V's floor, Send to Agent): the fire's facts and the ask, none of the blocks the model read", async () => {
    const r = await fire({ thesisId: "v", triggerId: V_FLOOR.id, analystId: SECULAR, ticker: "V", action: "EXIT", firedPrice: 394.5 });
    expect(r.opening).toBe(`Tactical run on $V. "Sell if below $395" fired at $394.50 (trigger ${V_FLOOR.id}; declared action: EXIT).\n\n${TRIGGER_RUN_ASK}`);
    for (const block of BLOCKS) expect([block, r.opening!.includes(block)]).toEqual([block, false]);
    // The model still read every read: of the Market and portfolio reads, the market numbers alone (2026-11-18).
    for (const block of ["## Market and portfolio", "### Market numbers", "its row (get_theses)"]) expect(r.asked[0].prompt).toContain(block);
    expect(r.asked[0].prompt).not.toContain("### Portfolio snapshot");
  });

  it("the post-trade write-up (IOT's Auto-sell): the fire's facts with the trade's line, and its ask", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_FLOOR.id, analystId: PEAD, ticker: "IOT", action: "EXIT", firedPrice: 41.3 });
    // The row wasn't read on this pass, so the message carries the trigger's note.
    expect(r.opening!.startsWith(`Write-up on $IOT. "Sell if below $41.42" fired at $41.30 (trigger ${IOT_FLOOR.id}; declared action: EXIT). Its note: "Under your hand-set floor at $41.42." It is set to Auto, so no analyst decided. The sale of all 300 shares is proposed and waits for the principal's approval.`)).toBe(true);
    expect(r.opening!.endsWith(`\n\n${WRITEUP_ASK}`)).toBe(true);
    for (const block of BLOCKS) expect([block, r.opening!.includes(block)]).toEqual([block, false]);
  });
});
