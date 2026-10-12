/**
 * A stored trigger the app can't read, read with the translator gone.
 *
 * Production still holds 16 triggers in an old kind, every one
 * `{ "kind": "REVIEW_DATE_HIT" }` with action REVIEW, every one on a RETIRED
 * thesis (AMD, VERA, DELL, SEDG, RNG, POET, RXT, ADI ×3, HSAI, AMBA, QCOM,
 * CELC, MU, IREN), counted read-only 2026-10-11. The review-date kind was
 * removed in August, and the backfill kept a removed kind as it was stored,
 * so these were never rewritten. No analyst or account list holds one.
 *
 * The fixture is AMD's whole stored list, exactly as the column holds it
 * (2026-10-06): five triggers in the condition shape and the old review-date
 * one. The database client hands the column back as stored, so this is what
 * every reader gets.
 *
 * On main the translator also left this kind as stored, and the save gate
 * refused it ("Not a condition this app can check."), so the read dropped
 * that one trigger and kept the other five. The answer here must be the same:
 * the one trigger goes, by itself, and nothing throws.
 */

// resolveThesisLadder takes the row it is given; the loader's module needs only the import.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import stored from "@/lib/agent/triggers/condition/__fixtures__/amd-retired-review-date-2026-10-06.json";
import { parseTriggersResilient } from "./schema";
import { resolveThesisLadder } from "./load-levels";
import { sentenceOf } from "./condition";

const raw = stored as Array<{ id: string; action: string; predicate: Record<string, unknown> }>;
const REMOVED_ID = "259994f7-b1ca-451c-9b57-f1249a0ae76e";
const others = raw.filter((t) => t.id !== REMOVED_ID);

let errors: jest.SpyInstance;
let warnings: jest.SpyInstance;
beforeEach(() => {
  errors = jest.spyOn(console, "error").mockImplementation(() => {});
  warnings = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
  warnings.mockRestore();
});

describe("AMD (RETIRED): one review-date trigger among five readable ones", () => {
  it("the fixture is the stored list: six triggers, the fourth the old review-date kind", () => {
    expect(raw).toHaveLength(6);
    expect(raw[3]).toMatchObject({ id: REMOVED_ID, action: "REVIEW", predicate: { kind: "REVIEW_DATE_HIT" } });
    expect(others.every((t) => typeof t.predicate.watch === "string")).toBe(true);
  });

  it("the read drops that one trigger, says so once, and keeps the other five as stored", () => {
    const r = parseTriggersResilient(raw);
    expect(r.dropped).toBe(1);
    expect(r.clamped).toBe(0);
    expect(r.triggers.map((t) => t.id)).toEqual(others.map((t) => t.id));
    expect(r.triggers.map((t) => t.predicate)).toEqual(others.map((t) => t.predicate));
    expect(r.triggers.map((t) => t.lastFiredAt ?? null)).toEqual(others.map((t) => (t as { lastFiredAt?: string }).lastFiredAt ?? null));
    // One line for the one trigger, naming the old kind.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls[0])).toContain("REVIEW_DATE_HIT");
  });

  it("the ladder every reader resolves (the trigger check, the sheet, get_theses) is the other five", () => {
    const ladder = resolveThesisLadder({ triggers: raw, status: "RETIRED", horizon: null }, undefined);
    expect(ladder.map((t) => t.id).sort()).toEqual(others.map((t) => t.id).sort());
  });

  it("the words read it as a removed condition, and the others as themselves", () => {
    expect(raw.map((t) => sentenceOf(t))).toEqual([
      "Sell if below $380",
      "Sell if above $460",
      "Buy if above $460",
      "Review if a removed condition",
      "Review if earnings beat any amount",
      "Review if earnings miss 3% or more",
    ]);
  });
});
