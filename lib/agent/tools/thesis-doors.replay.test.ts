/**
 * thesis-doors.replay.test.ts — the one-job thesis tools (2026-11-18) through
 * their real entry points, each reaching the save's own rules (`saveThesis`):
 * only the owner lowers a floor, a stock we hold is sold before it is dropped,
 * a promoted stock is deferred with watch_again, a sold stock comes back on
 * watch without its sale triggers. Constructed rows, the shapes the book holds.
 */
import { replayTool, thesisRow, positionRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";

const FLOOR = { id: "floor", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 90 }, rationale: "Under the $90 base." };
const BUY = { id: "buy", action: "ENTER", source: "AGENT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "The pullback to $100." };
const held = (over: Row = {}) => thesisRow({ id: "t_aaa", ticker: "AAA", status: "HOLDING", direction: "LONG", analystId: REPLAY_ANALYST_ID, triggers: [FLOOR], ...over });
const watched = (over: Row = {}) => thesisRow({ id: "t_aaa", ticker: "AAA", status: "WATCHING", direction: "LONG", analystId: REPLAY_ANALYST_ID, triggers: [BUY], ...over });
const position = () => positionRow({ symbol: "AAA", analystId: REPLAY_ANALYST_ID, quantity: 10, avgCost: 100, status: "OPEN" });
const floorOf = (db: { store: Record<string, Row[]> }) => (db.store.thesis[0].triggers as Array<{ id: string; predicate: { value: number } }>).find((t) => t.id === "floor")?.predicate.value;
const refusedOf = (r: { result: { data?: unknown } }) => ((r.result.data as { refused_fields?: Array<{ field: string; reason: string }> }).refused_fields ?? []);
const lines = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []) as Row[];

describe("edit_triggers: the Portfolio Manager says \"buy it if X happens\", and never lowers a floor", () => {
  const pm = { runMode: "PORTFOLIO_MANAGER", analystId: REPLAY_ANALYST_ID };

  it("lowering a held stock's floor is refused by id; the floor stays at $90", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { thesis: [held()], position: [position()] }, ctx: pm, args: { thesis_id: "t_aaa", edit: [{ id: "floor", value: 85, rationale: "Give it room." }] }, quotes: { AAA: 98 } });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "floor", ok: false })]);
    expect(floorOf(r.db)).toBe(90);
  });

  it("raising it lands", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { thesis: [held()], position: [position()] }, ctx: pm, args: { thesis_id: "t_aaa", edit: [{ id: "floor", value: 95, rationale: "Under the new $95 shelf." }] }, quotes: { AAA: 104 } });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "floor", ok: true })]);
    expect(floorOf(r.db)).toBe(95);
  });

  it("a buy on a stock it only watches lands, and its edit is not the analyst's review (the clock keeps counting)", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", {
      seed: { thesis: [watched({ triggers: [], lastReviewedAt: new Date("2026-11-01T12:00:00Z") })] },
      ctx: pm,
      args: { thesis_id: "t_aaa", add: [{ action: "ENTER", predicate: { watch: "price", is: "above", value: 110 }, rationale: "Buy it on the break of $110." }] },
      quotes: { AAA: 104 },
    });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ op: "add", ok: true })]);
    expect(r.db.store.thesis[0].lastReviewedAt).toEqual(new Date("2026-11-01T12:00:00Z"));
    // An edit's line is a title: the paragraph is the note's.
    expect(lines(r.db).map((u) => u.rationale ?? null)).toEqual([null]);
  });
});

describe("edit_triggers: each op carries its reason", () => {
  it("a removal's reason is kept on its Activity record, beside the line it writes", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { thesis: [watched()] }, args: { thesis_id: "t_aaa", remove: [{ id: "buy", reason: "The base broke; no buy worth holding." }] }, quotes: { AAA: 104 } });
    expect((r.db.store.thesis[0].triggers as unknown[]).length).toBe(0);
    const ops = ((lines(r.db)[0].fieldChanges as { triggerOps?: { to: unknown[] } }).triggerOps?.to ?? []) as Array<Record<string, unknown>>;
    expect(ops).toEqual([expect.objectContaining({ op: "remove", id: "buy", reason: "The base broke; no buy worth holding." })]);
  });
});

