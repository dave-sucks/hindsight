/**
 * refusal-carryover.owed.test.ts — "Blocked last time" carries only what is
 * still owed, each refusal once.
 *
 * Production, 2026-10-08: the PEAD Specialist's morning prompt opened with 20
 * lines of refusals from its failed NVDA and MU trigger runs, NVDA's
 * direction refusal ten times over ("call record_thesis…", a tool the morning
 * run doesn't have); the Secular Compounder's carried CEG's eleven. Those
 * gates refuse a field since #808 and write no row, so the rows can never
 * recur and must not be owed.
 */
import raw from "@/lib/agent/__fixtures__/open-refusals-2026-10-08.json";
import { prismaDouble, type Row } from "@/lib/replay";
import { blockedLastTimeSection, describeRefusal, owedRefusals, refusalLinesFor, type OpenRefusal } from "./refusal-carryover";

// Recent, so a seven-day window keeps them all whatever day the suite runs.
const rows = (raw.rows as Array<Record<string, unknown>>).map((r, i) => ({ ...r, detail: null, resolvedAt: null, createdAt: new Date(Date.now() - (raw.rows.length - i) * 60_000) }));
const asOpen = (r: Record<string, unknown>) => r as unknown as OpenRefusal;

describe("the refusals the four failed trigger runs left open", () => {
  it("are all history: nothing is owed and the section is empty", () => {
    expect(rows).toHaveLength(31);
    expect(owedRefusals(rows.map(asOpen))).toEqual([]);
    expect(blockedLastTimeSection(owedRefusals(rows.map(asOpen)))).toBe("");
    expect(refusalLinesFor(owedRefusals(rows.map(asOpen)), "cmtg9nbdy000204jpc6cwawgg", "NVDA")).toBe("");
  });

  it("the analyst's listing drops them where it reads them", async () => {
    let listed: OpenRefusal[] = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: prismaDouble({ gateRejection: rows as Row[] }) }));
      const { listOpenRefusalsForAnalyst } = await import("./gate-rejections");
      listed = await listOpenRefusalsForAnalyst("cmnhxpjio000004jvox6kl6c7", 7);
    });
    expect(listed).toEqual([]);
  });
});

describe("a refusal still owed is told once, with its count", () => {
  const at = (m: number) => new Date(Date.parse("2026-10-08T14:00:00Z") + m * 60_000);
  const buy = (m: number): OpenRefusal => ({ id: `b${m}`, tool: "place_trade", ticker: "PLTR", thesisId: "t_pltr", summary: "Trade blocked: $PLTR — composite below this analyst's minimum.", detail: null, runId: "r", createdAt: at(m), gateCode: "composite_below_minimum" });
  it("three identical buys refused collapse to one line with the count and the latest date", () => {
    const other: OpenRefusal = { ...buy(5), id: "e", tool: "update_thesis", ticker: "EME", thesisId: "t_eme", summary: "Refused update on $EME — the resulting plan is invalid (missing_enter_trigger).", gateCode: "missing_enter_trigger" };
    const owed = owedRefusals([buy(1), buy(2), other, buy(3)]);
    expect(owed).toHaveLength(2);
    const pltr = owed.find((r) => r.ticker === "PLTR")!;
    expect(pltr).toMatchObject({ count: 3, createdAt: at(3) });
    expect(describeRefusal(pltr)).toBe("Buy on $PLTR (place_trade) — refused (3 times): Trade blocked: $PLTR — composite below this analyst's minimum.");
    expect(blockedLastTimeSection(owed).split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2);
  });
});
