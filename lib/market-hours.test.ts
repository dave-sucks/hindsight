import {
  etWeekday,
  etWeekdayName,
  isAnalystScheduledToday,
} from "@/lib/market-hours";

// Reference instants. Each is chosen so the Eastern-Time weekday is
// unambiguous even though the underlying UTC weekday can differ.
//
// 2026-07-27 is a Monday. 8:00 AM ET (the cron time) = 12:00 UTC same day.
const MON_8AM_ET = new Date("2026-07-27T12:00:00.000Z");
const TUE_8AM_ET = new Date("2026-07-28T12:00:00.000Z");
const WED_8AM_ET = new Date("2026-07-29T12:00:00.000Z");
const FRI_8AM_ET = new Date("2026-07-31T12:00:00.000Z");

// UTC-date-line straddle: 2026-07-28T02:00:00Z is still Monday 10 PM ET.
// A naive UTC getDay() would report Tuesday; the ET helper must say Monday.
const MON_10PM_ET = new Date("2026-07-28T02:00:00.000Z");

describe("etWeekday", () => {
  it("returns ISO weekday in Eastern Time (1=Mon..7=Sun)", () => {
    expect(etWeekday(MON_8AM_ET)).toBe(1);
    expect(etWeekday(TUE_8AM_ET)).toBe(2);
    expect(etWeekday(WED_8AM_ET)).toBe(3);
    expect(etWeekday(FRI_8AM_ET)).toBe(5);
  });

  it("uses the ET calendar date, not the UTC one, near midnight", () => {
    // Instant is Tuesday in UTC but Monday night in ET.
    expect(MON_10PM_ET.getUTCDay()).toBe(2); // Tuesday in UTC
    expect(etWeekday(MON_10PM_ET)).toBe(1); // Monday in ET
  });
});

describe("etWeekdayName", () => {
  it("returns the full ET weekday name", () => {
    expect(etWeekdayName(MON_8AM_ET)).toBe("Monday");
    expect(etWeekdayName(WED_8AM_ET)).toBe("Wednesday");
  });
});

describe("isAnalystScheduledToday", () => {
  it("runs when today's ET weekday is in the list", () => {
    expect(isAnalystScheduledToday([1, 3, 5], MON_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday([1, 3, 5], WED_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday([1, 3, 5], FRI_8AM_ET)).toBe(true);
  });

  it("skips when today's ET weekday is not in the list", () => {
    expect(isAnalystScheduledToday([1, 3, 5], TUE_8AM_ET)).toBe(false);
  });

  it("treats null/empty as 'all weekdays' (defensive — legacy rows)", () => {
    expect(isAnalystScheduledToday(null, TUE_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday(undefined, TUE_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday([], TUE_8AM_ET)).toBe(true);
  });

  it("preserves the Mon–Fri default behavior for every weekday", () => {
    const monFri = [1, 2, 3, 4, 5];
    expect(isAnalystScheduledToday(monFri, MON_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday(monFri, TUE_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday(monFri, WED_8AM_ET)).toBe(true);
    expect(isAnalystScheduledToday(monFri, FRI_8AM_ET)).toBe(true);
  });

  it("uses the ET weekday near the UTC date line", () => {
    // Monday-night ET, Tuesday UTC. A MWF analyst should still run (Monday).
    expect(isAnalystScheduledToday([1, 3, 5], MON_10PM_ET)).toBe(true);
  });
});
