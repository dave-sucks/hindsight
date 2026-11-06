import { readFileSync } from "node:fs";
import { EXAMPLE_LINE, LINE_KEYS, READ_CASES, SHEET_FIELDS, WRITER_KEYS, fieldsLit } from "@/lib/docs/framework-content";
import { buildFrameworkRead, readGrid, readKeys } from "@/lib/docs/read-grid";
import { CRWD_ROW } from "@/lib/docs/read-sample";
import { ROW_FIELDS, rowForModel as buildRow } from "@/lib/agent/row-for-model";

const rowForModel = readFileSync("lib/agent/row-for-model.ts", "utf8");
// Every `put("…")`, plus the research sections the full row puts in a loop.
const sections = [...(rowForModel.match(/const RESEARCH_SECTIONS = \[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
const puts = new Set([...[...rowForModel.matchAll(/put\("([A-Za-z_]+)"/g)].map((m) => m[1]), ...sections]);
const sheetKeys = new Set(SHEET_FIELDS.flatMap((f) => [...f.keys]));

describe("the framework's read section follows row-for-model.ts", () => {
  it("every key the row puts is in the field map, and every key in the map is put", () => {
    for (const k of puts) expect([k, k in ROW_FIELDS]).toEqual([k, true]);
    for (const k of Object.keys(ROW_FIELDS)) expect([k, puts.has(k)]).toEqual([k, true]);
  });
  it("every key the map sends is carried by a sheet field, except the conviction rule's note; the line's and the writer's keys too", () => {
    for (const k of Object.keys(ROW_FIELDS)) if (k !== "note") expect([k, sheetKeys.has(k)]).toEqual([k, true]);
    for (const k of [...LINE_KEYS, ...WRITER_KEYS]) expect([k, sheetKeys.has(k)]).toEqual([k, true]);
  });
  it("every sheet field has a row in the grid, and the grid's four answers cover the sheet", () => {
    const grid = readGrid();
    expect(grid.map((g) => g.fieldId)).toEqual(SHEET_FIELDS.map((f) => f.id));
    const when = Object.fromEntries(grid.map((g) => [g.fieldId, g.when]));
    expect(when.stock).toBe("always");
    expect(when.triggers).toBe("always");
    expect(when.bull_case).toBe("review");
    expect(when.history).toBe("named");
    expect(when.chart).toBe("situations");
    expect(grid.find((g) => g.fieldId === "would_prove_it_wrong")!.situations.map((s) => s.code)).toContain("PROTECTIVE_SALE");
  });
  it("the reads are distinct, and each one lights at least the line's fields", () => {
    const keys = readKeys();
    const sets = [keys.line, keys.review, keys.named, keys.writer, keys.bySituation.PROTECTIVE_SALE].map((k) => [...k].sort().join(","));
    expect(new Set(sets).size).toBe(sets.length);
    expect(fieldsLit(keys.review).size).toBeGreaterThan(fieldsLit(keys.bySituation.PROTECTIVE_SALE).size);
    expect(fieldsLit(keys.named).size).toBeGreaterThan(fieldsLit(keys.review).size);
    for (const c of READ_CASES) expect(c.id).toBeDefined();
  });
  it("the page's example line and its samples are what the builder makes of the CRWD row, never hand-written", () => {
    expect(buildRow(CRWD_ROW, { named: false, size: "line" })).toBe(EXAMPLE_LINE);
    const { keys, samples } = buildFrameworkRead();
    const printed = (sample: string) => sample.split("\n").map((l) => l.match(/^([a-zA-Z_]+): /)?.[1]).filter((k): k is string => !!k && puts.has(k));
    // Every key a sample prints is one the read says it sends.
    for (const k of printed(samples.review)) expect(["review", k, keys.review.includes(k)]).toEqual(["review", k, true]);
    for (const k of printed(samples.named)) expect(["named", k, keys.named.includes(k)]).toEqual(["named", k, true]);
    for (const code of Object.keys(samples.bySituation)) {
      for (const k of printed(samples.bySituation[code])) expect([code, k, keys.bySituation[code].includes(k)]).toEqual([code, k, true]);
    }
    expect(samples.bySituation.BUY_ARRIVES).toContain("room to the Street average");
    expect(samples.bySituation.PROTECTIVE_SALE).not.toMatch(/^(street|bull_case|chart): /m);
    expect(samples.review).toMatch(/^bull_case: /m);
    expect(samples.review).not.toMatch(/^plan: |^protection: /m);
  });
});
