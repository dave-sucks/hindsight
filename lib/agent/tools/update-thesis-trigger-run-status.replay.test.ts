/**
 * update-thesis-trigger-run-status.replay.test.ts — the trigger run has no
 * status tool: its save is a note (write_note) and trigger edits
 * (edit_triggers), one job each since 2026-11-18.
 *
 * The trigger run fills every field its save offers. Since #811 left
 * change_status two values, both retiring, its close-outs carried one: NVDA
 * 2026-10-09 sent INVALIDATED on a held stock (the close-first rule stopped
 * it), and a docu-trigger replay the same day sent ARCHIVED on a watched
 * one, which the save took and retired. Both calls verbatim
 * (lib/agent/__fixtures__/trigger-run-status-2026-10.json), as the calls the
 * trigger run makes now (asTheNewTools), through the real tools.
 */
import fixture from "@/lib/agent/__fixtures__/trigger-run-status-2026-10.json";
import { asTheNewTools, oldLevelFieldsAsTriggerOps, replayCalls, thesisRow, positionRow, thesisUpdateRow, type Replay, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

type Case = (typeof fixture)["nvda"] | (typeof fixture)["docu"];

/** A stock's triggers as stored after the 2026-11-16 migration: on a watch, its sale line is its Stop watching line on the close. */
const asStored = (c: Case) =>
  (c.thesis.triggers as Array<{ id: string; action: string; predicate: Record<string, unknown> }>).map((t) =>
    c.thesis.status !== "HOLDING" && t.action === "EXIT" ? { ...t, action: "STOP_WATCHING", predicate: { ...t.predicate, settings: { close: true } } } : t,
  );

async function closeOut(c: Case, position?: Row): Promise<{ calls: ReturnType<typeof asTheNewTools>; r: Replay }> {
  // The call's levels as the edits of their triggers (the fields went 2026-11-16).
  const call = oldLevelFieldsAsTriggerOps(c.call, asStored(c) as unknown as Trigger[], String(c.thesis.direction ?? "LONG"), { held: c.thesis.status === "HOLDING" });
  const calls = asTheNewTools(call, "INTRADAY_TACTICAL");
  const rs = await replayCalls(calls, {
    seed: {
      thesis: [thesisRow({ ...c.thesis, triggers: asStored(c) as Row[] })],
      position: position ? [position] : [],
      thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: c.thesis.id, type: "TRIGGER_FIRED", triggerId: c.fire.triggerId, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: c.fire.price })],
    },
    ctx: { runMode: "INTRADAY_TACTICAL", runStock: { thesisId: c.thesis.id, triggerId: c.fire.triggerId, ticker: c.thesis.ticker } },
    quotes: { [c.thesis.ticker]: c.fire.price },
  });
  // The last call's database holds every call's rows; its reply is the note's.
  return { calls, r: { ...rs[rs.length - 1], refused: rs.some((x) => x.refused), crashed: rs.some((x) => x.crashed) } };
}
const opsOf = (rs: Replay[]) => rs.flatMap((x) => (x.result.data?.trigger_ops as unknown[] | undefined) ?? []);
const written = (r: Replay) => (r.db.store.thesisUpdate as Row[]).filter((u) => u.type !== "TRIGGER_FIRED");

describe("the trigger run makes no status change", () => {
  it("NVDA 10-09, held: the call's INVALIDATED has no tool to reach; the calls land, nothing refused, still HOLDING, the target edit as before", async () => {
    const c = fixture.nvda;
    expect(c.call.change_status).toBe("INVALIDATED");
    const { calls, r } = await closeOut(c, positionRow({ symbol: "NVDA", direction: "LONG", ...c.position }));
    const edit = await replayCalls(calls.filter((x) => x.module === "edit-triggers"), {
      seed: { thesis: [thesisRow({ ...c.thesis, triggers: asStored(c) as Row[] })], position: [positionRow({ symbol: "NVDA", direction: "LONG", ...c.position })] },
      ctx: { runMode: "INTRADAY_TACTICAL", runStock: { thesisId: c.thesis.id, triggerId: c.fire.triggerId, ticker: c.thesis.ticker } },
      quotes: { [c.thesis.ticker]: c.fire.price },
    });
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.result.data?.refused_fields).toBeUndefined();
    expect(r.db.store.thesis[0]).toMatchObject({ status: "HOLDING", retiredReason: null });
    expect(calls.map((x) => x.module)).toEqual(["edit-triggers", "write-note"]);
    expect(opsOf(edit)).toEqual([expect.objectContaining({ id: "8f58e347-64c5-41bf-90f3-b17ac4466ae7", ok: true, text: "Upside: wording updated" })]);
    // Two lines now: the trigger edit (a title, no paragraph) and the note.
    expect(written(r).map((u) => u.rationale ?? null)).toEqual([null, c.call.rationale]);
  });

  it("DOCU, watched: the replay's ARCHIVED has no tool to reach; it stays on watch, the plan untouched, the note lands", async () => {
    const c = fixture.docu;
    expect(c.call.change_status).toBe("ARCHIVED");
    const { calls, r } = await closeOut(c);
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    const row = r.db.store.thesis[0];
    expect(row).toMatchObject({ status: "WATCHING", retiredReason: null, entryPrice: 67, targetPrice: 83, stopLoss: 63 });
    expect(calls.map((x) => x.module)).not.toContain("stop-watching");
    expect((row.triggers as Array<{ id: string; predicate: unknown }>).map((t) => [t.id, t.predicate])).toEqual(asStored(c).map((t) => [t.id, t.predicate]));
    // Two lines now: the trigger edit (a title, no paragraph) and the note.
    expect(written(r).map((u) => u.rationale ?? null)).toEqual([null, c.call.rationale]);
  });
});
