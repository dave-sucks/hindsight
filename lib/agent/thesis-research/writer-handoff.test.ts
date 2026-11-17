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

/** The stock's triggers as the writer left them at 12:08:00, each as its sentence. */
const CYTK_TRIGGERS = ["Buy if above $70.25 · only on the close", "Review if above $88.31", "Stop watching if below $64 · only on the close"];
const CYTK_LINE = "The triggers the refresh left: Buy if above $70.25 · only on the close; Review if above $88.31; Stop watching if below $64 · only on the close.";

describe("the triggers the refresh wrote go back to the run that asked for it", () => {
  const h = writerHandoff({
    ticker: "CYTK",
    update: { summary: WRITER_SUMMARY },
    triggers: CYTK_TRIGGERS,
  });

  it("names every level the parent went on to delete", () => {
    expect(h.planLine).toBe(CYTK_LINE);
  });

  it("carries the writer's own list of what changed, without the boilerplate lead", () => {
    expect(h.changed).toBe(
      "Entry $73.50 → $70.25, Entry: fires on the close, Stop: wording updated, Target $96 → $88.31, composite 6 → 3, rationale updated, research refreshed",
    );
  });

  it("the one line the tool row and the model both read", () => {
    expect(writerHandoffLine(h)).toBe(
      "The refresh changed: Entry $73.50 → $70.25, Entry: fires on the close, Stop: wording updated, Target $96 → $88.31, composite 6 → 3, rationale updated, research refreshed. " +
        CYTK_LINE,
    );
  });

  it("asks for the disagreement to be said against the numbers — it refuses nothing", () => {
    expect(h.instruction).toContain("read what it wrote before you change it");
    expect(h.instruction).toContain("say in your rationale why, against these numbers");
    expect(h.instruction).not.toMatch(/refus|blocked|cannot|not allowed/i);
  });
});

describe("the shapes a refresh can leave behind", () => {
  it("a refresh that left no triggers says so rather than showing an empty list", () => {
    const h = writerHandoff({
      ticker: "CYTK",
      update: { summary: "Updated CYTK: research refreshed" },
      triggers: [],
    });
    expect(h.planLine).toBe("The refresh left $CYTK with no triggers.");
    expect(writerHandoffLine(h)).toContain("research refreshed");
  });

  it("a refresh that wrote no audit row leads with the triggers alone", () => {
    const h = writerHandoff({ ticker: "CYTK", update: null, triggers: CYTK_TRIGGERS });
    expect(h.changed).toBeNull();
    expect(writerHandoffLine(h)).toBe(CYTK_LINE);
  });

  it("a buy on a chart condition reads as written, never as a number", () => {
    expect(
      writerHandoff({ ticker: "ETN", update: null, triggers: ["Buy if above the 50-day average", "Stop watching if below $355 · only on the close"] }).planLine,
    ).toBe("The triggers the refresh left: Buy if above the 50-day average; Stop watching if below $355 · only on the close.");
  });

  it("the lead strips with or without the dollar sign, and an empty summary is no summary", () => {
    expect(
      writerHandoff({ ticker: "MU", update: { summary: "Updated $MU: Target $120 → $140" }, triggers: CYTK_TRIGGERS }).changed,
    ).toBe("Target $120 → $140");
    expect(
      writerHandoff({ ticker: "MU", update: { summary: "Updated MU:" }, triggers: CYTK_TRIGGERS }).changed,
    ).toBeNull();
  });
});
