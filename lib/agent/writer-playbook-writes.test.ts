/**
 * The Writer's save writes the playbook's watch triggers (T1, 2026-11-19):
 * all of them on a new watch, priced from the chart the Writer was shown;
 * none on a refresh on the same playbook; on a playbook change, the old
 * playbook's come off and the new one's go on, and a trigger written by hand
 * stays. SNDK's chart of 2026-11-03 (the sndk-writer-watch case): the newest
 * gap's low $1,100.53, middle $1,126.86, high $1,153.19; no base.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
import { writerPlaybookWrites } from "./run-thesis-writer";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { triggerInputSchema } from "@/lib/agent/triggers/schema";
import type { Trigger } from "@/lib/agent/triggers/types";

const chart = {
  price: 1126.52,
  base: null,
  gaps: [{ date: "2026-11-03", direction: "UP", pct: 3.0, low: 1100.53, mid: 1126.86, high: 1153.19 }],
  range: { high20: 1733.28, low20: 1067.4, high52w: 2354.39, low52w: 183 },
  swings: { lastHigh: { price: 1909.48, date: "2026-09-22" }, lastLow: { price: 1659.02, date: "2026-09-28" } },
} as never;
const pull = { priceStructure: chart };
const playbooks = (id: string) => playbookTemplates(null, id);
const said = (ts: Array<Record<string, unknown>>) => ts.map((t) => sentenceOf(triggerInputSchema.parse(t) as unknown as Trigger));

describe("a new watch gets every one of its playbook's watch triggers, priced from the chart", () => {
  it("EPISODIC_PIVOT: the gap review, the buy at the gap day's high, the review at its middle, the clock and Stop watching at its low", () => {
    const w = writerPlaybookWrites({ direction: "LONG", setup_id: "EPISODIC_PIVOT" }, pull, null, playbooks);
    expect(said(w.add)).toEqual([
      "Review if at least 8% gap up and at least 3× normal volume",
      "Buy if above $1153.19 · only on the close",
      "Review if below $1126.86 · only on the close",
      "Review every 7 days",
      "Stop watching if below $1100.53 · only on the close",
    ]);
    expect(w.add.every((t) => t.playbook === "WATCH")).toBe(true);
    expect(w.notWritten).toEqual([]);
  });

  it("a trigger whose key the chart doesn't have today is not written, and says why", () => {
    const w = writerPlaybookWrites({ direction: "LONG", setup_id: "BASE_BREAKOUT" }, pull, null, playbooks);
    expect(said(w.add)).toEqual(["Review every 7 days"]);
    expect(w.notWritten.map((n) => n.reason)).toEqual(["{pivot}: the chart has no base; {pivotChase}: the chart has no base", "{baseLow}: the chart has no base"]);
  });

  it("no playbook, a PASS, a stock we hold: nothing is written", () => {
    expect(writerPlaybookWrites({ direction: "LONG", setup_id: undefined }, pull, null, playbooks).add).toEqual([]);
    expect(writerPlaybookWrites({ direction: "PASS", setup_id: "PEAD" }, pull, null, playbooks).add).toEqual([]);
    expect(writerPlaybookWrites({ direction: "LONG", setup_id: "PEAD" }, pull, { direction: "LONG", status: "HOLDING", setupId: null, triggers: [] }, playbooks).add).toEqual([]);
  });

  it("an account's playbooks that couldn't be read write nothing, and say so", () => {
    const w = writerPlaybookWrites({ direction: "LONG", setup_id: "PEAD" }, pull, null, null);
    expect(w.add).toEqual([]);
    expect(w.notWritten[0].reason).toBe("The playbook couldn't be read, so none of its triggers were written");
  });
});

describe("a refresh on a watch", () => {
  const pbBuy = { id: "pb_buy", action: "ENTER", predicate: { watch: "price", is: "above", value: 1200 }, rationale: "the old playbook's buy", playbook: "WATCH" } as Trigger;
  const own = { id: "own_review", action: "REVIEW", predicate: { watch: "report", is: "before", value: 14 }, rationale: "written by hand" } as Trigger;

  it("on the same playbook, nothing is re-stamped", () => {
    const w = writerPlaybookWrites({ direction: "LONG", setup_id: "PEAD" }, pull, { direction: "LONG", status: "WATCHING", setupId: "PEAD", triggers: [pbBuy, own] }, playbooks);
    expect(w).toEqual({ add: [], remove: [], notWritten: [] });
  });

  it("on a playbook change, the old playbook's triggers come off and the new one's go on; one written by hand stays", () => {
    const w = writerPlaybookWrites({ direction: "LONG", setup_id: "PEAD" }, pull, { direction: "LONG", status: "WATCHING", setupId: "MA_PULLBACK", triggers: [pbBuy, own] }, playbooks);
    expect(w.remove).toEqual(["pb_buy"]);
    expect(said(w.add)).toEqual(["Buy if above $1126.86 · only on the close", "Review every 7 days", "Stop watching if below $1100.53 · only on the close"]);
  });

  it("a hand-written trigger of the same kind stays, and the playbook's is not written beside it", () => {
    const handBuy = { id: "hand_buy", action: "ENTER", predicate: { watch: "price", is: "above", value: 1180 }, rationale: "the owner's buy" } as Trigger;
    const w = writerPlaybookWrites({ direction: "LONG", setup_id: "PEAD" }, pull, { direction: "LONG", status: "WATCHING", setupId: null, triggers: [handBuy] }, playbooks);
    expect(w.remove).toEqual([]);
    expect(said(w.add)).toEqual(["Review every 7 days", "Stop watching if below $1100.53 · only on the close"]);
    expect(w.notWritten).toEqual([expect.objectContaining({ reason: "the stock already has a trigger of that kind, which stays" })]);
  });
});
