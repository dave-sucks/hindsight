jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { readFileSync } from "fs";
import { join } from "path";
import { SITUATIONS } from "@/lib/agent/situations";
import {
  CATEGORIES, SITUATION_CATEGORY, THREAD_SHAPE, buildAgentWork, fireAction, indexOf, longestStreak, measureLabel, outcomeOf, triggerRunCode,
  type Raw, type RunRow, type UpdateRow,
} from "./agent-work";

const FIXTURE = join(__dirname, "__fixtures__", "morning-thread-2026-11-13.json");

describe("the saved morning thread (one real run, 2026-11-13, rows cut to id, ticker, status and codes)", () => {
  // The path the situation query reads. If the AI SDK or get_theses changes it, this fails.
  const thread = JSON.parse(readFileSync(FIXTURE, "utf8")) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  const part = thread.flatMap((m) => m.content).find((p) => p.type === THREAD_SHAPE.part && p.toolName === THREAD_SHAPE.tool);
  const data = THREAD_SHAPE.data.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], part) as Record<string, Array<Record<string, unknown>>>;
  const codesOf = (list: keyof typeof THREAD_SHAPE.lists) => data[THREAD_SHAPE.lists[list]].map((r) => [r.ticker, r[THREAD_SHAPE.codes]]);

  it("keeps each list's codes where the query reads them", () => {
    expect(codesOf("work")).toEqual([
      ["CEG", ["YOUR_WORD_UNANSWERED"]], ["WST", ["STALE_RESEARCH"]], ["GEV", ["PROTECTIVE_SALE"]],
      ["NOW", ["REVIEW_DUE", "STALE_RESEARCH", "PLAN_PROBLEM"]], ["ETN", ["REVIEW_DUE", "PLAN_PROBLEM"]], ["AAPL", ["STALE_RESEARCH"]],
    ]);
    expect(codesOf("quiet")).toEqual([["MU", []], ["PLTR", []], ["FTNT", ["PLAN_PROBLEM"]], ["AVGO", ["PLAN_PROBLEM"]]]);
    expect(codesOf("sold")).toEqual([["MSFT", ["SOLD_ONE_REVIEW"]]]);
    expect(data[THREAD_SHAPE.lists.work].every((r) => typeof r.id === "string")).toBe(true);
    expect(data[THREAD_SHAPE.lists.sold].every((r) => typeof r.thesis_id === "string")).toBe(true);
  });

  it("names only codes the app knows, and stays small", () => {
    const all = Object.values(data).flat().flatMap((r) => r[THREAD_SHAPE.codes] as string[]);
    expect(all.every((c) => c in SITUATIONS)).toBe(true);
    expect(readFileSync(FIXTURE).length).toBeLessThan(20_000);
  });
});

it("puts every situation in one of the six categories", () => {
  for (const code of Object.keys(SITUATIONS)) expect(CATEGORIES).toContain(SITUATION_CATEGORY[code as keyof typeof SITUATIONS]);
});

const at = (iso: string) => new Date(iso);
const run = (id: string, over: Partial<RunRow> = {}): RunRow => ({
  id, mode: "MORNING_PLAN", analystId: "a1", status: "COMPLETE", createdAt: at("2026-11-11T13:00:00Z"), completedAt: at("2026-11-11T13:10:00Z"),
  parentRunId: null, thesisId: null, action: null, auto: false, ...over,
});
const upd = (id: string, over: Partial<UpdateRow>): UpdateRow => ({
  id, thesisId: "t1", at: at("2026-11-11T13:05:00Z"), type: "REVIEWED", runId: "m1", tradeId: null, triggerId: null,
  triggerAction: null, condition: null, summary: null, keys: [], realOps: false, ...over,
});
const raw = (over: Partial<Raw>): Raw => ({
  analysts: [{ id: "a1", name: "Compounder" }], levels: { analyst: ["an1"], account: ["ac1"] },
  runs: [run("m1")], reads: [], updates: [], orders: [], theses: [{ id: "t1", ticker: "CEG", status: "HOLDING", analystId: "a1", triggerIds: ["s1"], inheritedIds: [] }],
  refusals: [], ...over,
});
const outcome = (r: Raw) => outcomeOf("m1", "t1", indexOf(r)).outcome;

