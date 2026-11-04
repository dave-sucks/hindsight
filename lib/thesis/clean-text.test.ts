import { stripCitationTags } from "@/lib/thesis/clean-text";
import { stripSourceTags } from "@/lib/agent/row-for-model";

// IOT's bear case as the Writer stored it on 2026-11-03: the tag inline, the lead in bold.
const iot =
  "**Stock is 13% below the 52-week high and volume is running below average.** [STRUCTURED: Price structure — volume last session 0.85× its 20-day average; up-day ÷ down-day volume ratio 0.89 over 20 days] Sellers have been more active than buyers.";

describe("the page's text cleaner", () => {
  it("removes the citation tags and keeps the bold markers for the page to draw", () => {
    expect(stripCitationTags(iot)).toBe(
      "**Stock is 13% below the 52-week high and volume is running below average.** Sellers have been more active than buyers.",
    );
  });
  it("removes a web tag too and collapses the space it leaves", () => {
    expect(stripCitationTags("Targets moved to $51–$58. [WEB:https://example.com/a] Next print December 3.")).toBe(
      "Targets moved to $51–$58. Next print December 3.",
    );
  });
  it("leaves plain prose alone", () => {
    expect(stripCitationTags("ARR grew 30%.")).toBe("ARR grew 30%.");
  });
});

describe("the agents' row cleaner", () => {
  it("removes the tags and the bold markers both", () => {
    expect(stripSourceTags(iot)).toBe(
      "Stock is 13% below the 52-week high and volume is running below average. Sellers have been more active than buyers.",
    );
  });
});
