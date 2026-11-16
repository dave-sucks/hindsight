/**
 * update-thesis-empty-levels.replay.test.ts — a level is a trigger, removed
 * only by its id. Since 2026-11-16 no save has the entry / target / stop
 * fields at all; the calls below still carry them, as sent, and they reach
 * nothing.
 *
 * PRAX, Mon 2026-11-16. The 08:02 morning run kept the buy, floor and target.
 * At 09:30 two filing triggers fired and two trigger runs answered them. Both
 * notes said the plan was unchanged, and both calls sent the levels empty:
 * the trigger run's model fills every field it is offered, a level it keeps
 * as null. The save read null as "remove": the first call took the floor and
 * the target down, the second the buy, and PRAX was left with no plan.
 *
 * The calls are replayed verbatim (RunMessage, role thread), through each
 * door's own schema, against the row as the morning run left it.
 */
import type { z } from "zod";
import raw from "@/lib/agent/__fixtures__/prax-trigger-run-levels-2026-11-16.json";
import { replayTool, thesisRow, thesisUpdateRow, type Row } from "@/lib/replay";

type Trigger = { id: string; predicate: unknown };
const fx = raw as unknown as {
  price: number;
  thesisBefore: Row & { id: string; triggers: Trigger[] };
  morningLine: { id: string; runId: string; timestamp: string };
  calls: Array<{ runId: string; input: Record<string, unknown> }>;
};
const [BUY, FLOOR, TARGET] = ["fd8ac088-1fba-4b7f-b792-c24727b2a7a9", "525fe4a5-37a2-46fe-83cd-269ba2e78ea3", "4710e772-f65f-4f81-810a-0ff74b206096"];
const LEVELS = { entryPrice: 351.75, targetPrice: 392, stopLoss: 236 };

/** The save's schema as a door hands it to the model: what the door lacks is stripped from the call. */
async function door(runMode: string): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

const seed = (firedTriggerId: string) => ({
  thesis: [thesisRow({ ...fx.thesisBefore, catalystDate: new Date(String(fx.thesisBefore.catalystDate)) })],
  thesisUpdate: [
    thesisUpdateRow({ id: fx.morningLine.id, thesisId: fx.thesisBefore.id, type: "UPDATED", runId: fx.morningLine.runId, timestamp: new Date(Date.now() - 3_600_000) }),
    thesisUpdateRow({ id: "fire", thesisId: fx.thesisBefore.id, type: "TRIGGER_FIRED", triggerId: firedTriggerId, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: fx.price }),
  ],
});

/**
 * The trigger run's call is what its save received: a saved call is the parsed
 * one (a filing's type already moved from `value` to `variable`), so it goes
 * in as it is. Another door gets it through its own schema.
 */
async function save(call: Record<string, unknown>, runMode = "INTRADAY_TACTICAL") {
  return replayTool("update-thesis", "updateThesis", {
    seed: seed(String(call.trigger_id ?? fx.calls[0].input.trigger_id)),
    args: runMode === "INTRADAY_TACTICAL" ? call : ((await door(runMode)).parse(call) as Record<string, unknown>),
    ctx: { runMode },
    quotes: { PRAX: fx.price },
  });
}

const ids = (row: Row) => (row.triggers as Trigger[]).map((t) => t.id);
const removals = (r: Awaited<ReturnType<typeof save>>) =>
  ((r.result.data?.trigger_ops ?? []) as Array<{ op: string; id: string; ok: boolean }>).filter((o) => o.op === "remove" && o.ok);

describe("PRAX 2026-11-16: the trigger runs' saves, verbatim", () => {
  for (const [n, call] of fx.calls.entries()) {
    it(`call ${n + 1} (${call.runId}) sends the old level fields empty; the note lands and the buy, floor and review stay`, async () => {
      expect([call.input.stop_loss, call.input.target_price]).toEqual([null, null]);
      const r = await save(call.input);
      expect(r.crashed).toBe(false);
      expect(r.refused).toBe(false);
      expect(removals(r)).toEqual([]);
      const row = r.db.store.thesis[0];
      expect(ids(row)).toEqual(expect.arrayContaining([BUY, FLOOR, TARGET]));
      for (const id of [BUY, FLOOR, TARGET]) {
        expect((row.triggers as Trigger[]).find((t) => t.id === id)?.predicate).toEqual(fx.thesisBefore.triggers.find((t) => t.id === id)?.predicate);
      }
      expect(row).toMatchObject({ status: "WATCHING", ...LEVELS });
      expect((r.db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED" && u.runId !== fx.morningLine.runId)).toEqual([
        expect.objectContaining({ rationale: call.input.rationale }),
      ]);
    });
  }

  it("removing a level is remove_trigger_ids: the same call naming the three by id takes them off", async () => {
    const r = await save({ ...fx.calls[1].input, remove_trigger_ids: [BUY, FLOOR, TARGET] });
    expect(r.refused).toBe(false);
    expect(removals(r).map((o) => o.id).sort()).toEqual([BUY, FLOOR, TARGET].sort());
    expect(r.db.store.thesis[0]).toMatchObject({ entryPrice: null, targetPrice: null, stopLoss: null });
  });
});

describe("every door reads an empty level the same way", () => {
  it("no door offers a level field: a level is a trigger, edited by id", async () => {
    for (const runMode of ["INTRADAY_TACTICAL", "MORNING_PLAN", "THESIS_WRITER", "PRINCIPAL_CHAT"]) {
      const fields = Object.keys((await door(runMode) as unknown as { shape: Record<string, unknown> }).shape);
      for (const f of ["entry_price", "target_price", "stop_loss", "stop_basis", "target_basis", "entry_on_close"]) expect([runMode, f, fields.includes(f)]).toEqual([runMode, f, false]);
    }
  });
  for (const runMode of ["MORNING_PLAN", "THESIS_WRITER", "PRINCIPAL_CHAT"]) {
    it(`${runMode}: the second call's empty buy, floor and target change nothing`, async () => {
      const r = await save(fx.calls[1].input, runMode);
      expect(r.crashed).toBe(false);
      expect(removals(r)).toEqual([]);
      expect(ids(r.db.store.thesis[0])).toEqual(expect.arrayContaining([BUY, FLOOR, TARGET]));
      expect(r.db.store.thesis[0]).toMatchObject(LEVELS);
    });
  }
});
