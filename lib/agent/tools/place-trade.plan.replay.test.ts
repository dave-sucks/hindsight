/**
 * place-trade.plan.replay.test.ts — a buy carries the thesis row's plan
 * (step 12, part 3): place_trade's schema has no target_price or stop_loss,
 * and the trade takes its target and floor from the row's own triggers.
 *
 * In every place_trade call since 2026-09-10 whose row plan can be checked
 * (24 of 24) the call sent the row's numbers back; the August rows can't be
 * checked (their audit rows don't diff the level columns). So the change
 * removes a second source for numbers that were copies.
 *
 * ANET, 2026-08-20 14:16 UTC (trigger run cmt1lst6l000t04joaoms5x73): the
 * real call, sent verbatim through the SDK's loop to the trigger run's buy,
 * on ANET's row as it stood (lib/agent/__fixtures__/anet-buy-2026-08-20.json).
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

/** ANET's row, with its floor trigger at `floor` (or none), as the seed. */
const seed = (floor: number | null) => ({
  thesis: [
    thesisRow({
      ...entry.thesis,
      analystId: REPLAY_ANALYST_ID,
      triggers: entry.thesis.triggers
        .map((t) => (t.action === "EXIT" ? (floor == null ? null : { ...t, predicate: { watch: "price", is: "below", value: floor } }) : t))
        .filter(Boolean),
    }),
  ],
  agentConfig: [agentConfigRow({ minPositionSize: 3000, maxPositionSize: 10000, maxPositionTotal: 20000, maxOpenPositions: 6, riskPct: 1 })],
  // Buys wait for the principal, so the replay stops at the proposal and never reaches the broker.
  account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalSellsPaper: true, requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

/** The call as the model sent it, through the SDK's loop to the real buy. */
async function sentVerbatim(floor: number | null): Promise<{ received: Record<string, unknown>; buy: Replay }> {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let turn = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      ++turn === 1
        ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "place_trade", input: JSON.stringify(entry.call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
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
          out.buy = await replayTool("place-trade", "placeTrade", { seed: seed(floor), args: input, ctx: CTX, quotes: { ANET: entry.price } });
          return out.buy.result;
        },
      }),
    },
    stopWhen: stepCountIs(2),
  });
  if (!out.buy || !out.received) throw new Error("ANET: the SDK never reached the buy");
  return { received: out.received, buy: out.buy };
}

const positionOf = (r: Replay) => (r.db.store.position as Array<Record<string, unknown>>)[0];

describe("ANET 08-20: the trigger run's buy", () => {
  it("the call's target and stop never reach the buy; the position carries the row's plan ($215, $175.99)", async () => {
    const { received, buy } = await sentVerbatim(175.99);
    for (const f of ["target_price", "stop_loss", "notional", "shares"]) expect([f, f in entry.call, f in received]).toEqual([f, true, false]);
    expect(buy.crashed).toBe(false);
    expect(buy.refused).toBe(false);
    expect(buy.result.data?.status).toBe("PROPOSED");
    expect(positionOf(buy)).toMatchObject({ targetPrice: 215, stopLoss: 175.99, initialStop: 175.99 });
  });

  it("a variant: the row's floor at $184.50 (the 08-26 level); the position takes the plan's floor, not the call's $175.99", async () => {
    const { buy } = await sentVerbatim(184.5);
    expect(buy.refused).toBe(false);
    expect(positionOf(buy)).toMatchObject({ targetPrice: 215, stopLoss: 184.5, initialStop: 184.5 });
  });

  it("a variant: the row has no floor; the buy is refused with the next move named, and nothing is written", async () => {
    const { buy } = await sentVerbatim(null);
    expect(buy.refused).toBe(true);
    expect(buy.refusal?.message).toContain("plan has no floor");
    expect(buy.refusal?.message).toContain("update_thesis (stop_loss)");
    expect(buy.db.store.position ?? []).toHaveLength(0);
    expect(buy.db.store.order ?? []).toHaveLength(0);
  });

  it("the fixture is small", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
  });
});
