/**
 * The watch rewrite (scripts/rewrite-watches.ts), on production's rows and
 * charts of 2026-11-19 (Secular Compounder):
 * - ETN, cmqeg5hyu000a04l1jsoavysc: COMPOUNDER_ACCUMULATION, no triggers at
 *   all; closed at $338.34 under its 200-day ($397.49). Since the expert
 *   review (1.5, 2026-11-20) the playbook has no Stop watching line and every
 *   buy waits for the 200-day, so nothing holds today.
 * - MA, cmum2tf9m000d04jfv0szuiap: MA_PULLBACK, three triggers an agent wrote.
 * - TRV, cmum3c72c000h04jp9ztyxxko: BASE_BREAKOUT, seven an agent wrote, one of
 *   them "Review 60 days after the buy", which needs a position.
 * - VRT, cmqb2k5md000d04l6zjln73rk: no playbook, four triggers with no source
 *   (kept as the owner's) and one an agent wrote.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
import { brief, clearable, lastEntry, stampFor, type Watch } from "./rewrite-watches";
import { tailorMessage } from "@/lib/agent/run-thesis-writer";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { describeTrigger } from "@/lib/agent/triggers/ops";
import { triggerInputSchema } from "@/lib/agent/triggers/schema";
import { holdingNow } from "@/lib/agent/triggers/true-now";
import type { EvaluationContext } from "@/lib/agent/triggers/evaluate";
import type { Trigger } from "@/lib/agent/triggers/types";

const playbooks = (id: string) => playbookTemplates(null, id);
const stamped = (add: Array<Record<string, unknown>>) => add.map((t, i) => ({ ...(triggerInputSchema.parse(t) as Trigger), id: `stamp-${i}` }));
const said = (ts: Trigger[]) => ts.map(describeTrigger);
const read = (price: number, indicators: unknown): EvaluationContext => ({
  latestQuote: { price, changePct: 0 },
  indicators: indicators as EvaluationContext["indicators"],
  thesis: { createdAt: new Date("2026-06-15T00:00:00Z"), lastReviewedAt: null, catalystDate: null, direction: "LONG" },
  now: new Date("2026-11-19T21:30:00Z"),
});

const ETN_CHART = {
  price: 338.34,
  base: null,
  gaps: [{ date: "2026-11-16", direction: "DOWN", pct: -3.37, volumeRatio: 0.89, low: 336.2, mid: 341.75, high: 347.3 }],
  range: { high20: 399.3, low20: 324.27, high52w: 478, low52w: 311.92, pctBelow52wHigh: 29.2, pctAbove52wLow: 8.5 },
  swings: { lastHigh: { price: 399.3, date: "2026-10-28" }, lastLow: { price: 324.27, date: "2026-11-05" } },
} as never;
/** ETN's indicator snapshot of 2026-11-18, the fields the checks read. */
const ETN_SNAPSHOT = { asOf: "2026-11-18", sma: { 20: 361.29, 50: 396.61, 150: 406.39, 200: 397.49 }, high20: 399.3, low20: 324.27, high52w: 478, low52w: 311.92, volumeAvg20: 3243731, closes: [353.08, 327.02, 341.72, 359.3, 354.22, 360.62, 359.04, 352.97, 336.88, 337.11, 338.34], rsVsSpy: { "1M": -6.4, "3M": -14.3, "6M": -9.4 }, gaps: [], atr14: 17.51, insiderBuys: [] };
const ETN: Watch = { thesisId: "cmqeg5hyu000a04l1jsoavysc", ticker: "ETN", direction: "LONG", setupId: "COMPOUNDER_ACCUMULATION", triggers: [] };

const MA_CHART = {
  price: 643.37,
  base: { pivot: 681.99, low: 605, depthPct: 11.3, lengthBars: 22, startDate: "2026-10-20", endDate: "2026-11-18", lastContractionPct: 6.7, brokenOut: false },
  gaps: [],
  range: { high20: 681.99, low20: 605, high52w: 681.99, low52w: 464.52, pctBelow52wHigh: 5.7, pctAbove52wLow: 38.5 },
  swings: { lastHigh: { price: 681.99, date: "2026-11-05" }, lastLow: { price: 605, date: "2026-10-28" } },
} as never;
const MA_SNAPSHOT = { asOf: "2026-11-18", sma: { 20: 644.54, 50: 604.72, 150: 553.98, 200: 543.58 }, high20: 681.99, low20: 605, high52w: 681.99, low52w: 464.52, volumeAvg20: 3245215, closes: [661.19, 661.71, 645.73, 643.37], rsVsSpy: { "1M": 8.8, "3M": 16.4, "6M": 30.7 }, gaps: [], atr14: 13.86, insiderBuys: [] };
const MA: Watch = {
  thesisId: "cmum2tf9m000d04jfv0szuiap",
  ticker: "MA",
  direction: "LONG",
  setupId: "MA_PULLBACK",
  triggers: [
    { id: "18abc899", action: "REVIEW", source: "AGENT", predicate: { is: "before", value: 3, watch: "report" }, rationale: "Q3 earnings land October 29." },
    { id: "3b6ac96d", action: "ENTER", source: "AGENT", predicate: { is: "near", value: 2, watch: "move", variable: "sma50" }, rationale: "Within 2% of the rising 50-day." },
    { id: "dd1cfbac", action: "REVIEW", source: "AGENT", predicate: { is: "below", value: 10, watch: "move", variable: "close_20d" }, rationale: "A 10%-plus drawdown from the 20-day close." },
  ] as unknown as Trigger[],
};

