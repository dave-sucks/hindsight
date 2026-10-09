/**
 * update-thesis-patch.replay.test.ts — a save is a patch.
 *
 * Production: the trigger runs on ASML (2026-10-07, run cmuyg113b000204l7q20mad6b)
 * and NVDA (2026-10-08, run cmuzks3fj000306jphr8lw2u1) answered a fired floor
 * by sending the thesis back: direction, horizon, entry, target and stop as
 * the THESIS block printed them, plus change_status WATCHING. Each echoed
 * value ran a gate written for a change, one refused field refused the whole
 * call, and each run sent the same call eleven times, ran out of steps and
 * failed with no close-out row. #806 dropped the echoed direction; the next
 * gate the same calls reach is change_status WATCHING on a holding, so the
 * real calls were still refused whole.
 *
 * Now: what equals the stored row is dropped before any rule reads it; what
 * can't be applied is refused by itself, by name, and the rest lands.
 */
import fixture from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, type Row } from "@/lib/replay";

type Refused = Array<{ field: string; reason: string }>;
const data = (r: { result: { data?: Record<string, unknown> } }) => r.result.data ?? {};
const refusedOf = (r: { result: { data?: Record<string, unknown> } }) => (data(r).refused_fields as Refused | undefined) ?? [];
const opsOf = (r: { result: { data?: Record<string, unknown> } }) => (data(r).trigger_ops as Array<{ op: string; ok: boolean; reason?: string }> | undefined) ?? [];
/** The rows the save wrote, leaving out the fire that woke the run. */
const written = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");

// ── The synthetic ASML shape (the #806 seed) ────────────────────────────
const FLOOR_ID = "floor-asml";
const PRICE = 1800;
const asml = (over: Row = {}) =>
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
    ...over,
  });
const seed = (thesis: Row = asml()) => ({
  thesis: [thesis],
  position: [positionRow({ id: "pos_asml", symbol: "ASML", avgCost: 1716.09, quantity: 6, stopLoss: 1835, targetPrice: 2400 })],
  thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: thesis.id, type: "TRIGGER_FIRED", triggerId: FLOOR_ID, runId: null, timestamp: new Date(Date.now() - 3_600_000) })],
});
const NOTE = "The floor at $1,835 fired and the sale is proposed for approval. The belief survives; this is the floor doing its job.";
const closeOut = (over: Record<string, unknown> = {}) => ({
  thesis_id: "t_asml",
  trigger_id: FLOOR_ID,
  price_at_time: PRICE,
  entry_price: 1716.09,
  direction: "LONG",
  horizon: "COMPOUNDER",
  rationale: NOTE,
  ...over,
});
const tactical = { runMode: "INTRADAY_TACTICAL" };
const replay = (args: Record<string, unknown>, opts: { thesis?: Row; ctx?: Record<string, unknown>; quotes?: Record<string, number> } = {}) =>
  replayTool("update-thesis", "updateThesis", { seed: seed(opts.thesis), args, ctx: opts.ctx ?? tactical, quotes: opts.quotes ?? { ASML: PRICE } });

describe("unchanged is a no-op", () => {
  it("ASML: entry, direction and horizon restated on the held LONG COMPOUNDER — the note lands, nothing else is recorded", async () => {
    const r = await replay(closeOut());
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    const rows = written(r.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "REVIEWED", rationale: NOTE, fieldChanges: {} });
    expect(opsOf(r)).toEqual([]);
    expect(refusedOf(r)).toEqual([]);
    expect(r.db.store.thesis[0]).toMatchObject({ direction: "LONG", horizon: "COMPOUNDER", entryPrice: 1716.09, stopLoss: 1835 });
  });

  it("every field of a held stock restated writes a REVIEWED row with empty fieldChanges", async () => {
    const t = asml({
      setupId: "BASE_BREAKOUT",
      conviction: "HIGH",
      convictionRationale: "A clear edge.",
      variantView: "Consensus expects a flat year; I think High-NA lifts margins.",
      scoring: { composite: 7, trendStrength: { score: 3, note: "Clean uptrend." }, relativeStrength: { score: 2, note: "Ahead of SPY." }, entryQuality: { score: 1, note: "Basing." }, catalystFreshness: { score: 1, note: "Q3 ahead." } },
    });
    const r = await replay(
      {
        ...closeOut(),
        core_belief: t.coreBelief,
        key_assumptions: t.keyAssumptions,
        invalidation_conditions: t.invalidationConds,
        scoring: { trendStrength: { score: 3, note: "Clean uptrend." }, relativeStrength: { score: 2, note: "Ahead of SPY." }, entryQuality: { score: 1, note: "Basing." }, catalystFreshness: { score: 1, note: "Q3 ahead." } },
        conviction: "HIGH",
        conviction_rationale: "A clear edge.",
        variant_view: t.variantView,
        setup_id: "BASE_BREAKOUT",
        target_price: 2400,
        stop_loss: 1835,
        stop_basis: "The floor.",
        catalyst_date: null,
      },
      { thesis: t, ctx: { runMode: "MORNING_PLAN" } },
    );
    expect(r.refused).toBe(false);
    expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED", fieldChanges: {} })]);
    expect(opsOf(r)).toEqual([]);
    expect(refusedOf(r)).toEqual([]);
  });

  it("an edit that asks for what the trigger already says is dropped, not refused", async () => {
    const r = await replay(closeOut({ edit_triggers: [{ id: FLOOR_ID, level: 1835 }] }));
    expect(opsOf(r)).toEqual([]);
    expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED" })]);
  });
});

