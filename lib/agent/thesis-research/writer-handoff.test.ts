/**
 * writer-handoff.test.ts — CYTK, 2026-09-21, replayed from the two real
 * audit rows written seventeen seconds apart (DAV-301).
 *
 * Run cmub769ly001l04l8agl1clmr (MORNING_PLAN) dispatched
 * cmub773j5001q04l8k68kalre (THESIS_WRITER) at 12:04:56 and waited. The
 * writer finished at 12:08:01 with a re-priced plan. At 12:08:17 the parent
 * removed the buy, the floor and the target — the three levels the writer
 * had just set — because everything the waiter handed back was prose.
 */
import { writerHandoff, writerHandoffLine } from "./writer-handoff";

/** The writer's real ThesisUpdate summary, verbatim. */
const WRITER_SUMMARY =
  "Updated CYTK: Entry $73.50 → $70.25, Entry: fires on the close, Stop: wording updated, Target $96 → $88.31, composite 6 → 3, rationale updated, research refreshed";

/** The plan as the writer left it on the row at 12:08:00. */
const CYTK_PLAN = { entryPrice: 70.25, targetPrice: 88.31, stopLoss: 64, composite: 3 };

describe("the plan the refresh wrote goes back to the run that asked for it", () => {
  const h = writerHandoff({
    ticker: "CYTK",
    update: { summary: WRITER_SUMMARY },
    plan: CYTK_PLAN,
  });

  it("names every level the parent went on to delete", () => {
    expect(h.planLine).toBe(
      "The plan the refresh left: buy $70.25, target $88.31, floor $64.00, composite 3/10.",
    );
  });

  it("carries the writer's own list of what changed, without the boilerplate lead", () => {
    expect(h.changed).toBe(
      "Entry $73.50 → $70.25, Entry: fires on the close, Stop: wording updated, Target $96 → $88.31, composite 6 → 3, rationale updated, research refreshed",
    );
  });

  it("the one line the tool row and the model both read", () => {
    expect(writerHandoffLine(h)).toBe(
      "The refresh changed: Entry $73.50 → $70.25, Entry: fires on the close, Stop: wording updated, Target $96 → $88.31, composite 6 → 3, rationale updated, research refreshed. " +
        "The plan the refresh left: buy $70.25, target $88.31, floor $64.00, composite 3/10.",
    );
  });

  it("asks for the disagreement to be said against the numbers — it refuses nothing", () => {
    expect(h.instruction).toContain("read what it wrote before you change it");
    expect(h.instruction).toContain("say in your rationale why, against these numbers");
    expect(h.instruction).not.toMatch(/refus|blocked|cannot|not allowed/i);
  });
});

describe("the shapes a refresh can leave behind", () => {
  it("a refresh that wrote no plan says so rather than showing an empty list", () => {
    const h = writerHandoff({
      ticker: "CYTK",
      update: { summary: "Updated CYTK: research refreshed" },
      plan: { entryPrice: null, targetPrice: null, stopLoss: null, composite: null },
    });
    expect(h.planLine).toBe(
      "The refresh left no priced plan on $CYTK — no buy level, target or floor.",
    );
    expect(writerHandoffLine(h)).toContain("research refreshed");
  });

  it("a refresh that wrote no audit row leads with the plan alone", () => {
    const h = writerHandoff({ ticker: "CYTK", update: null, plan: CYTK_PLAN });
    expect(h.changed).toBeNull();
    expect(writerHandoffLine(h)).toBe(
      "The plan the refresh left: buy $70.25, target $88.31, floor $64.00, composite 3/10.",
    );
  });

  it("a partial plan names only what is there", () => {
    expect(
      writerHandoff({
        ticker: "ETN",
        update: null,
        plan: { entryPrice: 418, targetPrice: null, stopLoss: 355, composite: 7 },
      }).planLine,
    ).toBe("The plan the refresh left: buy $418.00, floor $355.00, composite 7/10.");
  });

  it("the lead strips with or without the dollar sign, and an empty summary is no summary", () => {
    expect(
      writerHandoff({ ticker: "MU", update: { summary: "Updated $MU: Target $120 → $140" }, plan: CYTK_PLAN }).changed,
    ).toBe("Target $120 → $140");
    expect(
      writerHandoff({ ticker: "MU", update: { summary: "Updated MU:" }, plan: CYTK_PLAN }).changed,
    ).toBeNull();
  });
});
