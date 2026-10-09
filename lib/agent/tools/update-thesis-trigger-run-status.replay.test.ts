/**
 * update-thesis-trigger-run-status.replay.test.ts — the trigger run's save
 * has no change_status.
 *
 * The trigger run fills every field its save offers. Since #811 left
 * change_status two values, both retiring, its close-outs carried one: NVDA
 * 2026-10-09 sent INVALIDATED on a held stock (the close-first rule stopped
 * it), and a docu-trigger replay the same day sent ARCHIVED on a watched
 * one, which the save took and retired. Both calls verbatim
 * (lib/agent/__fixtures__/trigger-run-status-2026-10.json), parsed by the
 * door's schema as the SDK hands them over, through the real save.
 */
import fixture from "@/lib/agent/__fixtures__/trigger-run-status-2026-10.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

type Case = (typeof fixture)["nvda"] | (typeof fixture)["docu"];

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

async function closeOut(c: Case, position?: Row): Promise<{ args: Record<string, unknown>; r: Replay }> {
  const args = (await triggerRunSchema()).parse(c.call) as Record<string, unknown>;
  const r = await replayTool("update-thesis", "updateThesis", {
    seed: {
      thesis: [thesisRow({ ...c.thesis, triggers: c.thesis.triggers as Row[] })],
      position: position ? [position] : [],
      thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: c.thesis.id, type: "TRIGGER_FIRED", triggerId: c.fire.triggerId, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: c.fire.price })],
    },
    args,
    ctx: { runMode: "INTRADAY_TACTICAL" },
    quotes: { [c.thesis.ticker]: c.fire.price },
  });
  return { args, r };
}
const written = (r: Replay) => (r.db.store.thesisUpdate as Row[]).filter((u) => u.type !== "TRIGGER_FIRED");

describe("the trigger run's save takes no status change", () => {
  it("NVDA 10-09, held: the call's INVALIDATED never reaches the save; the call lands, nothing refused, still HOLDING, the target edit as before", async () => {
    const c = fixture.nvda;
    expect(c.call.change_status).toBe("INVALIDATED");
    const { args, r } = await closeOut(c, positionRow({ symbol: "NVDA", direction: "LONG", ...c.position }));
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.result.data?.refused_fields).toBeUndefined();
    expect(r.db.store.thesis[0]).toMatchObject({ status: "HOLDING", retiredReason: null });
    expect(args).not.toHaveProperty("change_status");
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "8f58e347-64c5-41bf-90f3-b17ac4466ae7", ok: true, text: "Target: wording updated" })]);
    expect(written(r)).toEqual([expect.objectContaining({ rationale: c.call.rationale })]);
  });

  it("DOCU, watched: the replay's ARCHIVED never reaches the save; it stays on watch, the plan untouched, the note lands", async () => {
    const c = fixture.docu;
    expect(c.call.change_status).toBe("ARCHIVED");
    const { args, r } = await closeOut(c);
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    const row = r.db.store.thesis[0];
    expect(row).toMatchObject({ status: "WATCHING", retiredReason: null, entryPrice: 67, targetPrice: 83, stopLoss: 63 });
    expect(args).not.toHaveProperty("change_status");
    expect((row.triggers as Array<{ id: string; predicate: unknown }>).map((t) => [t.id, t.predicate])).toEqual(c.thesis.triggers.map((t) => [t.id, t.predicate]));
    expect(written(r)).toEqual([expect.objectContaining({ rationale: c.call.rationale })]);
  });
});