describe("refuse the field, land the call", () => {
  it("LONG → SHORT on a holding: the note lands, the direction is refused by name and unchanged", async () => {
    const r = await replay(closeOut({ direction: "SHORT" }));
    expect(r.refused).toBe(false);
    expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED", rationale: NOTE })]);
    expect(refusedOf(r)).toEqual([{ field: "direction", reason: "A flip is a new thesis; say so in your note." }]);
    expect(r.db.store.thesis[0].direction).toBe("LONG");
  });

  it("names record_thesis only where the door has it", async () => {
    const chat = await replay(closeOut({ direction: "SHORT", trigger_id: undefined }), { ctx: { runMode: "PRINCIPAL_CHAT" } });
    expect(refusedOf(chat)[0].reason).toContain("record_thesis");
    for (const runMode of ["INTRADAY_TACTICAL", "MORNING_PLAN"]) {
      const r = await replay(closeOut({ direction: "PASS" }), { ctx: { runMode } });
      expect(refusedOf(r)[0]).toEqual({ field: "direction", reason: "A stock we hold isn't passed: selling it is close_position." });
    }
    const watch = await replay(closeOut({ direction: "PASS", entry_price: undefined }), { thesis: asml({ status: "WATCHING" }), ctx: { runMode: "MORNING_PLAN" } });
    expect(refusedOf(watch)[0].reason).toMatch(/change_status ARCHIVED/);
    expect(refusedOf(watch)[0].reason).not.toContain("record_thesis");
  });

  it("a kill on a holding with no sale this run: change_status is refused with close_position, the note lands", async () => {
    const r = await replay(closeOut({ change_status: "INVALIDATED" }));
    expect(r.refused).toBe(false);
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "change_status", reason: expect.stringContaining("close_position") })]);
    expect(r.db.store.thesis[0].status).toBe("HOLDING");
    expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED", rationale: NOTE })]);
  });

  it("no live price, entry_price riding along on a holding: the note lands", async () => {
    for (const entry_price of [1716.09, 1750]) {
      const r = await replay(closeOut({ price_at_time: undefined, entry_price }), { quotes: {} });
      expect(r.refused).toBe(false);
      expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED", rationale: NOTE })]);
      expect(r.db.store.thesis[0].entryPrice).toBe(1716.09);
    }
  });

  it.each([
    ["MORNING_PLAN", "Leave the buy as it is; the next run can move it."],
    // The chat's save has no price field since step 12, part 2: its words never name one.
    ["PRINCIPAL_CHAT", "Leave the buy as it is and send it again once get_stock_data has a live price."],
  ])("no live price on a watch (%s): the buy level is refused by name in that door's words, the note lands", async (runMode, words) => {
    const watch = asml({ status: "WATCHING", triggers: [] });
    const r = await replay(closeOut({ price_at_time: undefined, entry_price: 1700, trigger_id: undefined }), { thesis: watch, quotes: {}, ctx: { runMode } });
    expect(r.refused).toBe(false);
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "entry_price", reason: expect.stringContaining(words) })]);
    expect(refusedOf(r)[0].reason).not.toContain("price_at_time");
    expect(written(r.db)).toHaveLength(1);
  });

  it("a target raised past the price on a watch is refused alone; the floor raised in the same call lands", async () => {
    const watch = thesisRow({
      id: "t_watch", ticker: "AAA", status: "WATCHING", direction: "LONG", entryPrice: 100, targetPrice: 130, stopLoss: 90,
      triggers: [
        { id: "buy", action: "ENTER", source: "AGENT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "Buy the pullback to $100." },
        { id: "tgt", action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "above", value: 130 }, rationale: "Target $130." },
        { id: "flr", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 90 }, rationale: "Floor $90." },
      ],
    });
    const r = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [watch] },
      args: { thesis_id: "t_watch", rationale: "Raising the target and the floor after the run-up.", target_price: 150, stop_loss: 95, stop_basis: "Under the new base at $95." },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { AAA: 135 },
    });
    expect(r.refused).toBe(false);
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "target_price", reason: expect.stringContaining("PROMOTE") })]);
    expect(r.db.store.thesis[0]).toMatchObject({ targetPrice: 130, stopLoss: 95 });
  });

  it("a promoted stock given only a note writes the REVIEWED row and says it is still promoted", async () => {
    const promoted = asml({ status: "PROMOTED" });
    const r = await replay({ thesis_id: "t_asml", rationale: "Still deciding on the live re-entry; the research holds." }, { thesis: promoted, ctx: { runMode: "MORNING_PLAN" } });
    expect(r.refused).toBe(false);
    expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED" })]);
    expect(String(r.result.summary)).toContain("Still promoted until place_trade or change_status WATCHING.");
    expect(r.db.store.thesis[0].status).toBe("PROMOTED");
  });
});

