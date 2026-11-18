/**
 * The Writer names the playbook; its save writes the triggers. Replay: AAON
 * and CORT, 2026-11-17, each chart as the Writer was shown it (the numbers
 * are the data block's).
 */
import { writerTriggers } from "./writer-triggers";
import { playbookTemplates, PLAYBOOK_UNREAD } from "@/lib/agent/knowledge/playbooks";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { triggerInputSchema } from "@/lib/agent/triggers/schema";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { WriterDecisionInput } from "./decision";

const AAON = {
  price: 78.71,
  base: null,
  range: { high20: 85.99, low20: 53.13, high52w: 150.46, low52w: 53.13 },
  swings: { lastHigh: { price: 78.68, date: "2026-10-28" }, lastLow: { price: 53.13, date: "2026-11-05" } },
  gaps: [
    { date: "2026-11-13", direction: "UP", pct: 6.45, volumeRatio: 0.93, low: 78.64, mid: 82.31, high: 85.99 },
    { date: "2026-11-10", direction: "UP", pct: 13.9, volumeRatio: 3.7, low: 67.72, mid: 73.96, high: 80.19 },
  ],
} as unknown as PriceStructure;
const CORT = { price: 70.07, base: null, range: { high20: 118.42, low20: 67.69, high52w: 126.38, low52w: 28.66 }, swings: { lastHigh: { price: 122.81, date: "2026-10-13" }, lastLow: { price: 108.41, date: "2026-09-18" } }, gaps: [] } as unknown as PriceStructure;

const view: WriterDecisionInput = { direction: "LONG", horizon: "TRADE", rationale: "The view." };
const at = (chart: PriceStructure, setup: string | null, existing: Trigger[] | null = null) => ({
  templates: setup ? playbookTemplates(null, setup) : [],
  chart,
  price: chart.price,
  today: new Date("2026-11-17T21:00:00Z"),
  existing: existing ? { triggers: existing, direction: "LONG" } : null,
});
const says = (ts: unknown) => ((ts ?? []) as Array<{ action: string; predicate: unknown; rationale: string }>).map((t) => sentenceOf(triggerInputSchema.parse(t) as unknown as Trigger));

describe("the Writer's save writes the playbook's watch triggers from the chart it was shown", () => {
  it("AAON on EPISODIC_PIVOT: the five, each price the chart's, as the save takes them", () => {
    const { decision, notWritten } = writerTriggers({ ...view, setup_id: "EPISODIC_PIVOT" }, at(AAON, "EPISODIC_PIVOT"));
    // The playbook's gap is the newest that meets its own screen (at least 8% on at least 3× volume): 11-10, not 11-13's +6.5% on 0.93×.
    // These are the prices the Writer typed on #1036 in every run that named this playbook.
    expect(says(decision.triggers)).toEqual([
      "Review if at least 8% gap up and at least 3× normal volume",
      "Buy if above $80.19 · only on the close",
      "Review if below $73.96 · only on the close",
      "Review every 7 days",
      "Stop watching if below $67.72 · only on the close",
    ]);
    expect((decision.triggers as Array<{ playbook?: string }>).every((t) => t.playbook === "WATCH")).toBe(true);
    for (const t of decision.triggers as unknown[]) expect(triggerInputSchema.safeParse(t).success).toBe(true);
    expect(notWritten).toEqual([]);
  });

  it("CORT on PRE_CATALYST: no base, and its last swing low ($108.41) above the $70.07 price, so neither is written, and the save says so", () => {
    const { decision, notWritten } = writerTriggers({ ...view, setup_id: "PRE_CATALYST" }, at(CORT, "PRE_CATALYST"));
    expect(says(decision.triggers)).toContain("Buy if above $118.42 · only on the close and within 70 days before the event date");
    expect(says(decision.triggers).some((s) => /108\.41/.test(s))).toBe(false);
    expect(notWritten).toEqual([
      { field: "setup_id", why: "the playbook's Buy if above {pivot} · only on the close and at least 1.5× normal volume and below {pivotChase} and within 70 days before the event date", reason: "the chart had no {pivot}, {pivotChase}" },
      { field: "setup_id", why: "the playbook's Stop watching if below {swingLow} · only on the close", reason: "the chart had no {swingLow}" },
    ]);
  });

  it("no playbook named: no trigger from one; the look-again review alone", () => {
    const { decision, notWritten } = writerTriggers({ ...view, look_again_price: 70, look_again_date: "2026-12-17", look_again_why: "Back at the gap's low, and after the December 17 decision." }, at(AAON, null));
    expect(says(decision.triggers)).toEqual(["Review if below $70", "Review every 30 days"]);
    expect(notWritten).toEqual([]);
  });

  it("a look-again day out of reach is not written, and the save says so", () => {
    const { decision, notWritten } = writerTriggers({ ...view, look_again_date: "2026-11-01", look_again_why: "Before the report." }, at(AAON, null));
    expect(decision.triggers).toBeUndefined();
    expect(notWritten).toEqual([{ field: "look_again_date", why: "the review on 2026-11-01", reason: "a day 1 to 365 days from today is needed" }]);
  });

  it("a PASS writes no playbook trigger, and its look-again goes on for the decision's check to refuse", () => {
    const { decision } = writerTriggers({ ...view, direction: "PASS", setup_id: "EPISODIC_PIVOT", look_again_price: 70, look_again_why: "x" }, at(AAON, "EPISODIC_PIVOT"));
    expect(says(decision.triggers)).toEqual(["Review if below $70"]);
  });

  it("the playbooks couldn't be read: none written, and the save says so", () => {
    const { decision, notWritten } = writerTriggers({ ...view, setup_id: "EPISODIC_PIVOT" }, { ...at(AAON, null), templates: null });
    expect(decision.triggers).toBeUndefined();
    expect(notWritten).toEqual([{ field: "setup_id", why: "the EPISODIC_PIVOT playbook's watch triggers", reason: PLAYBOOK_UNREAD }]);
  });
});

