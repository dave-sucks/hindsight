/**
 * update-thesis-guards.replay.test.ts — the record tells the truth, the
 * principal's hand edit wins, and the plan check refuses linked changes together.
 *
 * Follows "a save is a patch" (update-thesis-patch.replay.test.ts): a field
 * the save could not apply is refused by name and the rest lands. Here:
 *   - what was refused is written on the audit row (`notApplied`), so the
 *     Activity feed shows it beside the note that landed;
 *   - a field or trigger the principal set by hand after the run began is
 *     not changed by the run, which read the stock before the edit;
 *   - when the trigger changes in a call leave an invalid plan, they are
 *     refused together: changes sent together carry one intent, and part of
 *     them is a plan nobody chose. The note lands.
 */
import fixture from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, REPLAY_RUN_ID, type Row } from "@/lib/replay";

type Refused = Array<{ field: string; reason: string }>;
const refusedOf = (r: { result: { data?: Record<string, unknown> } }) => (r.result.data?.refused_fields as Refused | undefined) ?? [];
const opsOf = (r: { result: { data?: Record<string, unknown> } }) => (r.result.data?.trigger_ops as Array<{ op: string; id: string; ok: boolean; reason?: string }> | undefined) ?? [];
const written = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED" && u.id !== "hand");
const notAppliedOf = (u: Row) => ((u.fieldChanges as { notApplied?: { to?: unknown[] } } | null)?.notApplied?.to ?? []) as Array<Record<string, unknown>>;

describe("the record tells the truth", () => {
  it("ASML's close-out: the note lands, and 'back to watching' is on the same audit row as not applied", async () => {
    const fx = fixture.ASML;
    const thesis = thesisRow({ ...(fx.thesis as Row) });
    const r = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesis], position: [positionRow({ symbol: "ASML", ...fx.position })] },
      args: fx.call as unknown as Record<string, unknown>,
      ctx: { runMode: "INTRADAY_TACTICAL" },
      quotes: { ASML: fx.price },
    });
    const [row] = written(r.db);
    expect(notAppliedOf(row)).toEqual([expect.objectContaining({ field: "change_status", to: "WATCHING", why: "the position is still open" })]);
    // The reply keeps its shape: field and reason only.
    expect(refusedOf(r)).toEqual([{ field: "change_status", reason: expect.any(String) }]);
    expect(r.result.data?.changed_fields).not.toContain("notApplied");
  });

  it("a call that lands whole writes no notApplied", async () => {
    const thesis = thesisRow({ id: "t1", ticker: "AAA", status: "WATCHING" });
    const r = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesis] },
      args: { thesis_id: "t1", rationale: "Belief sharpened after the call.", core_belief: "Margins expand through 2027." },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { AAA: 101 },
    });
    expect(notAppliedOf(written(r.db)[0])).toEqual([]);
  });
});

