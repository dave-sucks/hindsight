import { EXAMPLE_LINE, LINE_KEYS, READ_CASES, SHEET_FIELDS, WRITER_KEYS, fieldsLit } from "@/lib/docs/framework-content";
import { buildFrameworkRead, readKeys } from "@/lib/docs/read-grid";
import { ROW_FIELDS } from "@/lib/agent/row-for-model";

const sheetKeys = new Set(SHEET_FIELDS.flatMap((f) => [...f.keys]));

describe("the framework's read section follows row-for-model.ts", () => {
  it("every field of the row is carried by a sheet field; the line's and the writer's keys too", () => {
    for (const f of ROW_FIELDS) expect([f.key, sheetKeys.has(f.key)]).toEqual([f.key, true]);
    for (const k of [...LINE_KEYS, ...WRITER_KEYS]) expect([k, sheetKeys.has(k)]).toEqual([k, true]);
  });
  it("the reads are distinct, each bigger than the last: the line, the row, the row with what a read can ask for", () => {
    const keys = readKeys();
    expect(fieldsLit(keys.row).size).toBeGreaterThan(fieldsLit(keys.line).size);
    expect(fieldsLit(keys.full).size).toBeGreaterThan(fieldsLit(keys.row).size);
    expect(keys.full.filter((k) => !keys.row.includes(k))).toEqual(["bull_case", "bear_case", "snapshot", "history"]);
    expect(READ_CASES.map((c) => c.id)).toEqual(["line", "row", "full", "writer"]);
  });
  it("the page's example line and its samples are what the builder makes of the CRWD row, never hand-written", () => {
    const { keys, samples } = buildFrameworkRead();
    expect(samples.line).toBe(EXAMPLE_LINE);
    const printed = (sample: string) => sample.split("\n").map((l) => l.match(/^([a-zA-Z_]+): /)?.[1]).filter((k): k is string => !!k && keys.full.includes(k));
    // Every key a sample prints is one the read says it sends.
    for (const k of printed(samples.row)) expect(["row", k, keys.row.includes(k)]).toEqual(["row", k, true]);
    expect(samples.row).toMatch(/^street: .*avg \$/m);
    expect(samples.row).toMatch(/^assumptions: /m);
    expect(samples.row).not.toMatch(/^(bull_case|bear_case|snapshot|history): /m);
    expect(samples.full).toMatch(/^bull_case: /m);
  });
});
