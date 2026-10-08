/**
 * The live book on 2026-10-07 after the close (__fixtures__/live-book.json,
 * written by scripts/measure-situations.ts from the real get_theses): every
 * stock's inputs replayed through situationsFor.
 *
 * Each stock gives the list it gave that evening; its first situation carries
 * the needsAction the row carried, unchanged; every plan check is on
 * PLAN_PROBLEM. The principal's words in the fixture are replaced; no rule
 * reads them.
 */
import { readFileSync } from "fs";
import path from "path";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import { situationsFor, type Situation, type StockInput, type BookInput } from "./index";
import { fromFixtureJson } from "./fixture-json";

interface FixtureStock {
  ticker: string;
  analyst: string;
  today: { lead: unknown; planChecks: string[]; listed: boolean };
  situations: Situation[];
  input: { now: Date; book: BookInput; stock: StockInput } | null;
}
const fixture = fromFixtureJson<{ measuredAt: string; stocks: FixtureStock[] }>(
  readFileSync(path.join(__dirname, "__fixtures__/live-book.json"), "utf8"),
);

describe("the live book, 2026-10-07 after the close", () => {
  beforeAll(() => {
    // Research age is counted from the wall clock (staleness.ts).
    jest.useFakeTimers({ now: new Date(fixture.measuredAt) });
  });
  afterAll(() => jest.useRealTimers());

  it("covers the book", () => {
    expect(fixture.stocks.length).toBe(40);
    expect(fixture.stocks.every((s) => s.input != null)).toBe(true);
  });

  it.each(fixture.stocks.map((s) => [`${s.ticker} (${s.analyst})`, s] as const))("%s gives the same list", (_name, s) => {
    const { stock, book, now } = s.input!;
    const list = situationsFor(stock, book, now);
    expect(list).toEqual(s.situations);
    // The lead is the row's needsAction, unchanged; with none, nothing carries a flag.
    const lead = computeNeedsAction(stock.work);
    expect(lead).toEqual(s.today.lead);
    if (lead) expect(list[0].data.flag).toEqual(lead);
    else expect(list.every((x) => x.data.flag === undefined)).toBe(true);
    // Every plan check is on PLAN_PROBLEM.
    const onPlan = (list.find((x) => x.code === "PLAN_PROBLEM")?.data as { codes?: Array<{ kind: string }> } | undefined)?.codes?.map((c) => c.kind) ?? [];
    for (const k of s.today.planChecks) expect(onPlan).toContain(k);
  });
});
