/**
 * citations.test.ts — a link whose text is a site's name is a source citation
 * (lib/citations.ts). The link shapes are the Market Reviewer's own, from its
 * 2026-11-13 notes and digest.
 */
import { citedSegments, isSourceLink, unwrapSourceLinks } from "./citations";

const CEG = "https://www.constellationenergy.com/news/2026/11/constellation-reports-third-quarter-2026-results.html?utm_source=openai";
const NOTE = `the AI-power narrative. ([constellationenergy.com](${CEG}))`;

describe("source links", () => {
  it("a site's name over a web page is a source; prose or an app link is not", () => {
    expect(isSourceLink("constellationenergy.com", CEG)).toBe(true);
    expect(isSourceLink("au.investing.com", "https://au.investing.com/news/x")).toBe(true);
    expect(isSourceLink("the Q3 release", CEG)).toBe(false);
    expect(isSourceLink("NVDA", "thesis://abc")).toBe(false);
    expect(isSourceLink("example.com", undefined)).toBe(false);
  });

  it("takes the parentheses off a citation, and leaves a prose link's alone", () => {
    expect(unwrapSourceLinks(NOTE)).toBe(`the AI-power narrative. [constellationenergy.com](${CEG})`);
    const two = "([sec.gov](https://www.sec.gov/a), [apnews.com](https://apnews.com/b))";
    expect(unwrapSourceLinks(two)).toBe("[sec.gov](https://www.sec.gov/a), [apnews.com](https://apnews.com/b)");
    const prose = "(see [the filing](https://www.sec.gov/a))";
    expect(unwrapSourceLinks(prose)).toBe(prose);
  });

  it("splits a note's plain text into its words and its sources, in order", () => {
    expect(citedSegments(NOTE)).toEqual([
      { kind: "text", text: "the AI-power narrative. " },
      { kind: "source", url: CEG, text: "constellationenergy.com" },
    ]);
    expect(citedSegments("No links here.")).toEqual([{ kind: "text", text: "No links here." }]);
  });
});
