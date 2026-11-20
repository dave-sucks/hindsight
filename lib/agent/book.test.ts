jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { casesText } from "./book";

describe("what each thesis rests on", () => {
  it("lists a stock once, the held one, with its assumptions and what would prove it wrong; a stock with neither is left out", () => {
    const text = casesText([
      { ticker: "ceg", status: "WATCHING", assumptions: ["a watch's line"], wouldProveItWrong: [] },
      { ticker: "CEG", status: "HOLDING", assumptions: ["At least 500 MW contracted a quarter, checked at each report [STRUCTURED:filings]"], wouldProveItWrong: ["A guidance cut at any report"] },
      { ticker: "AAOI", status: "WATCHING", assumptions: [], wouldProveItWrong: [] },
    ]);
    expect(text).toBe(
      "## What each thesis rests on\n- CEG\n  - Must stay true: At least 500 MW contracted a quarter, checked at each report\n  - Would prove it wrong: A guidance cut at any report",
    );
  });

  it("says so when nothing is written", () => {
    expect(casesText([])).toBe("## What each thesis rests on\n- none written");
  });
});