describe("on a refresh of a watch, the watch triggers come off and the playbook's go on, as at the fill", () => {
  const stored: Trigger[] = [
    { id: "old-buy", action: "ENTER", predicate: { watch: "price", is: "above", value: 90, settings: { close: true } }, rationale: "An old buy.", source: "AGENT" },
    { id: "old-stop", action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: 60, settings: { close: true } }, rationale: "An old line.", source: "AGENT", playbook: "WATCH" },
    { id: "earnings", action: "REVIEW", predicate: { watch: "report", is: "before", value: 7 }, rationale: "The report.", source: "AGENT" },
    { id: "his-stop", action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: 70, settings: { close: true } }, rationale: "Mine.", source: "PRINCIPAL" },
  ] as Trigger[];

  it("the old buy and line come off; the owner's stays, and the playbook's of its kind is not written", () => {
    const { decision, notWritten } = writerTriggers({ ...view, setup_id: "EPISODIC_PIVOT" }, at(AAON, "EPISODIC_PIVOT", stored));
    expect(decision.triggers).toBeUndefined();
    expect(decision.remove_trigger_ids).toEqual(["old-buy", "old-stop"]);
    expect(says(decision.add_triggers)).toEqual([
      "Review if at least 8% gap up and at least 3× normal volume",
      "Buy if above $80.19 · only on the close",
      "Review if below $73.96 · only on the close",
      "Review every 7 days",
    ]);
    expect(notWritten).toEqual([{ field: "setup_id", why: "the playbook's Stop watching if below $67.72 · only on the close", reason: "your Stop watching if below $70 · only on the close is kept" }]);
  });

  it("a refresh that would leave nothing on the stock is sent back", () => {
    const watch = stored.filter((t) => t.source !== "PRINCIPAL" && t.action !== "REVIEW");
    expect(writerTriggers({ ...view }, at(AAON, null, watch)).nothingLeft).toBe(true);
    expect(writerTriggers({ ...view, look_again_price: 70, look_again_why: "Back at the gap's low." }, at(AAON, null, watch)).nothingLeft).toBe(false);
  });

  it("a PASS takes nothing off", () => {
    const { decision } = writerTriggers({ ...view, direction: "PASS" }, at(AAON, null, stored));
    expect(decision.remove_trigger_ids).toBeUndefined();
    expect(decision.add_triggers).toBeUndefined();
  });
});
