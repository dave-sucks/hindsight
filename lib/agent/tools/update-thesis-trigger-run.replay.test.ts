/**
 * update-thesis-trigger-run.replay.test.ts — the trigger run's closing save
 * (Roadmap step 10), end to end: the four failed runs' first calls, as the
 * SDK hands them to the save, and the price the save reads for itself.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import fixture from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const tactical = { runMode: "INTRADAY_TACTICAL" };
const written = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");

/** The trigger run's real save schema, read without a database. */
async function triggerRunSchema(): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "INTRADAY_TACTICAL" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

/** What the SDK hands the save: the call parsed by this door's schema, the fields it lacks (change_status among them) stripped. */
async function asTheSdkHandsIt(call: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await triggerRunSchema()).parse(call) as Record<string, unknown>;
}

const seedFor = (ticker: "ASML" | "NVDA" | "CEG" | "MU") => {
  const fx = fixture[ticker];
  const thesis = thesisRow({ ...(fx.thesis as Row) });
  return {
    thesis: [thesis],
    position: [positionRow({ symbol: ticker, ...fx.position })],
    thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: thesis.id, type: "TRIGGER_FIRED", triggerId: fx.call.trigger_id, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: fx.price })],
  };
};

describe("sent verbatim, a real call lands on the first try", () => {
  it("NVDA: its change_status WATCHING is not a field of this save, so the call lands once with the note", async () => {
    const fx = fixture.NVDA;
    const verbatim = fx.call as Record<string, unknown>;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const call = (n: number, input: unknown) => ({ content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "update_thesis", input: JSON.stringify(input) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] });
    let turn = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        turn++;
        return turn === 1 ? call(1, verbatim) : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    } as never);
    const saves: Replay[] = [];
    const out = await generateText({
      model,
      prompt: "close out",
      tools: {
        update_thesis: tool({
          inputSchema: (await triggerRunSchema()) as never,
          execute: async (input: Record<string, unknown>) => {
            const r = await replayTool("update-thesis", "updateThesis", { seed: seedFor("NVDA"), args: input, ctx: tactical, quotes: { NVDA: fx.price } });
            saves.push(r);
            return r.result;
          },
        }),
      },
      stopWhen: stepCountIs(3),
    });
    expect(out.steps[0].content.filter((p) => p.type === "tool-error")).toEqual([]);
    expect(saves).toHaveLength(1);
    expect(saves[0].db.store.thesis[0]).toMatchObject({ status: "HOLDING" });
    expect(written(saves[0].db)).toEqual([expect.objectContaining({ rationale: fx.call.rationale })]);
  });
});

describe("the four failed runs' first calls, through the trigger run's save", () => {
  for (const ticker of ["ASML", "NVDA", "CEG", "MU"] as const) {
    const fx = fixture[ticker];
    it(`${ticker}: the note lands and nothing is refused`, async () => {
      const r = await replayTool("update-thesis", "updateThesis", {
        seed: seedFor(ticker),
        args: await asTheSdkHandsIt(fx.call as Record<string, unknown>),
        ctx: tactical,
        quotes: { [ticker]: fx.price },
      });
      expect(r.crashed).toBe(false);
      expect(r.refused).toBe(false);
      const rows = written(r.db);
      expect(rows).toHaveLength(1);
      expect(rows[0].rationale).toBe(fx.call.rationale);
      expect(r.result.data?.refused_fields).toBeUndefined();
      expect(r.db.store.thesis[0]).toMatchObject({ status: "HOLDING", direction: "LONG", horizon: fx.thesis.horizon });
    });
  }
});

describe("the price the trigger run's save reads for itself", () => {
  const watch = () =>
    thesisRow({
      id: "t_w", ticker: "AAA", status: "WATCHING", direction: "LONG", entryPrice: 100, targetPrice: 140, stopLoss: 90,
      triggers: [
        { id: "buy", action: "ENTER", source: "AGENT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "Buy the pullback to $100." },
        { id: "tgt", action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "above", value: 140 }, rationale: "Target $140." },
        { id: "flr", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 90 }, rationale: "Floor $90." },
      ],
    });
  const fire = (priceAtTime: number | null) =>
    thesisUpdateRow({ id: "fire", thesisId: "t_w", type: "TRIGGER_FIRED", triggerId: "buy", runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime });
  const moveTheBuy = { thesis_id: "t_w", trigger_id: "buy", rationale: "The pullback overshot; buying the reclaim of $96 instead.", edit_triggers: [{ id: "buy", level: 96, rationale: "Reclaim of the $96 shelf." }] };

  it("no quote: the fire's own price reads the buy's side, and the move lands", async () => {
    const r = await replayTool("update-thesis", "updateThesis", { seed: { thesis: [watch()], thesisUpdate: [fire(94)] }, args: moveTheBuy, ctx: tactical, quotes: {} });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "buy", ok: true })]);
    const buy = (r.db.store.thesis[0].triggers as Array<{ id: string; predicate: { is: string; value: number } }>).find((t) => t.id === "buy");
    expect(buy?.predicate).toMatchObject({ is: "above", value: 96 });
  });

  it("no quote and no fire price: the buy move is refused by name, without naming a field this save lacks", async () => {
    const r = await replayTool("update-thesis", "updateThesis", { seed: { thesis: [watch()], thesisUpdate: [fire(null)] }, args: moveTheBuy, ctx: tactical, quotes: {} });
    const ops = r.result.data?.trigger_ops as Array<{ id: string; ok: boolean; reason?: string }>;
    expect(ops).toEqual([expect.objectContaining({ id: "buy", ok: false })]);
    expect(ops[0].reason).not.toContain("price_at_time");
    expect(written(r.db)).toHaveLength(1);
  });
});