describe("stop_watching", () => {
  it("a watched stock is retired as dropped, its reason the last line", async () => {
    const reason = "The trial readout slipped a year; nothing here to watch for now.";
    const r = await replayTool("stop-watching", "stopWatching", { seed: { thesis: [watched()] }, args: { thesis_id: "t_aaa", reason }, quotes: { AAA: 104 } });
    expect(r.db.store.thesis[0]).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED", closeReason: reason });
    expect(lines(r.db)).toEqual([expect.objectContaining({ type: "STATUS_CHANGED", rationale: reason })]);
  });

  it("a stock we hold is refused, named as the call made and pointing at sell; it stays held", async () => {
    const r = await replayTool("stop-watching", "stopWatching", { seed: { thesis: [held()], position: [position()] }, ctx: { analystId: REPLAY_ANALYST_ID }, args: { thesis_id: "t_aaa", reason: "Done with it, the story is over." }, quotes: { AAA: 98 } });
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "stop_watching", reason: expect.stringContaining("Call `sell` first") })]);
    expect(r.db.store.thesis[0].status).toBe("HOLDING");
  });

  it("a promoted stock is refused, pointing at watch_again", async () => {
    const r = await replayTool("stop-watching", "stopWatching", { seed: { thesis: [watched({ status: "PROMOTED" })] }, args: { thesis_id: "t_aaa", reason: "Not re-entering this one live." }, quotes: { AAA: 104 } });
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "stop_watching", reason: expect.stringContaining("watch_again") })]);
    expect(r.db.store.thesis[0].status).toBe("PROMOTED");
  });
});

describe("watch_again", () => {
  it("a sold stock is back on watch, its sale trigger off with a line", async () => {
    const r = await replayTool("watch-again", "watchAgain", { seed: { thesis: [held({ status: "RETIRED", retiredReason: "SOLD" })] }, args: { thesis_id: "t_aaa" }, quotes: { AAA: 96 } });
    expect(r.db.store.thesis[0]).toMatchObject({ status: "WATCHING", retiredReason: null });
    expect((r.db.store.thesis[0].triggers as unknown[]).length).toBe(0);
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ op: "remove", id: "floor", ok: true })]);
  });

  it("a stock we hold is refused, named as the call made", async () => {
    const r = await replayTool("watch-again", "watchAgain", { seed: { thesis: [held()], position: [position()] }, args: { thesis_id: "t_aaa" }, quotes: { AAA: 98 } });
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "watch_again" })]);
    expect(r.db.store.thesis[0].status).toBe("HOLDING");
  });
});

describe("set_conviction and set_catalyst_date", () => {
  it("a tier with its reason lands; a tier without one is refused by name", async () => {
    const r = await replayTool("set-conviction", "setConviction", { seed: { thesis: [held({ conviction: "MEDIUM" })], position: [position()] }, args: { thesis_id: "t_aaa", conviction: "LOW", conviction_rationale: "Orders slowed two quarters running." }, quotes: { AAA: 98 } });
    expect(r.db.store.thesis[0]).toMatchObject({ conviction: "LOW", convictionRationale: "Orders slowed two quarters running." });
    const bare = await replayTool("set-conviction", "setConviction", { seed: { thesis: [held({ conviction: "MEDIUM" })], position: [position()] }, args: { thesis_id: "t_aaa", conviction: "LOW" }, quotes: { AAA: 98 } });
    expect(refusedOf(bare)).toEqual([expect.objectContaining({ field: "conviction" })]);
    expect(bare.db.store.thesis[0].conviction).toBe("MEDIUM");
  });

  it("the catalyst date lands", async () => {
    const r = await replayTool("set-catalyst-date", "setCatalystDate", { seed: { thesis: [watched({ horizon: "CATALYST" })] }, args: { thesis_id: "t_aaa", catalyst_date: "2026-12-03T00:00:00.000Z" }, quotes: { AAA: 104 } });
    expect(r.db.store.thesis[0].catalystDate).toEqual(new Date("2026-12-03T00:00:00.000Z"));
  });
});
