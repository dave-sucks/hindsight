/**
 * earnings-date.replay.test.ts — DAV-293, replayed from the real rows.
 *
 * On 2026-09-17 the PEAD analyst started watching AIR ahead of its next
 * report. Finnhub's calendar carried `AIR 2026-09-21`; AAR had announced the
 * release for after the close on 2026-09-29, which is the date the writer
 * read off the company and stamped on the thesis. At 09:30 on 09-18 the
 * heads-up fired — "Reports 2026-09-21, in 3 days" — for a print that was
 * never scheduled.
 *
 * The second half of the failure is quieter: a heads-up carries a 30-day
 * cooldown, because "reports within 3 days" is true every day of the
 * approach and the cooldown is what makes it fire once. So the phantom fire
 * also swallowed the real one — the true window (09-26 through 09-29) sits
 * well inside 30 days of 09-18, and the analyst would have walked into the
 * print with no warning at all.
 *
 * The rows below are verbatim from the vendor and the database on 09-18.
 */

import { shouldFire } from "./evaluate";
import type { EvaluationContext } from "./evaluate";
import { describeUpcomingReport, reconcileUpcomingReport } from "./earnings";
import type { EarningsReport } from "./earnings";
import type { Trigger } from "./types";

/** Finnhub `/calendar/earnings`, read 2026-09-18 14:30 ET. Wrong, and confidently so. */
const CALENDAR_AIR: EarningsReport = {
  symbol: "AIR",
  reportDate: "2026-09-21",
  hour: "",
  epsActual: null,
  epsEstimate: 1.3383,
  surprisePct: null,
  revenueActual: null,
  revenueEstimate: 889490163,
  quarter: 1,
  year: 2027,
};

/** MU's row the same morning — the control. The calendar and the company agree. */
const CALENDAR_MU: EarningsReport = {
  symbol: "MU",
  reportDate: "2026-09-30",
  hour: "amc",
  epsActual: null,
  epsEstimate: 32.2164,
  surprisePct: null,
  revenueActual: null,
  revenueEstimate: 52104999710,
  quarter: 4,
  year: 2026,
};

/** What the writer stamped on AIR's thesis, from AAR's own announcement. */
const AIR_CATALYST_DATE = new Date("2026-09-29T00:00:00.000Z");

/** The account's standing heads-up, inherited by every watched name. */
const headsUp = (over: Partial<Trigger> = {}): Trigger => ({
  id: "seed:earnings-within",
  predicate: { kind: "EARNINGS_WITHIN", days: 3 },
  action: "REVIEW",
  rationale: "Reports within 3 days — decide the size before the print, not after.",
  ...over,
});

const ctxOn = (
  day: string,
  report: EarningsReport | null,
  catalystDate: Date | null = AIR_CATALYST_DATE,
): EvaluationContext => ({
  now: new Date(`${day}T13:30:00.000Z`),
  upcomingEarnings: report,
  thesis: {
    createdAt: new Date("2026-09-18T02:53:27.195Z"), // AIR's real mint time
    lastReviewedAt: null,
    catalystDate,
    direction: "LONG",
  },
});

describe("AIR, 2026-09-18 — the calendar says the 21st, the company says the 29th", () => {
  it("believes the thesis's date, so the heads-up does not fire eight days early", () => {
    const read = reconcileUpcomingReport(CALENDAR_AIR, AIR_CATALYST_DATE);
    expect(read.report?.reportDate).toBe("2026-09-29");
    expect(read.calendarDate).toBe("2026-09-21");

    // This is the fire that happened on main, off the calendar's date.
    expect(shouldFire(headsUp(), ctxOn("2026-09-18", CALENDAR_AIR)).fires).toBe(true);
    // And this is the same morning, reconciled: 11 days out, nothing to say.
    expect(shouldFire(headsUp(), ctxOn("2026-09-18", read.report)).fires).toBe(false);
  });

  it("says both dates on the row rather than asserting the one it picked", () => {
    const read = reconcileUpcomingReport(CALENDAR_AIR, AIR_CATALYST_DATE);
    expect(describeUpcomingReport(read.report!, new Date("2026-09-26T13:30:00.000Z"), read.calendarDate)).toBe(
      "Reports 2026-09-29, in 3 days. EPS est $1.34. Revenue est $889.49M." +
        " The calendar says 2026-09-21; this is the thesis's own date.",
    );
  });

  it("still fires for the real report after firing for a phantom one", () => {
    const read = reconcileUpcomingReport(CALENDAR_AIR, AIR_CATALYST_DATE);
    // The trigger as the phantom fire left it: stamped 09-18, no memory of
    // which report it fired for. A 30-day cooldown runs to 2026-10-18.
    const stamped = headsUp({ lastFiredAt: "2026-09-18T13:30:00.000Z" });
    const onTheDay = shouldFire(stamped, ctxOn("2026-09-26", read.report));
    expect(onTheDay.fires).toBe(true);

    // Once it has fired FOR 09-29, the cooldown does its real job: the
    // approach is true every day and the heads-up stays quiet.
    const remembered = headsUp({
      lastFiredAt: "2026-09-26T13:30:00.000Z",
      firedReports: ["2026-09-29"],
    });
    const nextDay = shouldFire(remembered, ctxOn("2026-09-27", read.report));
    expect(nextDay).toEqual({ fires: false, reason: "cooldown" });
  });
});

describe("what reconciliation must not do", () => {
  it("leaves MU alone — the two sources agree", () => {
    const read = reconcileUpcomingReport(CALENDAR_MU, new Date("2026-09-30T00:00:00.000Z"));
    expect(read.report).toBe(CALENDAR_MU);
    expect(read.calendarDate).toBeNull();
    expect(describeUpcomingReport(read.report!, new Date("2026-09-28T13:30:00.000Z"), read.calendarDate)).toBe(
      "Reports 2026-09-30 (after close), in 2 days. EPS est $32.22. Revenue est $52.10B.",
    );
  });

  it("treats a single day's difference as the same report, not a dispute", () => {
    // A source dating an after-close print the morning after is not a
    // disagreement worth overriding the calendar for.
    const read = reconcileUpcomingReport(CALENDAR_MU, new Date("2026-10-01T00:00:00.000Z"));
    expect(read.report?.reportDate).toBe("2026-09-30");
    expect(read.calendarDate).toBeNull();
  });

  it("never invents a report from a catalyst date — MIRM's FDA decision is not earnings", () => {
    // MIRM carries catalystDate 2026-09-26 (a PDUFA date) and no scheduled
    // report. Originating a heads-up from it would wake the analyst for a
    // print that does not exist.
    const read = reconcileUpcomingReport(null, new Date("2026-09-26T00:00:00.000Z"));
    expect(read.report).toBeNull();
    expect(
      shouldFire(headsUp(), ctxOn("2026-09-24", read.report, new Date("2026-09-26T00:00:00.000Z"))).fires,
    ).toBe(false);
  });
});
