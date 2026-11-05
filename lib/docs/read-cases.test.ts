import { readFileSync } from "node:fs";
import { EXAMPLE_LINE, READ_CASES, SHEET_FIELDS, fieldsLit } from "@/lib/docs/framework-content";
import { CRWD_ROW, buildReadSamples } from "@/lib/docs/read-sample";
import { rowForModel as buildRow } from "@/lib/agent/row-for-model";

const rowForModel = readFileSync("lib/agent/row-for-model.ts", "utf8");
const puts = new Set([...rowForModel.matchAll(/put\("([A-Za-z_]+)"/g)].map((m) => m[1]));
const sections = ["recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical", "researchData"];

describe("the framework's read cases follow row-for-model.ts", () => {
  it("every key a read sends is a key the row puts, a section, or the writer's block", () => {
    for (const c of READ_CASES) for (const k of c.keys) expect([c.id, k, puts.has(k) || sections.includes(k)]).toEqual([c.id, k, true]);
  });
  it("the short row's case names every key the row puts, less the full row's", () => {
    const short = READ_CASES.find((c) => c.id === "short")!;
    const fullOnly = new Set(["history", "score_notes", ...sections]);
    for (const k of puts) if (!fullOnly.has(k) && k !== "setup_lines") expect([k, short.keys.includes(k)]).toEqual([k, true]);
  });
  it("every sheet field is carried by at least one read, except the ones kept for old rows", () => {
    const litByAny = new Set(READ_CASES.flatMap((c) => [...fieldsLit(c)]));
    for (const f of SHEET_FIELDS) expect([f.id, litByAny.has(f.id)]).toEqual([f.id, true]);
  });
  it("the reads are distinct", () => {
    const sets = READ_CASES.map((c) => [...c.keys].sort().join(","));
    expect(new Set(sets).size).toBe(READ_CASES.length);
  });
  it("the page's example line and its samples are what the builder makes of the CRWD row, never hand-written", () => {
    expect(buildRow(CRWD_ROW, { named: false, size: "line" })).toBe(EXAMPLE_LINE);
    const samples = buildReadSamples();
    for (const c of READ_CASES) {
      if (c.size === "writer") continue;
      const sample = samples[c.id];
      expect([c.id, typeof sample]).toEqual([c.id, "string"]);
      // Every key the sample prints is one the case says it sends.
      const printed = sample.split("\n").map((l) => l.match(/^([a-zA-Z_]+): /)?.[1]).filter((k): k is string => !!k && puts.has(k));
      for (const k of printed) expect([c.id, k, c.keys.includes(k)]).toEqual([c.id, k, true]);
    }
    expect(samples.short).toContain("room to the Street average");
    expect(samples.short).not.toMatch(/^plan: |^protection: /m);
  });
});
