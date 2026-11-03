/**
 * parse-sections.test.ts — the Writer's note parser: three sections. The
 * parser is load-bearing on the persist path (the server parses the model's
 * text and writes the sections straight to the Thesis row), so its shape
 * contract with record/update_thesis's sectionTextSchema /
 * sectionBulletSchema is pinned here.
 */

import {
  parseIntoSections,
  parseCitations,
  citationsFromRaw,
  type ParsedBulletSection,
  type ParsedTextSection,
} from "./parse-sections";

const FULL_NOTE = `## Company
Nvidia designs the chips most AI data centers run on and sells them to the big cloud companies [STRUCTURED:profile]. Revenue is hardware, growing with their capex [STRUCTURED:revenue_q3].

## Bull Case
- Blackwell ramp ahead of schedule [WEB:https://example.com/bull]
- Hyperscaler capex guides up [STRUCTURED:capex]
* Guidance raised to $37.5B [WEB:https://example.com/call]

## Bear Case
1. Concentration: two customers are 39% of revenue [STRUCTURED:concentration]
2) Export-control expansion risk [WEB:https://example.com/bear]`;

describe("parseIntoSections — full note round trip", () => {
  const sections = parseIntoSections(FULL_NOTE);

  it("finds all 3 sections", () => {
    expect(Object.keys(sections).sort()).toEqual(["bearCase", "bullCase", "company"]);
  });

  it("the company section carries {text, citations} (sectionTextSchema shape)", () => {
    const company = sections.company as ParsedTextSection;
    expect(company.text).toContain("Nvidia designs the chips");
    expect(company.citations).toEqual(["STRUCTURED:profile", "STRUCTURED:revenue_q3"]);
  });

  it("bullet sections carry {bullets:[{text, citation?}]} (sectionBulletSchema shape)", () => {
    const bull = sections.bullCase as ParsedBulletSection;
    expect(bull.bullets).toHaveLength(3);
    expect(bull.bullets[0].text).toContain("Blackwell ramp");
    expect(bull.bullets[0].citation).toBe("WEB:https://example.com/bull");
  });

  it("accepts numbered-list bullets (1. and 2) styles)", () => {
    const bear = sections.bearCase as ParsedBulletSection;
    expect(bear.bullets).toHaveLength(2);
    expect(bear.bullets[1].text).toContain("Export-control");
  });
});

describe("parseIntoSections — degraded inputs", () => {
  it("returns {} on empty text (synthesis failed)", () => {
    expect(parseIntoSections("")).toEqual({});
  });

  it("skips absent sections without inventing them", () => {
    const partial = parseIntoSections("## Company\nJust the company line [STRUCTURED:x].");
    expect(Object.keys(partial)).toEqual(["company"]);
  });

  it("wraps a prose-shaped bullet section as a single fat bullet instead of dropping it", () => {
    const sections = parseIntoSections(
      "## Bull Case\nThe entire bull case as one paragraph with [WEB:https://example.com/only] citation.",
    );
    const bull = sections.bullCase as ParsedBulletSection;
    expect(bull.bullets).toHaveLength(1);
    expect(bull.bullets[0].citation).toBe("WEB:https://example.com/only");
  });

  it("an old nine-section note yields only the three sections kept", () => {
    const sections = parseIntoSections(
      "## Snapshot\nOld paragraph [STRUCTURED:a].\n\n## Fundamentals\nOld [STRUCTURED:b].\n\n## Bear Case\n- Risk [STRUCTURED:c]",
    );
    expect(Object.keys(sections)).toEqual(["bearCase"]);
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