const TRV_CHART = {
  price: 391.58,
  base: { pivot: 418, low: 367, depthPct: 12.2, lengthBars: 26, startDate: "2026-10-14", endDate: "2026-11-18", lastContractionPct: 7.1, brokenOut: false },
  gaps: [],
  range: { high20: 418, low20: 388.44, high52w: 418, low52w: 268, pctBelow52wHigh: 6.3, pctAbove52wLow: 46.1 },
  swings: { lastHigh: { price: 418, date: "2026-11-05" }, lastLow: { price: 389.6363, date: "2026-11-06" } },
} as never;
const TRV_SNAPSHOT = { asOf: "2026-11-18", sma: { 20: 399.25, 50: 382.76, 150: 350.35, 200: 337.7 }, high20: 418, low20: 388.44, high52w: 418, low52w: 268, volumeAvg20: 1531018, closes: [403.06, 397.58, 391.58], rsVsSpy: { "1M": 4, "3M": 11.7, "6M": 29.1 }, gaps: [], atr14: 8.64, insiderBuys: [] };
const TRV: Watch = {
  thesisId: "cmum3c72c000h04jp9ztyxxko",
  ticker: "TRV",
  direction: "LONG",
  setupId: "BASE_BREAKOUT",
  triggers: [
    { id: "d7ee0098", action: "REVIEW", source: "AGENT", predicate: { is: "after", value: 60, watch: "from_date", variable: "buy" }, rationale: "60-day business checkpoint." },
    { id: "968ed379", action: "ENTER", source: "AGENT", predicate: { is: "above", value: 407.87, watch: "price", settings: { close: true } }, rationale: "I buy when it breaks above $407.87." },
    { id: "e1642d0c", action: "STOP_WATCHING", source: "AGENT", predicate: { is: "below", value: 391, watch: "price", settings: { close: true } }, rationale: "A close under roughly $391." },
  ] as unknown as Trigger[],
};

describe("what comes off: what an agent or code wrote; the owner's, and a trigger with no source, stay", () => {
  it("VRT's kinds: one with no source and the owner's stay, an agent's and code's come off; with no playbook, nothing goes on", () => {
    const vrt: Watch = {
      thesisId: "cmqb2k5md000d04l6zjln73rk",
      ticker: "VRT",
      direction: "LONG",
      setupId: null,
      triggers: [
        { id: "a", action: "REVIEW", predicate: { watch: "price", is: "below", value: 275.5 }, rationale: "r" },
        { id: "b", action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "above", value: 230 }, rationale: "r" },
        { id: "c", action: "REVIEW", source: "PRINCIPAL", predicate: { watch: "surprise", is: "beat", value: 0 }, rationale: "r" },
        { id: "d", action: "REVIEW", source: "DEFAULT", predicate: { watch: "repeat", value: 30 }, rationale: "r" },
      ] as unknown as Trigger[],
    };
    expect(vrt.triggers.filter(clearable).map((t) => t.id)).toEqual(["b", "d"]);
    expect(stampFor(vrt, null, playbooks)).toEqual({ add: [], notWritten: [] });
    expect(brief("Secular Compounder", null, [])).toMatch(/It has no playbook yet: name the one that fits the chart today, or none/);
  });
});

