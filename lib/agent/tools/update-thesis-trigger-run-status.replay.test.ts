/**
 * update-thesis-trigger-run-status.replay.test.ts — the trigger run's save
 * is a note (write_note) and trigger edits (edit_triggers), one job each since
 * 2026-11-18, with no status field on either. Since 2026-11-19 it can stop
 * watching its stock with stop_watching, a tool of its own it has to choose
 * (the owner's call); the second half of this file is that tool on the same rows.
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
import { asTheNewTools, oldLevelFieldsAsTriggerOps, replayCalls, replayTool, thesisRow, positionRow, thesisUpdateRow, type Replay, type Row } from "@/lib/replay";
import { isAgentAnswer, type ActivityRow } from "@/lib/agent/stock-context";
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

describe("the trigger run's note and trigger edits make no status change", () => {
  it("NVDA 10-09, held: the call's INVALIDATED has no field to ride on; the calls land, nothing refused, still HOLDING, the target edit as before", async () => {
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

  it("DOCU, watched: the replay's ARCHIVED has no field to ride on; it stays on watch, the plan untouched, the note lands", async () => {
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

describe("stop_watching from a trigger run, on the same rows", () => {
  const stop = (c: Case, runMode: string, position?: Row) =>
    replayTool("stop-watching", "stopWatching", {
      seed: {
        thesis: [thesisRow({ ...c.thesis, triggers: asStored(c) as Row[] })],
        position: position ? [position] : [],
        thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: c.thesis.id, type: "TRIGGER_FIRED", triggerId: c.fire.triggerId, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: c.fire.price })],
      },
      // A trigger run's stock is filled by code; a morning run names the thesis.
      args: runMode === "INTRADAY_TACTICAL" ? { reason: c.call.rationale } : { thesis_id: c.thesis.id, reason: c.call.rationale },
      ctx: { runMode, ...(runMode === "INTRADAY_TACTICAL" ? { runStock: { thesisId: c.thesis.id, triggerId: c.fire.triggerId, ticker: c.thesis.ticker } } : {}) },
      quotes: { [c.thesis.ticker]: c.fire.price },
    });
  /** What the save left: the thesis's state, and each line it wrote with what a reader needs of it. */
  const left = (r: Replay) => ({
    thesis: { status: r.db.store.thesis[0].status, retiredReason: r.db.store.thesis[0].retiredReason },
    lines: written(r).map((u) => ({ type: u.type, rationale: u.rationale, answers: isAgentAnswer(u as unknown as ActivityRow) })),
  });

  it("DOCU, watched: the thesis retires as dropped, with one Activity line whose paragraph is the reason, and that line is the run's answer", async () => {
    const r = await stop(fixture.docu, "INTRADAY_TACTICAL");
    expect([r.crashed, r.refused]).toEqual([false, false]);
    expect(left(r)).toEqual({
      thesis: { status: "RETIRED", retiredReason: "DROPPED" },
      lines: [{ type: "STATUS_CHANGED", rationale: fixture.docu.call.rationale, answers: true }],
    });
  });

  it("it works from a trigger run as it does from a morning run: the same state and the same line", async () => {
    const morning = await stop(fixture.docu, "MORNING_PLAN");
    expect(left(morning)).toEqual(left(await stop(fixture.docu, "INTRADAY_TACTICAL")));
  });

  it("NVDA, held: refused, still held, nothing retired; a holding is sold with sell", async () => {
    const c = fixture.nvda;
    const r = await stop(c, "INTRADAY_TACTICAL", positionRow({ symbol: "NVDA", direction: "LONG", ...c.position }));
    // The save refuses the status change and says to sell first; the reason is kept as a review's note.
    const refused = (r.result.data?.refused_fields ?? []) as Array<{ field: string; reason: string }>;
    expect(refused.map((f) => f.field)).toEqual(["stop_watching"]);
    expect(refused[0].reason).toContain("Call `sell` first");
    expect(r.db.store.thesis[0]).toMatchObject({ status: "HOLDING", retiredReason: null });
    expect(r.db.store.position[0]).toMatchObject({ status: "OPEN" });
  });
});
