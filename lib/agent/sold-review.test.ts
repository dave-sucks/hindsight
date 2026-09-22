/**
 * sold-review.test.ts — SMMT, replayed from the real row (DAV-240).
 *
 * Thesis cmtc1kp7o000l04ikm6kf9h1b, position cmtiwz2ua000704l7l0z60jfl.
 * Sold 2026-09-21 15:18:44Z at $16.9232 for +$1,157.94 (+17.9%) on a
 * protective stop, eight weeks before the November 14 PDUFA it was bought
 * for. status RETIRED, retiredReason SOLD, horizon CATALYST, catalystDate
 * 2026-11-14 — still ahead. Nothing watched it.
 *
 * The two rows that landed after the close (CLOSED at .537, PROPOSAL_APPROVED
 * at .852) are the close's own bookkeeping, not an answer — which is exactly
 * the trap a naive "any update since the close" check falls into.
 */
import { soldReview } from "./sold-review";

const SMMT = {
  ticker: "SMMT",
  status: "RETIRED",
  retiredReason: "SOLD",
  closedAt: new Date("2026-09-21T15:18:44.281Z"),
  closeReason: "STOP",
  exitPrice: 16.9232,
  realizedPnl: 1157.94,
  realizedPnlPct: 17.93,
  beliefSurvived: null,
  catalystDate: new Date("2026-11-14T00:00:00Z"),
  answered: false,
  now: new Date("2026-09-22T12:00:00Z"),
};

describe("SMMT — the one look a sold stock gets", () => {
  const r = soldReview(SMMT)!;

  it("is on the next run's list with the sale's own numbers", () => {
    expect(r.soldOn).toBe("2026-09-21");
    expect(r.daysAgo).toBe(0);
    expect(r.text).toContain("Sold today at $16.92 for +$1,158 (+17.9%) on a stop.");
  });

  it("says nobody attested whether the belief survived", () => {
    expect(r.text).toContain("Nobody said whether the belief survived the exit.");
  });

  it("names the catalyst it was bought for and still has ahead", () => {
    expect(r.text).toContain("Its catalyst is still ahead — 2026-11-14.");
  });

  it("offers the four answers the run already has, and refuses nothing", () => {
    expect(r.text).toContain("keep watching with a re-entry level");
    expect(r.text).toContain("keep watching on a review cadence");
    expect(r.text).toContain("keep watching with nothing set");
    expect(r.text).toContain("let it go");
    expect(r.text).toContain('update_thesis(change_status: "WATCHING")');
  });
});

describe("what clears it, and what never raises it", () => {
  it("a run that answered — any review, update or status change after the close", () => {
    expect(soldReview({ ...SMMT, answered: true })).toBeNull();
  });

  it("a sale older than the window is not this run's question", () => {
    expect(soldReview({ ...SMMT, now: new Date("2026-10-10T12:00:00Z") })).toBeNull();
    // 14 days to the hour is still in.
    expect(soldReview({ ...SMMT, now: new Date("2026-10-05T12:00:00Z") })).not.toBeNull();
  });

  it("a dropped or invalidated thesis is not a sale", () => {
    expect(soldReview({ ...SMMT, retiredReason: "DROPPED" })).toBeNull();
    expect(soldReview({ ...SMMT, retiredReason: "INVALIDATED" })).toBeNull();
  });

  it("a live thesis is not a sale", () => {
    expect(soldReview({ ...SMMT, status: "WATCHING", retiredReason: null })).toBeNull();
    expect(soldReview({ ...SMMT, status: "HOLDING", retiredReason: null })).toBeNull();
  });
});

describe("the sale's facts, in the shapes they come in", () => {
  it("an attested belief-survived exit says so", () => {
    expect(soldReview({ ...SMMT, beliefSurvived: true })!.text).toContain(
      "The closing agent said the belief survived the exit.",
    );
  });

  it("a broken belief says that instead", () => {
    expect(soldReview({ ...SMMT, beliefSurvived: false })!.text).toContain(
      "The closing agent said the belief was broken.",
    );
  });

  it("a loss reads as a loss", () => {
    expect(
      soldReview({ ...SMMT, realizedPnl: -412.5, realizedPnlPct: -8.2 })!.text,
    ).toContain("Sold today at $16.92 for −$413 (−8.2%) on a stop.");
  });

  it("a catalyst already past is not called ahead", () => {
    expect(
      soldReview({ ...SMMT, catalystDate: new Date("2026-08-01T00:00:00Z") })!.text,
    ).not.toContain("catalyst is still ahead");
  });

  it("a sale with no position numbers still asks the question", () => {
    const bare = soldReview({
      ...SMMT,
      exitPrice: null,
      realizedPnl: null,
      realizedPnlPct: null,
      closeReason: null,
      catalystDate: null,
    })!;
    expect(bare.text).toContain("Sold today.");
    expect(bare.text).toContain("let it go");
  });

  it("yesterday and older read in days", () => {
    expect(soldReview({ ...SMMT, now: new Date("2026-09-23T12:00:00Z") })!.text).toContain("Sold yesterday");
    expect(soldReview({ ...SMMT, now: new Date("2026-09-26T12:00:00Z") })!.text).toContain("Sold 4 days ago");
  });
});
