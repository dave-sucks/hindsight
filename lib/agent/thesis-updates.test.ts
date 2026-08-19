/**
 * thesis-updates.test.ts — pins the fieldChanges diff builder + compaction.
 *
 * Context (GAPS P2 audit hole, prerequisite for P1-33): after the PR-9 flat
 * schema migration, update_thesis diffed the LEGACY column names while the
 * patch wrote the new keys — 47% of UPDATED rows landed with an empty
 * fieldChanges. These tests pin the two pure helpers so the timeline's
 * source data can't silently regress again:
 *   - diffThesisFields: only actually-changed keys appear, with from/to
 *   - compactDiffValue / compactFieldChanges: bulky research sections are
 *     stored as short previews; scalars and trigger arrays keep exact values
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  diffThesisFields,
  compactDiffValue,
  compactFieldChanges,
  type ThesisFieldChanges,
} from "./thesis-updates";

describe("diffThesisFields", () => {
  it("captures a scalar change with exact from/to", () => {
    const out = diffThesisFields(
      { targetPrice: 80, stopLoss: 54 },
      { targetPrice: 95, stopLoss: 54 },
      ["targetPrice", "stopLoss"],
    );
    expect(out).toEqual({ targetPrice: { from: 80, to: 95 } });
  });

  it("captures flat-schema narrative keys (the PR-9 regression case)", () => {
    // Pre-fix, `snapshot` wasn't in the diff list at all — a rewritten
    // snapshot produced fieldChanges {}.
    const out = diffThesisFields(
      { snapshot: { text: "old view", citations: [] } },
      { snapshot: { text: "new view", citations: [] } },
      ["snapshot"],
    );
    expect(out.snapshot).toEqual({
      from: { text: "old view", citations: [] },
      to: { text: "new view", citations: [] },
    });
  });

  it("returns {} when nothing in the field list moved", () => {
    const same = { scoring: { composite: 7 }, targetPrice: 80 };
    expect(
      diffThesisFields(same, { ...same }, ["scoring", "targetPrice"]),
    ).toEqual({});
  });

  it("records undefined→value as from: null", () => {
    const out = diffThesisFields({}, { retiredReason: "DROPPED" }, [
      "retiredReason",
    ]);
    expect(out.retiredReason).toEqual({ from: null, to: "DROPPED" });
  });
});

describe("compactDiffValue", () => {
  it("passes small strings and objects through untouched", () => {
    expect(compactDiffValue("short")).toBe("short");
    const small = { composite: 7, note: "ok" };
    expect(compactDiffValue(small)).toBe(small);
  });

  it("truncates oversized strings", () => {
    const long = "x".repeat(500);
    const out = compactDiffValue(long) as string;
    expect(out.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("reduces { text } narrative shapes to their text", () => {
    expect(
      compactDiffValue({ text: "the snapshot prose", citations: [1, 2] }),
    ).toBe("the snapshot prose");
  });

  it("reduces bullet sections to a count + first-line preview", () => {
    const out = compactDiffValue({
      bullets: [{ text: "NDA on track" }, { text: "cash runway solid" }],
    });
    expect(out).toBe("2 bullets — NDA on track");
  });

  it("truncates oversized arbitrary objects to a JSON preview", () => {
    const big = { blob: "y".repeat(500) };
    const out = compactDiffValue(big) as string;
    expect(typeof out).toBe("string");
    expect(out.length).toBeLessThanOrEqual(161);
  });

  it("maps null/undefined to null", () => {
    expect(compactDiffValue(null)).toBeNull();
    expect(compactDiffValue(undefined)).toBeNull();
  });
});

describe("compactFieldChanges", () => {
  it("compacts only the named bulky keys, leaving scalars exact", () => {
    const fc: ThesisFieldChanges = {
      targetPrice: { from: 80, to: 95 },
      fundamentals: {
        from: { bullets: [{ text: "a".repeat(300) }] },
        to: { bullets: [{ text: "b".repeat(300) }, { text: "c" }] },
      },
    };
    const out = compactFieldChanges(fc, ["fundamentals"]);
    // Scalar untouched — the timeline renders these numbers directly.
    expect(out.targetPrice).toEqual({ from: 80, to: 95 });
    // Bulky section reduced to previews.
    expect(typeof out.fundamentals.from).toBe("string");
    expect(typeof out.fundamentals.to).toBe("string");
    expect(String(out.fundamentals.to)).toContain("2 bullets");
  });

  it("does not invent entries for bulky keys that didn't change", () => {
    const fc: ThesisFieldChanges = { stopLoss: { from: 54, to: 62 } };
    const out = compactFieldChanges(fc, ["fundamentals", "snapshot"]);
    expect(out).toEqual(fc);
  });
});
