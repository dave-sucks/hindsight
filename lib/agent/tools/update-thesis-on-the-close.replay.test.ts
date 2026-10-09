/**
 * update-thesis-on-the-close.replay.test.ts — a trigger edit can say when a
 * price level fires: `close: true` on the 16:20 close pass, false intraday.
 *
 * DOCU 2026-09-28: the pullback buy at $67 fired at 09:30 ET and the
 * trigger run passed, because the setup confirms on a close it could not
 * see yet. Its save had no way to move the buy to the close: an add of an
 * on-close buy onto the buy already there became an edit that answered
 * "ok" and dropped the setting. Each case here is the run's own call
 * (lib/agent/__fixtures__/pre-close-buy-docu-2026-09-28.json), as the SDK
 * hands it to the trigger run's save, with the one change named.
 */
import fixture from "@/lib/agent/__fixtures__/pre-close-buy-docu-2026-09-28.json";
import { replayTool, thesisRow, thesisUpdateRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const BUY = fixture.fire.triggerId;
const tactical = { runMode: "INTRADAY_TACTICAL" };
type Trig = { id: string; predicate: { watch: string; is?: string; value?: number; settings?: { close?: boolean } } };
type Op = { op: string; id: string; ok: boolean; text: string; reason?: string; unchanged?: true };

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

/** The 09-28 call with `change` added, parsed by the door's schema the way the SDK hands it to the save. */
async function save(change: Record<string, unknown>, triggers: Row[] = fixture.thesis.triggers as Row[]): Promise<Replay> {
  const args = (await triggerRunSchema()).parse({ ...fixture.call, ...change }) as Record<string, unknown>;
  return replayTool("update-thesis", "updateThesis", {
    seed: {
      thesis: [thesisRow({ ...fixture.thesis, triggers })],
      thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: fixture.thesis.id, type: "TRIGGER_FIRED", triggerId: BUY, runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: fixture.fire.price })],
    },
    args,
    ctx: tactical,
    quotes: { DOCU: fixture.fire.price },
  });
}
const stored = (r: Replay, id: string) => (r.db.store.thesis[0].triggers as Trig[]).find((t) => t.id === id)!;
const opsOf = (r: Replay) => (r.result.data?.trigger_ops ?? []) as Op[];
const landed = (r: Replay) => {
  expect(r.crashed).toBe(false);
  expect(r.refused).toBe(false);
  expect(r.result.data?.refused_fields).toBeUndefined();
};

describe("DOCU 09-28: the trigger run's call, and the buy moved to the close", () => {
  it("the call as sent lands with its note, and the buy stays intraday", async () => {
    const r = await save({});
    landed(r);
    expect(stored(r, BUY).predicate).toEqual({ watch: "price", is: "below", value: 67 });
  });

  it("edit_triggers close: true on the buy: the stored level fires on the close and the reply line says so", async () => {
    const r = await save({ edit_triggers: [{ id: BUY, close: true }] });
    landed(r);
    expect(stored(r, BUY).predicate).toEqual({ watch: "price", is: "below", value: 67, settings: { close: true } });
    expect(opsOf(r)).toEqual([expect.objectContaining({ id: BUY, ok: true, text: expect.stringContaining("fires on the close") })]);
  });

  it("an on-close buy added onto the stock's buy: the buy it lands on is kept and carries the close", async () => {
    const r = await save({ add_triggers: [{ action: "ENTER", predicate: { watch: "price", is: "above", value: 67, settings: { close: true } }, rationale: "Buy a close back above $67: the reversal the pullback setup confirms on." }] });
    landed(r);
    const buys = (r.db.store.thesis[0].triggers as Array<Trig & { action: string }>).filter((t) => t.action === "ENTER");
    expect(buys.map((t) => t.id)).toEqual([BUY]);
    expect(buys[0].predicate.settings).toEqual({ close: true });
    expect(opsOf(r)).toEqual([expect.objectContaining({ id: BUY, ok: true, text: expect.stringContaining("fires on the close") })]);
  });

  it("edit_triggers close: false on an on-close buy: the setting comes off and the reply line says it fires intraday", async () => {
    const onClose = (fixture.thesis.triggers as Trig[]).map((t) => (t.id === BUY ? { ...t, predicate: { ...t.predicate, settings: { close: true } } } : t));
    const r = await save({ edit_triggers: [{ id: BUY, close: false }] }, onClose as Row[]);
    landed(r);
    expect(stored(r, BUY).predicate).toEqual({ watch: "price", is: "below", value: 67 });
    expect(opsOf(r)).toEqual([expect.objectContaining({ id: BUY, ok: true, text: expect.stringContaining("fires intraday") })]);
  });

  it("close on a trigger that isn't a price level: the trigger is left as it was, the reply says so, and the call lands", async () => {
    const REVIEW = "05da8147-8aa7-415e-92dc-0dff5f8b228f";
    const r = await save({ edit_triggers: [{ id: REVIEW, close: true }] });
    landed(r);
    expect(stored(r, REVIEW).predicate).toEqual({ watch: "surprise", is: "beat", value: 0 });
    expect(opsOf(r)).toEqual([expect.objectContaining({ id: REVIEW, reason: expect.stringContaining("on the close is for a price level") })]);
    expect((r.db.store.thesisUpdate as Row[]).filter((u) => u.type !== "TRIGGER_FIRED")).toEqual([expect.objectContaining({ rationale: fixture.call.rationale })]);
  });
});