describe("the principal's hand edit wins", () => {
  const TGT = "tgt-asml";
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  // The principal raised the target to $2600 by hand; the run read $2400 before that.
  const thesis = () =>
    thesisRow({
      id: "t_asml", ticker: "ASML", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER",
      entryPrice: 1716.09, targetPrice: 2600, stopLoss: 1835,
      triggers: [
        { id: "floor-asml", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 1835 }, rationale: "The floor." },
        { id: TGT, action: "REVIEW", source: "PRINCIPAL", predicate: { watch: "price", is: "above", value: 2600 }, rationale: "Target $2600 — decide here." },
      ],
    });
  const handEdit = (at: Date) =>
    thesisUpdateRow({
      id: "hand", thesisId: "t_asml", type: "UPDATED", runId: null, timestamp: at, rationale: "Raised the target.",
      fieldChanges: { source: { from: null, to: "USER" }, triggerOps: { from: null, to: [{ op: "edit", id: TGT, text: "Target $2400 → $2600" }] }, targetPrice: { from: 2400, to: 2600 } },
    });
  const replay = (args: Record<string, unknown>, opts: { editedAt?: Date; runMode?: string } = {}) =>
    replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [thesis()],
        position: [positionRow({ symbol: "ASML", avgCost: 1716.09, quantity: 5 })],
        researchRun: [{ id: REPLAY_RUN_ID, startedAt: minutesAgo(30), createdAt: minutesAgo(30), status: "RUNNING" }],
        thesisUpdate: [handEdit(opts.editedAt ?? minutesAgo(10))],
      },
      args: { thesis_id: "t_asml", price_at_time: 1800, rationale: "The floor fired and the sale is proposed; the belief holds.", ...args },
      ctx: { runMode: opts.runMode ?? "INTRADAY_TACTICAL" },
      quotes: { ASML: 1800 },
    });

  it("the run's older target is refused by name; the note lands and the hand edit stands", async () => {
    const r = await replay({ target_price: 2400 });
    expect(r.refused).toBe(false);
    expect(refusedOf(r)).toEqual([{ field: "target_price", reason: expect.stringMatching(/^You set this by hand at \d{1,2}:\d{2} [AP]M ET; not changed\.$/) }]);
    expect(r.db.store.thesis[0].targetPrice).toBe(2600);
    expect(notAppliedOf(written(r.db)[0])).toEqual([expect.objectContaining({ field: "target_price", to: 2400, why: expect.stringMatching(/^you set it by hand at /) })]);
  });

  it("a trigger edit by id on the hand-edited trigger is refused by id", async () => {
    const r = await replay({ edit_triggers: [{ id: TGT, level: 2500, rationale: "Trim the target to the prior high." }] });
    expect(opsOf(r)).toEqual([expect.objectContaining({ op: "edit", id: TGT, ok: false, reason: expect.stringMatching(/^You set this by hand/) })]);
    expect(r.db.store.thesis[0].targetPrice).toBe(2600);
  });

  it("a hand edit made before the run began is not protected", async () => {
    const r = await replay({ target_price: 2400 }, { editedAt: minutesAgo(45) });
    expect(refusedOf(r)).toEqual([]);
    expect(r.db.store.thesis[0].targetPrice).toBe(2400);
  });

  it("the chat is the principal's own door and is not checked", async () => {
    const r = await replay({ target_price: 2400 }, { runMode: "PRINCIPAL_CHAT" });
    expect(refusedOf(r)).toEqual([]);
    expect(r.db.store.thesis[0].targetPrice).toBe(2400);
  });
});

describe("the plan check refuses a call's trigger changes together", () => {
  const watch = () =>
    thesisRow({
      id: "t_w", ticker: "AAA", status: "WATCHING", direction: "LONG", entryPrice: 100, targetPrice: 130, stopLoss: 90,
      triggers: [
        { id: "buy", action: "ENTER", source: "AGENT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "Buy the pullback to $100." },
        { id: "tgt", action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "above", value: 130 }, rationale: "Target $130." },
        { id: "flr", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 90 }, rationale: "Floor $90." },
      ],
    });
  const replay = (args: Record<string, unknown>) =>
    replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [watch()] },
      args: { thesis_id: "t_w", rationale: "Tightening the plan after the base formed.", price_at_time: 104, ...args },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { AAA: 104 },
    });
  const review = { predicate: { watch: "repeat", value: 14 }, action: "REVIEW", rationale: "Look at this every 14 days." };

  it("a stop above the buy and a review added with it: both refused, the plan unchanged, the note lands", async () => {
    const r = await replay({ stop_loss: 105, stop_basis: "Under the new shelf at $105.", add_triggers: [review] });
    expect(refusedOf(r)).toEqual([expect.objectContaining({ field: "triggers", reason: expect.stringContaining("To set the plan down") })]);
    expect(opsOf(r).every((o) => !o.ok)).toBe(true);
    expect(r.db.store.thesis[0].stopLoss).toBe(90);
    expect((r.db.store.thesis[0].triggers as Array<{ predicate: { watch: string } }>).some((t) => t.predicate.watch === "repeat")).toBe(false);
    expect(written(r.db)).toEqual([expect.objectContaining({ type: "REVIEWED", rationale: "Tightening the plan after the base formed." })]);
  });
});
