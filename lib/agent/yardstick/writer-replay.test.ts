/**
 * The Writer case replay on T1's flow, with no model: the chart read back
 * from a case's data block, the save's playbook triggers, the tailoring
 * applied as the save applies it, and the call the cases' expectations read.
 * SNDK's chart lines as the sndk-writer-watch case shows them (2026-11-03).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
import { chartFromText } from "./chart-text";
import { afterTailoring, savedByWriter, writerInOldShape, writerOwnCalls, type WriterReplayCase } from "./writer-replay";
import { score } from "./action";
import { pricesSet } from "./grade";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

const BLOCK = `## Snapshot

Current: $1126.52 (+4.78%) · Day range: $1100.53-$1153.19

## Price structure

Range — 20-day $1067.40–$1733.28 · 52-week $183.00–$2354.39 · 52.2% below the 52-week high · 515.6% above the 52-week low
Swings — last swing high $1909.48 (2026-09-22) · last swing low $1659.02 (2026-09-28)
Base — none (no sideways stretch of 20+ sessions inside a 15% range)
Gaps (last 10 sessions, 3%+) — 2026-11-03 UP +3.0% on 1.0× volume: gap-day low $1100.53 · mid $1126.86 · high $1153.19; 2026-10-30 DOWN -8.6% on 2.1× volume: gap-day low $1115.16 · mid $1177.08 · high $1239.00`;

const wc: WriterReplayCase = { ticker: "SNDK", mode: "mint", existing: null, chart: chartFromText(BLOCK) };
const submit = { toolName: "submit_thesis", input: { direction: "LONG", horizon: "TARGET", setup_id: "EPISODIC_PIVOT", rationale: "r" } };

describe("the chart read back from a case's text", () => {
  it("has the numbers the keys read: the price, the range, the swings, no base, the newest gap first", () => {
    expect(wc.chart).toMatchObject({ price: 1126.52, base: null, range: { high20: 1733.28, low20: 1067.4 }, swings: { lastLow: { price: 1659.02 } }, gaps: [{ low: 1100.53, mid: 1126.86, high: 1153.19 }, { low: 1115.16 }] });
  });
});

describe("a Writer mint replayed on T1's flow", () => {
  const saved = savedByWriter(submit.input, wc);

  it("the save writes EPISODIC_PIVOT's watch triggers at the chart's prices", () => {
    expect(saved).toMatchObject({ status: "WATCHING", direction: "LONG" });
    expect(saved.triggers.map((t) => sentenceOf(t))).toEqual([
      "Review if at least 8% gap up and at least 3× normal volume",
      "Buy if above $1153.19 · only on the close",
      "Review if below $1126.86 · only on the close",
      "Review every 7 days",
      "Stop watching if below $1100.53 · only on the close",
    ]);
  });

  it("its tailoring lands as the save lands it: a removal, a key, and a sale refused on a watch", () => {
    const tailor = [{ toolName: "edit_triggers", input: {
      remove: [{ id: saved.triggers[0].id, reason: "The gap already came." }],
      add: [
        { action: "REVIEW", predicate: { watch: "price", is: "above", value: "{high20}" }, rationale: "Back above the 20-day high is the repair." },
        { action: "EXIT", predicate: { watch: "price", is: "below", value: 1000 }, rationale: "a sale on a watch" },
      ],
    } }];
    const final = afterTailoring(saved, submit.input, wc, tailor);
    expect(final.map((t) => sentenceOf(t))).toEqual([
      "Buy if above $1153.19 · only on the close",
      "Review if below $1126.86 · only on the close",
      "Review every 7 days",
      "Stop watching if below $1100.53 · only on the close",
      "Review if above $1733.28",
    ]);
    // Graded as the cases read it: one submit_thesis carrying the triggers it was left with.
    const scored = writerInOldShape(submit, saved, final, wc, tailor);
    expect(score({ call: [{ tool: "submit_thesis", where: { "triggers.*.action": "REVIEW" } }], never: [{ tool: "submit_thesis", where: { "triggers.*.action": "EXIT" } }] }, [scored], "").pass).toBe(true);
    // Its prices are its own: the key is not a price it typed, the sale's $1,000 is.
    expect(pricesSet(writerOwnCalls(submit, tailor))).toEqual([1000]);
  });

  it("a PASS saves no trigger and has no tailoring", () => {
    expect(savedByWriter({ direction: "PASS" }, wc)).toMatchObject({ status: "PASSED", triggers: [] });
  });
});

describe("a held refresh replayed on T1's flow", () => {
  const floor = { id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 150 }, rationale: "The floor." } as Trigger;
  const held: WriterReplayCase = { ticker: "NVDA", mode: "refresh", existing: { status: "HOLDING", direction: "LONG", setupId: null, triggers: [floor] }, chart: wc.chart };

  it("writes no watch trigger; a typed price on the floor is refused, a key moves it, and the edit is graded as the refresh's own", () => {
    const saved = savedByWriter({ direction: "LONG" }, held);
    expect(saved.triggers).toEqual([floor]);
    const typed = [{ toolName: "edit_triggers", input: { edit: [{ id: "floor", value: 155, rationale: "Under the gap low." }] } }];
    expect(afterTailoring(saved, { direction: "LONG" }, held, typed).map((t) => sentenceOf(t))).toEqual(["Sell if below $150"]);
    const keyed = [{ toolName: "edit_triggers", input: { edit: [{ id: "floor", price: "{gapDayLow}", rationale: "Under the gap day's low." }] } }];
    const final = afterTailoring(saved, { direction: "LONG" }, held, keyed);
    expect(final.map((t) => sentenceOf(t))).toEqual(["Sell if below $1100.53"]);
    expect(writerInOldShape({ toolName: "submit_thesis", input: { direction: "LONG" } }, saved, final, held, keyed).input).toEqual({ direction: "LONG", edit_triggers: [{ id: "floor", price: "{gapDayLow}", rationale: "Under the gap day's low." }] });
  });
});

describe("a view kept with a look-again (SNDK 2026-11-04)", () => {
  it("the save writes its one review beside nothing else, and the case reads it as a REVIEW trigger", () => {
    const decision = { direction: "LONG", rationale: "r", horizon: "TARGET", look_again: { after_next_report: true, why: "Whether the January report confirms NAND pricing." } };
    const saved = savedByWriter(decision, wc, "2026-11-04");
    expect(saved.triggers.map((t) => sentenceOf(t))).toEqual(["Review if within 1 day after earnings"]);
    const scored = writerInOldShape({ toolName: "submit_thesis", input: decision }, saved, afterTailoring(saved, decision, wc, []), wc, []);
    expect(score({ call: [{ tool: "submit_thesis", where: { direction: { regex: "^(LONG|SHORT)$" }, "triggers.*.action": "REVIEW" } }] }, [scored], "").pass).toBe(true);
  });
});