describe("a call where nothing can land is still refused whole", () => {
  it("a seed's commitment missing stop_loss: refused, nothing written", async () => {
    const s = thesisRow({ id: "t_seed", ticker: "AAA", status: "WATCHING", direction: null, entryPrice: null, targetPrice: null, stopLoss: null, triggers: [] });
    const r = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [s] },
      args: {
        thesis_id: "t_seed", rationale: "Committing to a long after the first read.", direction: "LONG", horizon: "TARGET",
        entry_price: 100, target_price: 130, core_belief: "It drifts up.", key_assumptions: ["a", "b"], invalidation_conditions: ["c", "d"],
        conviction: "MEDIUM", conviction_rationale: "Probably works.",
      },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { AAA: 101 },
    });
    expect(r.refused).toBe(true);
    expect(r.refusal?.error).toBe("pending_promotion_missing_fields");
    expect(r.db.store.thesisUpdate ?? []).toHaveLength(0);
    expect(r.db.store.thesis[0].direction).toBeNull();
  });
});

describe("the two production close-outs, replayed end to end", () => {
  for (const ticker of ["ASML", "NVDA"] as const) {
    const fx = fixture[ticker];
    it(`${ticker}: the run's first close-out call lands with its note; WATCHING is refused by name`, async () => {
      const thesis = thesisRow({ ...(fx.thesis as Row), status: "HOLDING" });
      const r = await replayTool("update-thesis", "updateThesis", {
        seed: {
          thesis: [thesis],
          position: [positionRow({ id: `pos_${ticker}`, symbol: ticker, ...fx.position })],
          thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: thesis.id, type: "TRIGGER_FIRED", triggerId: fx.call.trigger_id, runId: null, timestamp: new Date(Date.now() - 60_000) })],
        },
        args: fx.call as unknown as Record<string, unknown>,
        ctx: tactical,
        quotes: { [ticker]: fx.price },
      });
      expect(r.crashed).toBe(false);
      expect(r.refused).toBe(false);
      const rows = written(r.db);
      expect(rows).toHaveLength(1);
      expect(rows[0].rationale).toBe(fx.call.rationale);
      expect(Object.keys((rows[0].fieldChanges ?? {}) as object)).not.toEqual(expect.arrayContaining(["direction", "status", "horizon", "entryPrice"]));
      expect(refusedOf(r).map((f) => f.field)).toEqual(["change_status"]);
      expect(r.db.store.thesis[0]).toMatchObject({ status: "HOLDING", direction: "LONG", entryPrice: fx.thesis.entryPrice });
    });
  }
});
