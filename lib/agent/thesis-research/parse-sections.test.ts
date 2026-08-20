/**
 * parse-sections.test.ts — the 9-section note parser. In V2 this parser
 * is load-bearing on the persist path (the server parses the research
 * model's text output and writes the sections straight to the Thesis
 * row), so its shape contract with record/update_thesis's
 * sectionTextSchema / sectionBulletSchema is pinned here.
 */

import {
  parseIntoSections,
  parseCitations,
  citationsFromRaw,
  type ParsedBulletSection,
  type ParsedTextSection,
} from "./parse-sections";

const FULL_NOTE = `## Snapshot
NVDA trades at $100 after a 12% two-week run [STRUCTURED:quote_current].

## Recent Catalysts
Blackwell shipment confirmations moved the stock [WEB:https://example.com/news1].

## Fundamentals
Revenue grew 94% YoY to $35.1B [STRUCTURED:revenue_q3] with 75% gross margin [STRUCTURED:gross_margin].

## Latest Earnings
- Beat consensus EPS by 8% [STRUCTURED:eps_q3]
- DC revenue $30.8B, up 112% YoY [STRUCTURED:dc_revenue]
* Guidance raised to $37.5B [WEB:https://example.com/call]

## Catalysts & Events
1. Q4 earnings on 2026-02-25 [STRUCTURED:next_earnings]
2) GTC keynote March 17 [WEB:https://example.com/gtc]

## Bull Case
- Blackwell ramp ahead of schedule [WEB:https://example.com/bull]
- Hyperscaler capex guides up [STRUCTURED:capex]

## Bear Case
- Concentration: two customers are 39% of revenue [STRUCTURED:concentration]
- Export-control expansion risk [WEB:https://example.com/bear]

## Analyst Consensus
Morgan Stanley raised to $150 on 2026-08-01 [WEB:https://example.com/ms]; consensus PT $142 [STRUCTURED:consensus_pt].

## Insider & Technical
No insider sales in 90 days [STRUCTURED:insider_window]; RSI 61, above the rising 50d [STRUCTURED:rsi14].`;

describe("parseIntoSections — full note round trip", () => {
  const sections = parseIntoSections(FULL_NOTE);

  it("finds all 9 sections", () => {
    expect(Object.keys(sections).sort()).toEqual(
      [
        "analystConsensus",
        "bearCase",
        "bullCase",
        "catalystsAndEvents",
        "fundamentals",
        "insiderTechnical",
        "latestEarnings",
        "recentCatalysts",
        "snapshot",
      ].sort(),
    );
  });

  it("text sections carry {text, citations} (sectionTextSchema shape)", () => {
    const snapshot = sections.snapshot as ParsedTextSection;
    expect(snapshot.text).toContain("NVDA trades at $100");
    expect(snapshot.citations).toEqual(["STRUCTURED:quote_current"]);
    const fundamentals = sections.fundamentals as ParsedTextSection;
    expect(fundamentals.citations).toEqual([
      "STRUCTURED:revenue_q3",
      "STRUCTURED:gross_margin",
    ]);
  });

  it("bullet sections carry {bullets:[{text, citation?}]} (sectionBulletSchema shape)", () => {
    const earnings = sections.latestEarnings as ParsedBulletSection;
    expect(earnings.bullets).toHaveLength(3);
    expect(earnings.bullets[0].text).toContain("Beat consensus EPS");
    expect(earnings.bullets[0].citation).toBe("STRUCTURED:eps_q3");
  });

  it("accepts numbered-list bullets (1. and 2) styles)", () => {
    const catalysts = sections.catalystsAndEvents as ParsedBulletSection;
    expect(catalysts.bullets).toHaveLength(2);
    expect(catalysts.bullets[1].text).toContain("GTC keynote");
  });
});

describe("parseIntoSections — degraded inputs", () => {
  it("returns {} on empty text (synthesis failed)", () => {
    expect(parseIntoSections("")).toEqual({});
  });

  it("skips absent sections without inventing them", () => {
    const partial = parseIntoSections("## Snapshot\nJust a snapshot [STRUCTURED:x].");
    expect(Object.keys(partial)).toEqual(["snapshot"]);
  });

  it("wraps a prose-shaped bullet section as a single fat bullet instead of dropping it", () => {
    const sections = parseIntoSections(
      "## Bull Case\nThe entire bull case as one paragraph with [WEB:https://example.com/only] citation.",
    );
    const bull = sections.bullCase as ParsedBulletSection;
    expect(bull.bullets).toHaveLength(1);
    expect(bull.bullets[0].citation).toBe("WEB:https://example.com/only");
  });

  it("accepts '## Catalysts and Events' / '## Insider and Technical' header variants", () => {
    const sections = parseIntoSections(
      "## Catalysts and Events\n- Dated thing [STRUCTURED:a]\n\n## Insider and Technical\nProse [STRUCTURED:b].",
    );
    expect(sections.catalystsAndEvents).toBeDefined();
    expect(sections.insiderTechnical).toBeDefined();
  });
});

describe("citation helpers", () => {
  it("parseCitations dedupes and preserves order", () => {
    const cites = parseCitations(
      "a [STRUCTURED:x] b [WEB:https://e.com/1] c [STRUCTURED:x]",
    );
    expect(cites).toEqual(["STRUCTURED:x", "WEB:https://e.com/1"]);
  });

  it("citationsFromRaw extracts web domains and tolerates malformed urls", () => {
    const [web, structured, bad] = citationsFromRaw([
      "WEB:https://example.com/path",
      "STRUCTURED:revenue",
      "WEB:not-a-url",
    ]);
    expect(web).toMatchObject({ kind: "web", domain: "example.com" });
    expect(structured).toMatchObject({ kind: "structured", ref: "revenue" });
    expect(bad).toMatchObject({ kind: "web", domain: undefined });
  });
});
