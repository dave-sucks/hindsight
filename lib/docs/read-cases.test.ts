import { readFileSync } from "node:fs";
import { READ_CASES, SHEET_FIELDS, fieldsLit } from "@/lib/docs/framework-content";

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
});