describe("what goes on: the playbook's watch triggers, priced from today's chart, as on a new watch", () => {
  it("ETN: three of its playbook's four, the pivot's buy not written (no base on the chart)", () => {
    const s = stampFor(ETN, ETN_CHART, playbooks);
    expect(said(stamped(s.add))).toEqual([
      "Buy if within 2% of the 50-day average and above the 200-day average",
      "Buy if above the 50-day average · only on the close and above the 200-day average",
      "Review every 30 days",
    ]);
    expect(s.add.every((t) => t.playbook === "WATCH")).toBe(true);
    expect(s.notWritten.map((n) => n.reason)).toEqual(["{pivot}: the chart has no base"]);
  });

  it("MA: its agent's three come off and its playbook's three go on, the buy among them (an agent's buy no longer holds its kind)", () => {
    expect(MA.triggers.every(clearable)).toBe(true);
    expect(said(stamped(stampFor(MA, MA_CHART, playbooks).add))).toEqual([
      "Buy if within 2% of the 50-day average",
      "Review every 7 days",
      "Stop watching if below the 50-day average and above 1.5× normal volume",
    ]);
  });

  it("TRV: the breakout's buy at the base's pivot and Stop watching at its low; the review that needs a position comes off and nothing puts it back", () => {
    const s = said(stamped(stampFor(TRV, TRV_CHART, playbooks).add));
    expect(s).toEqual(["Buy if above $418 · only on the close and above 1.5× normal volume and below $438.90", "Review every 7 days", "Stop watching if below $367 · only on the close"]);
    expect(s.some((x) => /after the buy/.test(x))).toBe(false);
  });
});

describe("a line that holds today is named to the Writer before it acts", () => {
  it("ETN: nothing holds at $338.34 under its $397.49 200-day: the buys wait for the long uptrend, and no line ends the watch", () => {
    expect(holdingNow(stamped(stampFor(ETN, ETN_CHART, playbooks).add), read(338.34, ETN_SNAPSHOT))).toEqual([]);
  });

  it("a Stop watching line that holds today is asked about as the end of the watch, neither side first", () => {
    const stop = { id: "s", action: "STOP_WATCHING", predicate: { watch: "price", is: "below", variable: "sma200", settings: { close: true } }, rationale: "r" } as unknown as Trigger;
    expect(brief("Secular Compounder", "MA_PULLBACK", [stop])).toContain(
      '"Stop watching if below the 200-day average · only on the close" is true today and fires at the next check, ending the watch. Say whether the watch should end, and why.',
    );
    expect(brief("Secular Compounder", "MA_PULLBACK", [stop])).not.toMatch(/Keep it|take it off/);
  });

  it("a buy that holds today is asked about as a buy", () => {
    const buy = { id: "b", action: "ENTER", predicate: { watch: "price", is: "above", variable: "sma50" }, rationale: "r" } as unknown as Trigger;
    expect(brief("Secular Compounder", "COMPOUNDER_ACCUMULATION", [buy])).toContain('"Buy if above the 50-day average" is true today and fires at the next check, proposing the buy. Say whether the buy should be proposed, and why.');
  });

  it("MA and TRV: nothing holds at today's price; MA's 7-day clock is due, and a clock is not named", () => {
    expect(holdingNow(stamped(stampFor(MA, MA_CHART, playbooks).add), read(643.37, MA_SNAPSHOT))).toEqual([]);
    expect(holdingNow(stamped(stampFor(TRV, TRV_CHART, playbooks).add), read(391.58, TRV_SNAPSHOT))).toEqual([]);
    expect(brief("Secular Compounder", "MA_PULLBACK", [])).not.toMatch(/true today/);
  });

  it("the triggers the Writer reads after its save name it too", () => {
    const etn = stamped(stampFor(ETN, ETN_CHART, playbooks).add).map((t) => ({ ...t, playbook: "WATCH" as const }));
    const msg = tailorMessage({ ticker: "ETN", decision: {}, status: "WATCHING", direction: "LONG", triggers: etn, notWritten: [], trueNow: new Set(["stamp-1"]) });
    expect(msg).toContain("- Buy if above the 50-day average · only on the close and above the 200-day average (the playbook's) (true today: fires at the next check) — ");
    expect(msg.match(/true today/g)).toHaveLength(1);
  });
});

describe("the journal", () => {
  it("--restore puts back the last set cleared from the stock, by its ticker (and analyst, when named)", () => {
    const journal = [
      JSON.stringify({ ticker: "MA", thesisId: "ma", analyst: "Secular Compounder", cleared: [{ id: "old" }] }),
      JSON.stringify({ ticker: "TRV", thesisId: "trv", analyst: "Secular Compounder", cleared: [{ id: "trv1" }] }),
      JSON.stringify({ ticker: "MA", thesisId: "ma", analyst: "Secular Compounder", cleared: [{ id: "newer" }] }),
      "",
    ].join("\n");
    expect(lastEntry(journal, "MA")?.cleared).toEqual([{ id: "newer" }]);
    expect(lastEntry(journal, "MA", "pead specialist")).toBeNull();
    expect(lastEntry(journal, "ETN")).toBeNull();
  });
});
