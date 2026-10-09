/**
 * update-thesis-morning-run.replay.test.ts — the morning run's save, end to
 * end: four real morning calls sent verbatim through the SDK's loop to the
 * real save, each on its row as it stood when the call was made
 * (lib/agent/__fixtures__/morning-save-2026-10.json), and the price the save
 * reads for itself.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import fixture from "@/lib/agent/__fixtures__/morning-save-2026-10.json";
import { replayTool, thesisRow, positionRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const morning = { runMode: "MORNING_PLAN" };
const written = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");

/** The morning run's real save schema, read without a database. */
async function morningRunSchema(): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "MORNING_PLAN" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

type Ticker = "MU" | "ABT" | "DOCU" | "CORT";
type Entry = { call: Record<string, unknown>; price: number; position: { quantity: number; avgCost: number; peakPrice: number | null } | null; thesis: Row };
const entry = (t: Ticker) => fixture[t] as unknown as Entry;
const seedFor = (t: Ticker) => {
  const fx = entry(t);
  return { thesis: [thesisRow({ ...fx.thesis })], position: fx.position ? [positionRow({ symbol: t, ...fx.position })] : [] };
};

/**
 * The call as the model sent it, through the SDK's loop: the SDK parses it
 * with this door's schema and hands what it parsed to the real save.
 */
async function sentVerbatim(t: Ticker): Promise<{ received: Record<string, unknown>; save: Replay }> {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let turn = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      ++turn === 1
        ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "update_thesis", input: JSON.stringify(entry(t).call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
  } as never);
  const out: { received?: Record<string, unknown>; save?: Replay } = {};
  await generateText({
    model,
    prompt: "review",
    tools: {
      update_thesis: tool({
        inputSchema: (await morningRunSchema()) as never,
        execute: async (input: Record<string, unknown>) => {
          out.received = input;
          out.save = await replayTool("update-thesis", "updateThesis", { seed: seedFor(t), args: input, ctx: morning, quotes: { [t]: entry(t).price } });
          return out.save.result;
        },
      }),
    },
    stopWhen: stepCountIs(2),
  });
  if (!out.save || !out.received) throw new Error(`${t}: the SDK never reached the save`);
  return { received: out.received, save: out.save };
}

const SAVE_LACKS = ["price_at_time", "snapshot", "scoring", "variant_view"];

