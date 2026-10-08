/**
 * update-thesis-trigger-run.replay.test.ts — the trigger run's closing save
 * (Roadmap step 10), end to end: the four failed runs' first calls, as the
 * SDK hands them to the save, and the price the save reads for itself.
 */
import fixture from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, type Row } from "@/lib/replay";
import type { z } from "zod";

const tactical = { runMode: "INTRADAY_TACTICAL" };
const written = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");

/** What the SDK hands the save: the call parsed by this door's schema (the model can't send WATCHING here). */
async function asTheSdkHandsIt(call: Record<string, unknown>): Promise<Record<string, unknown>> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "INTRADAY_TACTICAL" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  const { change_status: _cs, ...rest } = call;
  void _cs;
  return schema!.parse(rest) as Record<string, unknown>;
}

describe("the four failed runs' first calls, through the trigger run's save", () => {
  for (const ticker of ["ASML", "NVDA", "CEG", "MU"] as const) {
    const fx = fixture[ticker];
    it(`${ticker}: the note lands and nothing is refused`, async () => {
      const thesis = thesisRow({ ...(fx.thesis as Row) });
      const r = await replayTool("update-thesis", "updateThesis", {
        seed: {
          thesis: [thesis],
          position: [positionRow({ symbol: ticker, ...fx.position })],
          thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: thesis.id, type: "TRIGGER_FIRED", triggerId: fx.call.trigger_id, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: fx.price })],
        },
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
