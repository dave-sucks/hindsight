jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { casesText } from "./book";

describe("what each thesis rests on", () => {
  it("lists a stock once, the held one, with its KPIs; a stock with none is left out", () => {
    const text = casesText([
      { ticker: "ceg", status: "WATCHING", kpis: ["a watch's line"] },
      { ticker: "CEG", status: "HOLDING", kpis: ["Nuclear contracts: on track at 500 MW+ a quarter, broken under 300 MW for two quarters. Read at each report [STRUCTURED:filings]", "Guidance: broken by a cut at any report."] },
      { ticker: "AAOI", status: "WATCHING", kpis: [] },
    ]);
    expect(text).toBe(
      "## What each thesis rests on\n- CEG\n  - Nuclear contracts: on track at 500 MW+ a quarter, broken under 300 MW for two quarters. Read at each report\n  - Guidance: broken by a cut at any report.",
    );
  });

  it("says so when nothing is written", () => {
    expect(casesText([])).toBe("## What each thesis rests on\n- none written");
  });
});
