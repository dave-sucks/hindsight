/**
 * thesis-doors.replay.test.ts — the one-job thesis tools (2026-11-18) through
 * their real entry points, each reaching the save's own rules (`saveThesis`):
 * only the owner lowers a floor, a stock we hold is sold before it is dropped,
 * a promoted stock is deferred with watch_again, a sold stock comes back on
 * watch without its sale triggers. Constructed rows, the shapes the book holds.
 */
import { replayTool, thesisRow, positionRow, thesisUpdateRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import { isNotelessEdit } from "@/lib/agent/no-note";
import { openFires } from "@/lib/agent/stock-context";

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

describe("edit_triggers: the Portfolio Manager can't make a sale Auto (its trades wait for the owner)", () => {
  const pm = { runMode: "PORTFOLIO_MANAGER", analystId: REPLAY_ANALYST_ID };

  it("its schema has no fire mode on an added or an edited trigger", async () => {
    let js = { properties: {} } as { properties: Record<string, { items?: { properties?: Record<string, unknown> } }> };
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      const { zodSchema } = await import("ai");
      const { editTriggers } = await import("./edit-triggers");
      js = zodSchema((editTriggers({ runId: "r", userId: "u", accountId: "a", ...pm } as never) as unknown as { inputSchema: never }).inputSchema).jsonSchema as typeof js;
    });
    jest.dontMock("@/lib/prisma");
    expect(Object.keys(js.properties.add.items?.properties ?? {})).not.toContain("fireMode");
    expect(Object.keys(js.properties.edit.items?.properties ?? {})).not.toContain("fire_mode");
  });

  it("an Auto sale it sends anyway is saved with the sale's default, which asks an agent", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", {
      seed: { thesis: [held({ triggers: [] })], position: [position()] },
      ctx: pm,
      args: { thesis_id: "t_aaa", add: [{ action: "EXIT", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 99 }, rationale: "Sell under $99." }], edit: [] },
      quotes: { AAA: 98 },
    });
    const sale = (r.db.store.thesis[0].triggers as Array<{ action: string; fireMode?: string }>).find((t) => t.action === "EXIT");
    expect(sale).toBeDefined();
    expect(sale!.fireMode).not.toBe("DO_IT");
  });

  it("an edit that sets the floor to Auto is dropped the same way", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { thesis: [held()], position: [position()] }, ctx: pm, args: { thesis_id: "t_aaa", edit: [{ id: "floor", fire_mode: "DO_IT" }] }, quotes: { AAA: 98 } });
    expect((r.db.store.thesis[0].triggers as Array<{ id: string; fireMode?: string }>).find((t) => t.id === "floor")?.fireMode).not.toBe("DO_IT");
  });
});

describe("only a note answers a stock (a morning run)", () => {
  const LOOKED = new Date("2026-11-10T13:00:00Z");
  const fire = thesisUpdateRow({ id: "fire", thesisId: "t_aaa", type: "TRIGGER_FIRED", triggerId: "floor", runId: null, timestamp: new Date(Date.now() - 60_000), priceAtTime: 98 });
  const seedWithFire = () => ({ thesis: [held({ lastReviewedAt: LOOKED, conviction: "MEDIUM" })], position: [position()], thesisUpdate: [fire] });
  const morning = { runMode: "MORNING_PLAN", analystId: REPLAY_ANALYST_ID };

  it("a conviction saved with no note links no fire, leaves the review clock and answers nothing", async () => {
    const r = await replayTool("set-conviction", "setConviction", { seed: seedWithFire(), ctx: morning, args: { thesis_id: "t_aaa", conviction: "LOW", conviction_rationale: "Orders slowed." }, quotes: { AAA: 98 } });
    const line = lines(r.db).find((u) => u.id !== "fire")!;
    expect(line).toMatchObject({ triggerId: null, rationale: null });
    expect(isNotelessEdit(line.fieldChanges)).toBe(true);
    expect(r.db.store.thesis[0].lastReviewedAt).toEqual(LOOKED);
    expect(openFires(lines(r.db) as never).map((f) => f.triggerId)).toEqual(["floor"]);
  });

  it("the note after it answers the fire and moves the clock", async () => {
    const first = await replayTool("set-conviction", "setConviction", { seed: seedWithFire(), ctx: morning, args: { thesis_id: "t_aaa", conviction: "LOW", conviction_rationale: "Orders slowed." }, quotes: { AAA: 98 } });
    const r = await replayTool("write-note", "writeNoteTool", { seed: first.db.store as never, ctx: morning, args: { thesis_id: "t_aaa", note: "Orders slowed two quarters running; the floor stands and I'd sell under it.", verdict: "WEAKER", verdict_line: "Orders fell for a second quarter." }, quotes: { AAA: 98 } });
    const note = lines(r.db).find((u) => u.rationale)!;
    expect(note.triggerId).toBe("floor");
    expect((r.db.store.thesis[0].lastReviewedAt as Date).getTime()).toBeGreaterThan(LOOKED.getTime());
    expect(openFires(lines(r.db) as never)).toEqual([]);
  });

  it("a fully refused trigger edit writes no line and leaves the clock", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: seedWithFire(), ctx: morning, args: { thesis_id: "t_aaa", edit: [{ id: "floor", value: 85, rationale: "Room." }] }, quotes: { AAA: 98 } });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "floor", ok: false })]);
    expect(lines(r.db).map((u) => u.id)).toEqual(["fire"]);
    expect(r.db.store.thesis[0].lastReviewedAt).toEqual(LOOKED);
  });

  it("a trigger edit with nothing in it is refused, saying what to send, and answers no refusal of last time", async () => {
    const open = { id: "gr_1", tool: "edit_triggers", gateCode: "protective_level_locked", summary: "Refused", detail: null, ticker: "AAA", thesisId: "t_aaa", runId: "run_old", analystId: REPLAY_ANALYST_ID, runMode: "MORNING_PLAN", resolvedAt: null, resolvedBy: null, createdAt: new Date() };
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { ...seedWithFire(), gateRejection: [open] }, ctx: morning, args: { thesis_id: "t_aaa" }, quotes: { AAA: 98 } });
    expect(r.refused).toBe(true);
    expect(String(r.result.summary)).toMatch(/add, edit \(by id\) or remove/);
    expect((r.db.store.gateRejection as Row[]).find((g) => g.id === "gr_1")?.resolvedAt ?? null).toBeNull();
    expect(lines(r.db).map((u) => u.id)).toEqual(["fire"]);
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