describe("what a run did with a stock", () => {
  it("is a proposal when an order on the stock was made while the run ran, or its note was stamped with one", () => {
    expect(outcome(raw({ orders: [{ id: "o1", thesisId: "t1", symbol: "CEG", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-11-11T13:06:00Z") }] }))).toBe("trade");
    expect(outcome(raw({
      orders: [{ id: "o2", thesisId: "t1", symbol: "CEG", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-11-11T15:00:00Z") }],
      updates: [upd("u1", { tradeId: "o2" })],
    }))).toBe("trade");
    expect(outcome(raw({ orders: [{ id: "o3", thesisId: "t1", symbol: "CEG", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-11-11T15:00:00Z") }] }))).toBe("nothing");
  });

  it("is refused when the gates refused a trade tool on the stock", () => {
    expect(outcome(raw({ refusals: [{ runId: "m1", thesisId: null, ticker: "ceg" }], updates: [upd("u1", {})] }))).toBe("refused");
  });

  it("counts a Writer it dispatched as a research rewrite for the run", () => {
    expect(outcome(raw({ runs: [run("m1"), run("w1", { mode: "THESIS_WRITER", parentRunId: "m1" })], updates: [upd("u1", { runId: "w1", type: "UPDATED", keys: ["bullCase", "stopLoss"] })] }))).toBe("research");
  });

  it("is a level change for a price, trigger or status change, and a note for a wording edit", () => {
    expect(outcome(raw({ updates: [upd("u1", { type: "UPDATED", keys: ["triggerOps"], realOps: true })] }))).toBe("plan");
    expect(outcome(raw({ updates: [upd("u1", { type: "STATUS_CHANGED", keys: ["status"] })] }))).toBe("plan");
    expect(outcome(raw({ updates: [upd("u1", { type: "UPDATED", keys: ["triggerOps"], realOps: false })] }))).toBe("note");
    expect(outcome(raw({ updates: [upd("u1", { type: "UPDATED", keys: ["convictionRationale"] })] }))).toBe("note");
    expect(outcome(raw({}))).toBe("nothing");
  });
});

describe("reading a fire", () => {
  it("takes the action and the measure from the rule on the line, else from its sentence", () => {
    expect(fireAction({ triggerAction: null, summary: "Sell if below $236" })).toBe("EXIT");
    expect(fireAction({ triggerAction: null, summary: "MU plan set down — it closed below the floor" })).toBe("EXIT");
    expect(fireAction({ triggerAction: null, summary: "Buy if above $409 · only on the close" })).toBe("ENTER");
    expect(measureLabel({ watch: "move", is: "below", value: 6, variable: "peak" }, null)).toBe("Give-back off the high");
    expect(measureLabel({ watch: "price", is: "below", variable: "sma200" }, null)).toBe("Price vs an average");
    expect(measureLabel({ watch: "price", is: "below", value: 236 }, null)).toBe("Price vs a set price");
    expect(measureLabel(null, "Sell if below 12% from the high since we bought")).toBe("Give-back off the high");
  });

  it("gives a trigger run the situation the morning read would", () => {
    expect(triggerRunCode(run("r", { action: "EXIT", auto: true }), null)).toBe("AUTO_TRADE");
    expect(triggerRunCode(run("r", { action: "TRIM" }), null)).toBe("PROTECTIVE_SALE");
    expect(triggerRunCode(run("r", { action: "REVIEW" }), { watch: "surprise", is: "miss", value: 0 })).toBe("EARNINGS");
    expect(triggerRunCode(run("r", { action: "REVIEW" }), { watch: "price", is: "below", value: 5 })).toBe("REVIEW_DUE");
  });

  it("counts consecutive trading days over weekends and holidays", () => {
    expect(longestStreak(["2026-11-13", "2026-11-16", "2026-11-17"])).toBe(3); // Fri, Mon, Tue
    expect(longestStreak(["2026-11-25", "2026-11-27"])).toBe(2); // Thanksgiving between
    expect(longestStreak(["2026-11-10", "2026-11-12", "2026-11-13"])).toBe(2);
    expect(longestStreak([])).toBe(0);
  });
});

describe("the tab's numbers", () => {
  const fire = (id: string, over: Partial<UpdateRow>) => upd(id, { type: "TRIGGER_FIRED", runId: null, summary: "Review if below $878", triggerAction: "REVIEW", ...over });
  const w = buildAgentWork(
    raw({
      runs: [
        run("m0", { createdAt: at("2026-11-09T13:00:00Z"), completedAt: at("2026-11-09T13:05:00Z") }), run("m1"),
        run("tr1", { mode: "INTRADAY_TACTICAL", createdAt: at("2026-11-11T15:00:00Z"), completedAt: at("2026-11-11T15:02:00Z"), action: "EXIT" }),
      ],
      updates: [
        fire("f1", { at: at("2026-11-10T14:00:00Z"), triggerId: "an1" }),
        fire("f2", { at: at("2026-11-11T15:00:00Z"), runId: "tr1", triggerId: "s1", triggerAction: "EXIT", summary: "Sell if below $236" }),
        fire("f3", { at: at("2026-11-11T15:00:00Z"), runId: "tr1", triggerId: "ac1", triggerAction: "EXIT", summary: "Sell if below 6% from the high since we bought" }),
        upd("u1", { runId: "m1", type: "REVIEWED" }),
      ],
      orders: [{ id: "o1", thesisId: "t1", symbol: "CEG", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-11-11T15:01:00Z") }],
      reads: [
        { runId: "m0", list: "read", thesisId: null, ticker: null, codes: [] },
        { runId: "m0", list: "work", thesisId: "t1", ticker: "CEG", codes: ["PROTECTIVE_SALE", "STALE_RESEARCH"] },
        { runId: "m1", list: "read", thesisId: null, ticker: null, codes: [] },
        { runId: "m1", list: "quiet", thesisId: "t9", ticker: "GD", codes: ["PLAN_PROBLEM"] },
      ],
    }),
    { days: 7, analystId: null, since: at("2026-11-06T00:00:00Z"), now: at("2026-11-13T00:00:00Z") },
  );

  it("answers a fire flagged for review with the next morning run, and a sent one with its trigger run", () => {
    const led = Object.fromEntries(w.fires.ledTo.map((l) => [`${l.mode} ${l.action}`, l]));
    expect(led["Flag for Review Review"].out).toEqual({ note: 1 });
    // Two sale rules fired into one run: two fires, one proposal.
    expect(led["Send to Agent Sell"]).toMatchObject({ n: 2, out: { trade: 2 }, orders: { EXPIRED: 1 } });
    expect(Object.fromEntries(w.fires.byLevel.map((l) => [l.label, l.n]))).toEqual({ Stock: 1, Analyst: 1, Account: 1 });
    expect(w.fires.duplicates[0]).toMatchObject({ a: "Account: Sell, give-back off the high", b: "Stock: Sell, price vs a set price", stockDays: 1 });
  });

  it("counts situations on the work list with what the run did, and quiet rows apart", () => {
    const sale = w.situations.codes.find((c) => c.code === "PROTECTIVE_SALE");
    expect(sale).toMatchObject({ shown: 1, quiet: 0, triggerRuns: 1, out: { nothing: 1 } });
    expect(w.situations.codes.find((c) => c.code === "PLAN_PROBLEM")).toMatchObject({ shown: 0, quiet: 1 });
    expect(w.situations.categories.find((c) => c.category === "Selling and protection")?.shown).toBe(1);
    expect(w.situations.nothing.map((x) => x.ticker)).toEqual(["CEG"]);
    expect(w.reads).toEqual({ morningRuns: 2, read: 2 });
  });
});
