/**
 * refusals.test.ts — a run's open refusals, each once.
 *
 * Production, 2026-10-08: four failed trigger runs left 31 open rows from
 * gates that refuse a field since #808 and write no row, so they are history
 * and never listed as a refused call.
 */
import raw from "@/lib/agent/__fixtures__/open-refusals-2026-10-08.json";
import { owedRefusals, type OpenRefusal } from "./refusals";

const rows = (raw.rows as Array<Record<string, unknown>>).map((r, i) => ({ ...r, detail: null, resolvedAt: null, createdAt: new Date(Date.now() - (raw.rows.length - i) * 60_000) }));
const asOpen = (r: Record<string, unknown>) => r as unknown as OpenRefusal;

describe("the refusals the four failed trigger runs left open", () => {
  it("are all history: none is listed", () => {
    expect(rows).toHaveLength(31);
    expect(owedRefusals(rows.map(asOpen))).toEqual([]);
  });
});

describe("identical refusals are listed once, with their count", () => {
  const at = (m: number) => new Date(Date.parse("2026-10-08T14:00:00Z") + m * 60_000);
  const buy = (m: number): OpenRefusal => ({ id: `b${m}`, tool: "place_trade", ticker: "PLTR", thesisId: "t_pltr", summary: "Trade blocked: $PLTR — composite below this analyst's minimum.", detail: null, runId: "r", createdAt: at(m), gateCode: "composite_below_minimum" });
  it("three identical buys refused collapse to one line with the count and the latest date", () => {
    const other: OpenRefusal = { ...buy(5), id: "e", tool: "update_thesis", ticker: "EME", thesisId: "t_eme", summary: "Refused update on $EME — the resulting plan is invalid (missing_enter_trigger).", gateCode: "missing_enter_trigger" };
    const owed = owedRefusals([buy(1), buy(2), other, buy(3)]);
    expect(owed).toHaveLength(2);
    expect(owed.find((r) => r.ticker === "PLTR")).toMatchObject({ count: 3, createdAt: at(3) });
  });
});
