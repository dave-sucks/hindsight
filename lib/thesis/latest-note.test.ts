/**
 * Replays of what the sheet actually showed on 2026-09-23, from production rows.
 */
import {
  HERO_UPDATE_TYPES,
  isHeroUpdateType,
  isLiveStatus,
  latestNoteView,
} from "./latest-note";

describe("which note leads the sheet", () => {
  it("skips the templated trigger event — FIVE and IOT both led with one", () => {
    // FIVE: "Trigger: Down 12% from entry", 3h old, while the analyst's sell
    // argument ("I'm selling $FIVE because it has broken the price support…")
    // sat one row below. IOT: "Trigger: Price below $41.4".
    expect(isHeroUpdateType("TRIGGER_FIRED")).toBe(false);
  });

  it("skips the order receipt — SMMT's newest note is an idempotency key", () => {
    // "Approved CLOSE on SMMT — submitted to Alpaca (idem=63d4c566)".
    // 22 PROPOSAL_APPROVED rows in 45 days, none with a write-up.
    expect(isHeroUpdateType("PROPOSAL_APPROVED")).toBe(false);
  });

  it("keeps every type an analyst actually writes prose into", () => {
    // 45-day production averages: UPDATED 663 chars (98% unique), CREATED 811,
    // SUPERSEDED 781, INVALIDATED 597, CLOSED 493, REVIEWED 414.
    for (const t of ["UPDATED", "REVIEWED", "CREATED", "CLOSED", "INVALIDATED", "SUPERSEDED"]) {
      expect(isHeroUpdateType(t)).toBe(true);
    }
  });

  it("the eligible set carries no duplicates", () => {
    expect(new Set(HERO_UPDATE_TYPES).size).toBe(HERO_UPDATE_TYPES.length);
  });
});

describe("whether the note shows at all", () => {
  const base = { hasNote: true, hasReasons: false, quoteLoading: false, quoteFailed: false };

  // The regression: 163 sold, 172 passed and 363 replaced theses lost their
  // note. The terminal banner that justified it renders for neither SOLD nor
  // PASSED nor REPLACED.
  it.each(["RETIRED", "PASSED"])("a %s stock still shows its note", (status) => {
    const view = latestNoteView({ ...base, status });
    expect(view).not.toBeNull();
    expect(view!.showNote).toBe(true);
  });

  it("SMMT — sold 2026-09-21 — shows the write-up, with no work flags", () => {
    expect(latestNoteView({ ...base, status: "RETIRED" })).toEqual({
      showNote: true,
      flags: "hidden",
    });
  });

  it("never claims a sold stock is unflagged, even with flags computed", () => {
    const view = latestNoteView({ ...base, status: "RETIRED", hasReasons: true });
    expect(view!.flags).toBe("hidden");
  });

  it("IOT — held, a trigger unanswered — shows the note and the flags", () => {
    expect(latestNoteView({ ...base, status: "HOLDING", hasReasons: true })).toEqual({
      showNote: true,
      flags: "reasons",
    });
  });

  it("a live stock with nothing flagged says so", () => {
    expect(latestNoteView({ ...base, status: "WATCHING" })!.flags).toBe("none");
  });

  it("a failed price says it could not check, rather than 'nothing flagged'", () => {
    expect(latestNoteView({ ...base, status: "HOLDING", quoteFailed: true })!.flags).toBe(
      "unchecked",
    );
  });

  it("renders nothing when there is no note and nothing honest to say", () => {
    expect(latestNoteView({ ...base, hasNote: false, status: "RETIRED" })).toBeNull();
    expect(
      latestNoteView({ ...base, hasNote: false, status: "HOLDING", quoteFailed: true }),
    ).toBeNull();
  });

  it("a loading price never resolves to 'nothing flagged'", () => {
    expect(latestNoteView({ ...base, status: "HOLDING", quoteLoading: true })!.flags).toBe(
      "loading",
    );
  });

  it("only the three actionable statuses are live", () => {
    expect(["WATCHING", "HOLDING", "PROMOTED"].every(isLiveStatus)).toBe(true);
    expect(["RETIRED", "PASSED"].some(isLiveStatus)).toBe(false);
  });
});
