/**
 * Whether the Overview's flag line shows at all (2026-09-23). Which lines the
 * Overview shows is the feed's rule, tested in activity-feed.test.ts.
 */
import { isLiveStatus, latestNoteView } from "./latest-note";

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
