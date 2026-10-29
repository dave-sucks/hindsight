/**
 * Replays from production rows: which notes the Overview shows (2026-10-29),
 * and whether the note shows at all (2026-09-23).
 */
import { recentAnswers, type ActivityRow } from "@/lib/agent/stock-context";
import { isLiveStatus, latestNoteView } from "./latest-note";

// GEV's Activity, 2026-10-27 to 10-29, newest first (text cut to its opening).
const run = (id: string, mode = "INTRADAY_TACTICAL") => ({ runId: id, runMode: mode });
const GEV: ActivityRow[] = [
  { id: "expired-1029", type: "PROPOSAL_EXPIRED", timestamp: new Date("2026-10-29T14:01:16Z"), summary: "CLOSE proposal on GEV expired without user decision", rationale: "The sale of GEV expired without an answer. Its reason: GE Vernova is at $848.12 on Oct." },
  { id: "fire-1029b", type: "TRIGGER_FIRED", timestamp: new Date("2026-10-29T13:55:10Z"), summary: "Review if below 15% from the high since we bought" },
  { id: "note-1029", type: "REVIEWED", timestamp: new Date("2026-10-29T13:45:55Z"), summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is around $883 on Oct. 29 after reporting a strong quarter", ...run("tr-1029") },
  { id: "fire-1029a", type: "TRIGGER_FIRED", timestamp: new Date("2026-10-29T13:45:31Z"), summary: "Sell if below 6% from the high since we bought", ...run("tr-1029") },
  { id: "fire-1028", type: "TRIGGER_FIRED", timestamp: new Date("2026-10-28T18:15:21Z"), summary: "Review if below the 200-day average", rationale: "200-day $941.20; price $884.83 (−6.0% from it)" },
  { id: "expired-1028", type: "PROPOSAL_EXPIRED", timestamp: new Date("2026-10-28T14:00:58Z"), summary: "CLOSE proposal on GEV expired without user decision", rationale: "The sale of GEV expired without an answer." },
  { id: "note-1028b", type: "REVIEWED", timestamp: new Date("2026-10-28T13:41:06Z"), summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is at $848.12 on Oct. 28, so the stock is still below the $868 September base low", ...run("tr-1028") },
  { id: "note-1028a", type: "REVIEWED", timestamp: new Date("2026-10-28T13:40:50Z"), summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is at $848.12 this morning", ...run("tr-1028") },
  { id: "note-1027b", type: "REVIEWED", timestamp: new Date("2026-10-27T13:35:46Z"), summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is at $875.47 on Oct. 27", ...run("tr-1027") },
  { id: "note-1027a", type: "UPDATED", timestamp: new Date("2026-10-27T12:04:46Z"), summary: "Updated GEV thesis", rationale: "GE Vernova closed at $855.12 on Oct. 26", ...run("am-1027", "MORNING_PLAN") },
];

describe("the notes the Overview shows are the notes the agents are handed", () => {
  it("GEV 10-29: today's 9:45 note leads, not the expired sale a quarter hour later", () => {
    expect(recentAnswers(GEV).map((r) => r.id)).toEqual(["note-1029", "note-1028b", "note-1028a"]);
  });

  it("a fire, an expiry, an approval, a decline and your own edit are Activity, not notes", () => {
    const events: ActivityRow[] = [
      { type: "TRIGGER_FIRED", timestamp: new Date("2026-10-29T15:00:00Z"), summary: "Sell if below $868", ...run("tr") },
      { type: "PROPOSAL_EXPIRED", timestamp: new Date("2026-10-29T15:01:00Z"), summary: "CLOSE proposal expired" },
      { type: "PROPOSAL_APPROVED", timestamp: new Date("2026-10-29T15:02:00Z"), summary: "Approved CLOSE" },
      { type: "PROPOSAL_REJECTED", timestamp: new Date("2026-10-29T15:03:00Z"), summary: "Rejected CLOSE" },
      { type: "UPDATED", timestamp: new Date("2026-10-29T15:04:00Z"), summary: "Set by hand", fieldChanges: { source: { from: null, to: "USER" } } },
      { type: "NOTE", timestamp: new Date("2026-10-29T15:05:00Z"), summary: "Your note", rationale: "Holding through earnings." },
    ];
    expect(recentAnswers([...events, ...GEV]).map((r) => r.id)).toEqual(["note-1029", "note-1028b", "note-1028a"]);
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
