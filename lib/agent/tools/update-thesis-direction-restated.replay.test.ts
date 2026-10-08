/**
 * update-thesis-direction-restated.replay.test.ts — the direction a thesis
 * already has, sent again, is not a flip.
 *
 * Production: since the thesis fields were defined once (2026-10-07 14:08
 * ET), the direction field no longer said it is for a stock with none yet.
 * The trigger runs began restating `direction: "LONG"` on LONG holdings in
 * their close-out call, and update_thesis refused any direction on a
 * committed thesis, the same one included. ASML's EXIT run (2026-10-07 14:30
 * ET) and NVDA's (2026-10-08 09:31 ET) proposed the sale, were refused eleven
 * times each, ran out of steps and failed with no close-out row. IOT's EXIT
 * run that morning, before the change, completed.
 *
 * The call shape is ASML's: `entry_price`, `direction: "LONG"` and
 * `horizon: "COMPOUNDER"` restated on a held LONG COMPOUNDER, its protective
 * floor fired and open.
 */
import { replayTool, thesisRow, positionRow, thesisUpdateRow } from "@/lib/replay";

const FLOOR_ID = "floor-asml";
const PRICE = 1800;

const asml = () =>
  thesisRow({
    id: "t_asml",
    ticker: "ASML",
    status: "HOLDING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 1716.09,
    targetPrice: 2400,
    stopLoss: 1835,
    triggers: [{ id: FLOOR_ID, action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 1835 }, rationale: "The floor.", cooldownDays: 1 }],
  });

const seed = () => ({
  thesis: [asml()],
  position: [positionRow({ id: "pos_asml", symbol: "ASML", avgCost: 1716.09, quantity: 6 })],
  thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: "t_asml", type: "TRIGGER_FIRED", triggerId: FLOOR_ID, runId: null, timestamp: new Date(Date.now() - 3_600_000) })],
});

/** The close-out call, in ASML's shape: the sale was proposed; this answers the fire. */
const closeOut = (over: Record<string, unknown> = {}) => ({
  thesis_id: "t_asml",
  trigger_id: FLOOR_ID,
  price_at_time: PRICE,
  entry_price: 1716.09,
  direction: "LONG",
  horizon: "COMPOUNDER",
  rationale: "The floor at $1,835 fired and the sale is proposed for approval. The belief survives; this is the floor doing its job.",
  ...over,
});

const ops = (result: unknown) =>
  (result as { data?: { trigger_ops?: Array<{ op: string; ok: boolean; reason?: string }> } }).data?.trigger_ops ?? [];

describe("update_thesis: the direction a thesis already has, sent again", () => {
  it("ASML 10-07: LONG restated on a LONG holding is not a flip — the close-out row is written", async () => {
    const { result, refused, crashed, db } = await replayTool("update-thesis", "updateThesis", { seed: seed(), args: closeOut(), quotes: { ASML: PRICE } });
    expect(crashed).toBe(false);
    expect(refused).toBe(false);
    expect((db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED")).toHaveLength(1);
    expect(db.store.thesis[0].direction).toBe("LONG");
    // The buy level restated on a held stock is one refused op; the rest lands.
    expect(ops(result).find((o) => o.op === "edit" && !o.ok)?.reason ?? "").toMatch(/On a held stock the entry is the fill/);
  });

  it("a real flip, SHORT on a LONG holding, is still refused and writes nothing", async () => {
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", { seed: seed(), args: closeOut({ direction: "SHORT" }), quotes: { ASML: PRICE } });
    expect(refused).toBe(true);
    expect(JSON.stringify(refusal)).toMatch(/direction_change_only_from_pending/);
    expect((db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED")).toHaveLength(0);
  });

  it("PASS on a committed thesis is still refused", async () => {
    const { refused, refusal } = await replayTool("update-thesis", "updateThesis", { seed: seed(), args: closeOut({ direction: "PASS" }), quotes: { ASML: PRICE } });
    expect(refused).toBe(true);
    expect(JSON.stringify(refusal)).toMatch(/direction_change_only_from_pending/);
  });

  it("the field says so, in the same words in every tool that takes it, naming no tool", async () => {
    const { thesisFields } = await import("./thesis-fields");
    expect(thesisFields().direction.description).toContain("A thesis's direction is set once, when it has none; sending the one it has changes nothing.");
  });
});
