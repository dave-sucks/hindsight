/**
 * place-trade.plan.replay.test.ts — a buy carries its own sale (2026-11-16):
 * place_trade takes `sell_if_below` and `sell_reason` from the agent, the
 * size reads it, and the pending position holds it, so the proposal card and
 * Edit & Approve show it. Nothing is read off the stock's triggers: a watch's
 * line ends the watch and is never the sale.
 *
 * ANET, 2026-08-20 14:16 UTC (trigger run cmt1lst6l000t04joaoms5x73): the
 * real call, sent through the SDK's loop to the trigger run's buy, on ANET's
 * row as it stood (lib/agent/__fixtures__/anet-buy-2026-08-20.json), its
 * floor stored as the 2026-11-16 migration stores it (STOP_WATCHING, on the
 * close). The call sent its sale as the old `stop_loss`, $175.99, with its
 * reason in its own words; today's call names the same price in
 * `sell_if_below`.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/anet-buy-2026-08-20.json";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const FIXTURE = "lib/agent/__fixtures__/anet-buy-2026-08-20.json";
type Entry = { call: Record<string, unknown>; price: number; thesis: Row & { triggers: Array<Record<string, unknown>> } };
const entry = fixture as unknown as Entry;
const CTX = { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", minPositionSize: 3000, maxPositionSize: 10000, maxOpenPositions: 6 };

/** The trigger run's real place_trade schema, read without a database. */
async function buySchema(): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { placeTrade } = await import("./place-trade");
    schema = (placeTrade({ runId: "r", userId: "u", accountId: "a", runMode: "INTRADAY_TACTICAL" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

/** ANET's row, with its Stop watching line at `floor` (or none) and, unless `target` is false, its $215 review, as the seed. */
const seed = (floor: number | null, target = true) => ({
  thesis: [
    thesisRow({
      ...entry.thesis,
      analystId: REPLAY_ANALYST_ID,
      triggers: entry.thesis.triggers
        .map((t) => (t.action === "EXIT" ? (floor == null ? null : { ...t, action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: floor, settings: { close: true } } }) : t))
        .filter((t) => t != null && (target || t.action !== "REVIEW")),
    }),
  ],
  agentConfig: [agentConfigRow({ minPositionSize: 3000, maxPositionSize: 10000, maxPositionTotal: 20000, maxOpenPositions: 6, riskPct: 1 })],
  // Buys wait for the principal, so the replay stops at the proposal and never reaches the broker.
  account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalSellsPaper: true, requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

/** The 08-20 call's own sale, in today's fields: its stop_loss and the sentence it gave for it. */
const REASON = "Under the 50-day at $176.66: below it the earnings-drift setup is broken.";
const today = (sale = entry.call.stop_loss) => ({ ...entry.call, sell_if_below: sale, sell_reason: REASON });

/** A call as the model sent it, through the SDK's loop to the real buy. No buy when the schema refuses it. */
async function sentVerbatim(call: Record<string, unknown>, floor: number | null, target = true): Promise<{ received?: Record<string, unknown>; buy?: Replay }> {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let turn = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      ++turn === 1
        ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "place_trade", input: JSON.stringify(call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
  } as never);
  const out: { received?: Record<string, unknown>; buy?: Replay } = {};
  await generateText({
    model,
    prompt: "the buy fired",
    tools: {
      place_trade: tool({
        inputSchema: (await buySchema()) as never,
        execute: async (input: Record<string, unknown>) => {
          out.received = input;
          // The trigger run's stock, as tactical-run.ts hands it: its schema asks the model for none of it.
          const runStock = { ticker: "ANET", thesisId: entry.thesis.id, triggerId: entry.thesis.triggers.find((t) => t.action === "ENTER")?.id ?? "fired" };
          out.buy = await replayTool("place-trade", "placeTrade", { seed: seed(floor, target), args: input, ctx: { ...CTX, runStock }, quotes: { ANET: entry.price } });
          return out.buy.result;
        },
      }),
    },
    stopWhen: stepCountIs(2),
  });
  return out;
}

/** The buy the call reached; the test fails if the schema refused it. */
async function bought(call: Record<string, unknown>, floor: number | null, target = true): Promise<{ received: Record<string, unknown>; buy: Replay }> {
  const out = await sentVerbatim(call, floor, target);
  if (!out.buy || !out.received) throw new Error("ANET: the SDK never reached the buy");
  return { received: out.received, buy: out.buy };
}

const positionOf = (r: Replay) => (r.db.store.position as Array<Record<string, unknown>>)[0];

describe("ANET 08-20: the trigger run's buy", () => {
  it("the call as sent on 08-20 names no sale: no floor can be priced for ANET, so the buy is refused, asking for one, and nothing is bought", async () => {
    const { buy } = await sentVerbatim(entry.call, 175.99);
    expect(buy?.refused).toBe(true);
    expect(buy?.refusal?.message).toMatch(/Name the floor \(sell_if_below\) under structure on the chart, with its reason\.$/);
    expect(buy?.db.store.position ?? []).toHaveLength(0);
  });

  it("the same call with its sale: the pending position holds $175.99 and its reason, and the size reads it", async () => {
    const { received, buy } = await bought(today(), 175.99);
    for (const f of ["target_price", "stop_loss", "notional", "shares"]) expect([f, f in entry.call, f in received]).toEqual([f, true, false]);
    expect(buy.crashed).toBe(false);
    expect(buy.refused).toBe(false);
    expect(buy.result.data?.status).toBe("PROPOSED");
    // No target of our own: the $215 review stays a review on the stock.
    expect(positionOf(buy)).toMatchObject({ status: "PENDING_APPROVAL", stopLoss: 175.99, initialStop: 175.99, stopReason: REASON });
    expect(positionOf(buy).targetPrice ?? null).toBeNull();
    // Risk ÷ the distance to the sale: $186.76 − $175.99 = $10.77 a share.
    expect((buy.result.data?.sizing as string[]).join(" ")).toContain("$10.77 to the stop");
  });

  it("the watch's own line is never the sale: with it at $184.50 the position still holds the call's $175.99", async () => {
    const { buy } = await bought(today(), 184.5);
    expect(buy.refused).toBe(false);
    expect(positionOf(buy)).toMatchObject({ stopLoss: 175.99, initialStop: 175.99 });
  });

  it("a watch with no line at all buys on the call's sale (the 'no floor' refusal is gone)", async () => {
    const { buy } = await bought(today(), null, false);
    expect(buy.refused).toBe(false);
    expect(buy.result.data?.status).toBe("PROPOSED");
    expect(positionOf(buy)).toMatchObject({ stopLoss: 175.99 });
  });

  it("a sale at or above the price is refused with the fix, and nothing is written", async () => {
    const { buy } = await bought(today(187), 175.99);
    expect(buy.refused).toBe(true);
    expect(buy.refusal?.message).toContain("sell_if_below must be BELOW it");
    expect(buy.db.store.position ?? []).toHaveLength(0);
    expect(buy.db.store.order ?? []).toHaveLength(0);
  });

  it("a trigger run's buy has no reason of its own: the run's note lands on the proposal at the end of the run; the sizing lines go to the agent and the run's event", async () => {
    const { buy } = await bought(today(), 175.99);
    const order = (buy.db.store.order as Array<Record<string, unknown>>)[0];
    // 08-20's call carried an entry_rationale; inside a run that field no longer exists (the note is the reason, lib/proposals/auto-writeup.ts).
    expect(order).toMatchObject({ status: "AWAITING_APPROVAL", rationale: null });
    const sizing = buy.result.data?.sizing as string[];
    expect(sizing.join(" ")).toMatch(/sized by risk|capped at this analyst's largest trade/);
    const placed = (buy.db.store.runEvent as Array<{ type: string; payload: { sizing?: string[] } }>).find((e) => e.type === "trade_placed");
    expect(placed?.payload.sizing).toEqual(sizing);
  });

  it("the fixture is small", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
  });
});
