/**
 * update-thesis-morning-run.replay.test.ts — the morning run's save, end to
 * end: four real morning calls, each as the one-job calls the morning run
 * makes now (asTheNewTools, 2026-11-18) sent through the SDK's loop to the
 * real tools, each on its row as it stood when the call was made
 * (lib/agent/__fixtures__/morning-save-2026-10.json), and the price a trigger
 * edit reads for itself.
 */
import fixture from "@/lib/agent/__fixtures__/morning-save-2026-10.json";
import { oldLevelFieldsAsTriggerOps, replayTool, sendAsTheRunWould, thesisRow, positionRow, type Row, triggerSentences } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

const morning = { runMode: "MORNING_PLAN" };
const written = (db: { store: Record<string, Row[]> }) => (db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");

type Ticker = "MU" | "ABT" | "DOCU" | "CORT";
type Entry = { call: Record<string, unknown>; price: number; position: { quantity: number; avgCost: number; peakPrice: number | null } | null; thesis: Row };
const entry = (t: Ticker) => fixture[t] as unknown as Entry;
const seedFor = (t: Ticker) => {
  const fx = entry(t);
  return { thesis: [thesisRow({ ...fx.thesis })], position: fx.position ? [positionRow({ symbol: t, ...fx.position })] : [] };
};

/** The recorded call with its level fields as the edits of their triggers (the fields went 2026-11-16). */
const callNow = (t: Ticker) => {
  const fx = entry(t);
  return oldLevelFieldsAsTriggerOps(fx.call, (fx.thesis.triggers ?? []) as unknown as Trigger[], String(fx.thesis.direction ?? "LONG"), { held: fx.thesis.status === "HOLDING" });
};

/** The call as the morning run makes it now, through the SDK's loop to the real tools (sendAsTheRunWould). */
const sentVerbatim = (t: Ticker) => sendAsTheRunWould(callNow(t), { seed: seedFor(t), ctx: morning, quotes: { [t]: entry(t).price } });

const SAVE_LACKS = ["price_at_time", "snapshot", "scoring", "variant_view"];

describe("four real morning calls, sent verbatim through the SDK's loop to the morning run's save", () => {
  it("MU 10-02, held: sent price_at_time and the snapshot; the stop moves $1,041 → $1,048 with its reason, the writer's snapshot stays", async () => {
    const { received, save } = await sentVerbatim("MU");
    for (const f of ["price_at_time", "snapshot"]) expect([f, f in entry("MU").call, f in received]).toEqual([f, true, false]);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    expect(save.result.data?.refused_fields).toBeUndefined();
    const row = save.db.store.thesis[0];
    expect(row.snapshot).toEqual(entry("MU").thesis.snapshot);
    expect((row.triggers as Array<{ id: string; predicate: { value: number } }>).find((x) => x.id === "t4")?.predicate.value).toBe(1048);
    expect(written(save.db).filter((u) => u.rationale).map((u) => u.rationale)).toEqual([entry("MU").call.rationale]);
  });

  it("ABT 10-07, watched: sent price_at_time and the snapshot; the plan's three levels land from none, the principal's review it named is removed, the snapshot stays", async () => {
    const { received, save } = await sentVerbatim("ABT");
    for (const f of ["price_at_time", "snapshot"]) expect([f, f in entry("ABT").call, f in received]).toEqual([f, true, false]);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    expect(save.result.data?.refused_fields).toBeUndefined();
    const row = save.db.store.thesis[0];
    for (const price of ["$100.60", "$135", "$95.48"]) expect(triggerSentences(row).join(" | ")).toContain(price);
    expect(row.snapshot).toEqual(entry("ABT").thesis.snapshot);
    expect((row.triggers as Array<{ id: string }>).map((x) => x.id)).not.toContain("4503a4f5-f854-41df-aed3-3913027d5650");
    expect(save.result.data?.trigger_ops).toEqual(expect.arrayContaining([expect.objectContaining({ id: "4503a4f5-f854-41df-aed3-3913027d5650", ok: true })]));
  });

  it("DOCU 10-07, sold the day before: back on watch lands (watch_again), and so does its 1.71:1 plan (the ratio is not a rule, 2026-11-04)", async () => {
    const { received, calls, save } = await sentVerbatim("DOCU");
    expect(calls[0]).toBe("watch_again");
    expect(received).not.toHaveProperty("price_at_time");
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row).toMatchObject({ status: "WATCHING", retiredReason: null });
    for (const price of ["$74.10", "$83", "$68.90"]) expect(triggerSentences(row).join(" | ")).toContain(price);
    expect(((save.result.data?.refused_fields as Array<{ field: string }>) ?? []).some((f) => f.field === "triggers")).toBe(false);
    expect(JSON.stringify(save.result)).not.toMatch(/\d\.\d\d:1|2:1 minimum/);
  });

  it("CORT 10-09, held: the snapshot, the scores and the variant view it rewrote never reach the save; the note and the conviction's reason land", async () => {
    const { received, save } = await sentVerbatim("CORT");
    for (const f of SAVE_LACKS) expect([f, f in entry("CORT").call, f in received]).toEqual([f, true, false]);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    expect(save.result.data?.refused_fields).toBeUndefined();
    expect(save.result.data?.changed_fields).toEqual(["convictionRationale"]);
    const row = save.db.store.thesis[0];
    const before = entry("CORT").thesis;
    expect({ snapshot: row.snapshot, scoring: row.scoring, variantView: row.variantView }).toEqual({ snapshot: before.snapshot, scoring: before.scoring, variantView: before.variantView });
    expect(row.convictionRationale).toBe(entry("CORT").call.conviction_rationale);
    expect(written(save.db).filter((u) => u.rationale).map((u) => u.rationale)).toEqual([entry("CORT").call.rationale]);
  });
});