describe("four real morning calls, sent verbatim through the SDK's loop to the morning run's save", () => {
  it("MU 10-02, held: sent price_at_time and the snapshot; the stop moves $1,041 → $1,048 with its reason, the writer's snapshot stays", async () => {
    const { received, save } = await sentVerbatim("MU");
    for (const f of ["price_at_time", "snapshot"]) expect([f, f in entry("MU").call, f in received]).toEqual([f, true, false]);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    expect(save.result.data?.refused_fields).toBeUndefined();
    const row = save.db.store.thesis[0];
    expect(row.stopLoss).toBe(1048);
    expect(row.snapshot).toEqual(entry("MU").thesis.snapshot);
    expect((row.triggers as Array<{ id: string; predicate: { value: number } }>).find((x) => x.id === "t4")?.predicate.value).toBe(1048);
    expect(written(save.db).map((u) => u.rationale)).toEqual([entry("MU").call.rationale]);
  });

  it("ABT 10-07, watched: sent price_at_time and the snapshot; the plan's three levels land from none, the principal's review it named is removed, the snapshot stays", async () => {
    const { received, save } = await sentVerbatim("ABT");
    for (const f of ["price_at_time", "snapshot"]) expect([f, f in entry("ABT").call, f in received]).toEqual([f, true, false]);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    expect(save.result.data?.refused_fields).toBeUndefined();
    const row = save.db.store.thesis[0];
    expect(row).toMatchObject({ entryPrice: 100.6, targetPrice: 135, stopLoss: 95.48 });
    expect(row.snapshot).toEqual(entry("ABT").thesis.snapshot);
    expect((row.triggers as Array<{ id: string }>).map((x) => x.id)).not.toContain("4503a4f5-f854-41df-aed3-3913027d5650");
    expect(save.result.data?.trigger_ops).toEqual(expect.arrayContaining([expect.objectContaining({ id: "4503a4f5-f854-41df-aed3-3913027d5650", ok: true })]));
  });

  it("DOCU 10-07, sold the day before: back on watch lands through this door; its 1.71:1 plan is refused by name with the arithmetic and the rest lands", async () => {
    const { received, save } = await sentVerbatim("DOCU");
    expect(received.change_status).toBe("WATCHING");
    expect(received).not.toHaveProperty("price_at_time");
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row).toMatchObject({ status: "WATCHING", retiredReason: null });
    expect(written(save.db).map((u) => u.type)).toEqual(["STATUS_CHANGED"]);
    const refused = save.result.data?.refused_fields as Array<{ field: string; reason: string }>;
    expect(refused).toEqual([expect.objectContaining({ field: "triggers" })]);
    expect(refused[0].reason).toMatch(/1\.71:1 is below the mandatory 2:1 minimum/);
    const ops = save.result.data?.trigger_ops as Array<{ ok: boolean }>;
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => !o.ok)).toBe(true);
  });

  it("CORT 10-09, held: the snapshot, the scores and the variant view it rewrote never reach the save; the note and the conviction's reason land", async () => {
    const { received, save } = await sentVerbatim("CORT");
    for (const f of SAVE_LACKS) expect([f, f in entry("CORT").call, f in received]).toEqual([f, true, false]);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    expect(save.result.data?.refused_fields).toBeUndefined();
    expect(save.result.data?.changed_fields).toEqual(["convictionRationale"]);
    const row = save.db.store.thesis[0];
    const before = entry("CORT").thesis;
    expect({ snapshot: row.snapshot, scoring: row.scoring, variantView: row.variantView }).toEqual({ snapshot: before.snapshot, scoring: before.scoring, variantView: before.variantView });
    expect(row.convictionRationale).toBe(entry("CORT").call.conviction_rationale);
    expect(written(save.db).map((u) => u.rationale)).toEqual([entry("CORT").call.rationale]);
  });
});

describe("the price the morning run's save reads for itself", () => {
  const watch = () =>
    thesisRow({
      id: "t_w", ticker: "AAA", status: "WATCHING", direction: "LONG", entryPrice: 100, targetPrice: 140, stopLoss: 90,
      triggers: [
        { id: "buy", action: "ENTER", source: "AGENT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "Buy the pullback to $100." },
        { id: "tgt", action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "above", value: 140 }, rationale: "Target $140." },
        { id: "flr", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 90 }, rationale: "Floor $90." },
      ],
    });
  const moveTheBuy = { thesis_id: "t_w", rationale: "The pullback overshot; buying the reclaim of $96 instead.", edit_triggers: [{ id: "buy", level: 96, rationale: "Reclaim of the $96 shelf." }] };

  it("with a quote, the buy's side is read off it and the move lands", async () => {
    const r = await replayTool("update-thesis", "updateThesis", { seed: { thesis: [watch()] }, args: moveTheBuy, ctx: morning, quotes: { AAA: 94 } });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "buy", ok: true })]);
    const buy = (r.db.store.thesis[0].triggers as Array<{ id: string; predicate: { is: string; value: number } }>).find((t) => t.id === "buy");
    expect(buy?.predicate).toMatchObject({ is: "above", value: 96 });
  });

  it("no quote: the buy move is refused by name, without naming a field this save lacks", async () => {
    const r = await replayTool("update-thesis", "updateThesis", { seed: { thesis: [watch()] }, args: moveTheBuy, ctx: morning, quotes: {} });
    const ops = r.result.data?.trigger_ops as Array<{ id: string; ok: boolean; reason?: string }>;
    expect(ops).toEqual([expect.objectContaining({ id: "buy", ok: false })]);
    expect(ops[0].reason).not.toContain("price_at_time");
    expect(ops[0].reason).toContain("Leave the buy as it is");
    expect(written(r.db)).toHaveLength(1);
  });
});