// A seed's view is the Writer's alone since 2026-11-18 (no agent sends a direction): its save, run in code.
describe("a seed's first research at HIGH through the Writer's save", () => {
  it("is stored as MEDIUM with the reason", async () => {
    const seed = thesisRow({ id: "t_seed", ticker: "AAA", status: "WATCHING", direction: null, triggers: [] });
    const r = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [seed] },
      args: {
        thesis_id: "t_seed",
        rationale: "First research: the pullback to the 50-day is the entry, the prior high the target.",
        direction: "LONG",
        horizon: "TARGET",
        add_triggers: [
          { predicate: { watch: "price", is: "below", value: 95 }, action: "ENTER", rationale: "The buy at $95." },
          { predicate: { watch: "price", is: "below", value: 88, settings: { close: true } }, action: "STOP_WATCHING", rationale: "Below $88 the setup is wrong." },
          { predicate: { watch: "price", is: "above", value: 130 }, action: "REVIEW", rationale: "At $130, take profit or let it run." },
        ],
        core_belief: "Orders re-accelerate into the second half and the stock re-rates to the prior high.",
        key_assumptions: ["Orders grow again next quarter.", "Margins hold above 20%."],
        invalidation_conditions: ["Orders fall again next quarter.", "A close under $88."],
        conviction: "HIGH",
        conviction_rationale: "The order data turned before the price did.",
      },
      ctx: { runMode: "THESIS_WRITER" },
      quotes: { AAA: 100 },
    });
    expect(r.refused).toBe(false);
    const row = r.db.store.thesis[0];
    expect(row).toMatchObject({ direction: "LONG", conviction: "MEDIUM" });
    expect(String(row.convictionRationale)).toContain("Stored as MEDIUM: HIGH needs a variant view (consensus expects X, I think Y) and none was given.");
  });
});

describe("the price the morning run's trigger edit reads for itself", () => {
  const watch = () =>
    thesisRow({
      id: "t_w", ticker: "AAA", status: "WATCHING", direction: "LONG",
      triggers: [
        { id: "buy", action: "ENTER", source: "AGENT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "Buy the pullback to $100." },
        { id: "tgt", action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "above", value: 140 }, rationale: "Target $140." },
        { id: "flr", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 90 }, rationale: "Floor $90." },
      ],
    });
  const moveTheBuy = { thesis_id: "t_w", edit: [{ id: "buy", level: 96, rationale: "Reclaim of the $96 shelf." }] };

  it("with a quote, the buy's side is read off it and the move lands", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { thesis: [watch()] }, args: moveTheBuy, ctx: morning, quotes: { AAA: 94 } });
    expect(r.result.data?.trigger_ops).toEqual([expect.objectContaining({ id: "buy", ok: true })]);
    const buy = (r.db.store.thesis[0].triggers as Array<{ id: string; predicate: { is: string; value: number } }>).find((t) => t.id === "buy");
    expect(buy?.predicate).toMatchObject({ is: "above", value: 96 });
  });

  it("no quote: the buy move is refused by name, without naming a field this tool lacks; nothing landed, so no line", async () => {
    const r = await replayTool("edit-triggers", "editTriggers", { seed: { thesis: [watch()] }, args: moveTheBuy, ctx: morning, quotes: {} });
    const ops = r.result.data?.trigger_ops as Array<{ id: string; ok: boolean; reason?: string }>;
    expect(ops).toEqual([expect.objectContaining({ id: "buy", ok: false })]);
    expect(ops[0].reason).not.toContain("price_at_time");
    expect(ops[0].reason).toContain("Leave the buy as it is");
    expect(written(r.db)).toHaveLength(0);
  });
});

describe("DOCU 10-07: back on watch with its plan (step 12, part 3; the ratio is not a rule since 2026-11-04)", () => {
  it("the reply does not say no plan; the sold fill is not read as a buy; the buy is its trigger, never the fill", async () => {
    const { save } = await sentVerbatim("DOCU");
    expect(save.refused).toBe(false);
    expect(String(save.result.summary)).not.toContain("Back on watch with no plan");
    const row = save.db.store.thesis[0];
    expect(row).toMatchObject({ status: "WATCHING" });
    expect(triggerSentences(row).join(" | ")).toMatch(/Buy if (above|below) \$74\.10/);
    let line = "";
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      line = (await import("@/lib/agent/row-for-model")).rowForModel({ ...row }, { named: false, size: "line" }) as string;
    });
    expect(line).not.toContain("no plan");
    expect(line).not.toContain("$67.73");
  });

  it("a save whose plan lands says nothing of the kind (ABT 10-07)", async () => {
    const { save } = await sentVerbatim("ABT");
    expect(String(save.result.summary)).not.toContain("Back on watch with no plan");
  });
});
