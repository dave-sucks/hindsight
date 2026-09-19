/**
 * market-hours.calendar.test.ts — the NYSE calendar, computed.
 *
 * It used to be two hand-kept sets and an empty set for every other year.
 * Three silent faults, all fixed here and pinned:
 *   • Juneteenth, a full holiday since 2022, was in neither year. 2026-06-19
 *     is a Friday: the evaluator would have run all day on a dead tape.
 *   • The day after Thanksgiving was listed as a holiday. It is a real
 *     9:30–13:00 session, so nothing checked a stop for a whole trading day.
 *   • From 2028 the holiday set was empty, so every holiday read as an
 *     ordinary session.
 */
import { marketHolidays, marketHalfDays, sessionCloseHour, isTradingDay, isMarketOpen } from "./market-hours";

const et = (ymd: string, hhmm: string) => {
  // ET is UTC−4 between March and November, −5 otherwise; both candidates are
  // tried and the one that reads back as the wanted ET hour wins.
  const [h, m] = hhmm.split(":").map(Number);
  for (const off of [4, 5]) {
    const d = new Date(`${ymd}T${String(h + off).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    const read = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(d));
    if (read === h) return d;
  }
  throw new Error(`bad ET time ${ymd} ${hhmm}`);
};

describe("2026, against the published NYSE calendar", () => {
  const h = marketHolidays(2026);
  it("is the nine holidays, Juneteenth included", () => {
    expect([...h].sort()).toEqual([
      "2026-01-01", // New Year's Day, Thursday
      "2026-01-19", // MLK, 3rd Monday
      "2026-02-16", // Presidents', 3rd Monday
      "2026-04-03", // Good Friday
      "2026-05-25", // Memorial, last Monday
      "2026-06-19", // Juneteenth, Friday — the one that was missing
      "2026-07-03", // Independence observed, the 4th is a Saturday
      "2026-09-07", // Labor, 1st Monday
      "2026-11-26", // Thanksgiving, 4th Thursday
      "2026-12-25", // Christmas, Friday
    ].sort());
  });

  it("Juneteenth is not a trading day, and the market is shut at noon on it", () => {
    expect(isTradingDay(et("2026-06-19", "12:00"))).toBe(false);
    expect(isMarketOpen(et("2026-06-19", "12:00"))).toBe(false);
  });

  it("the day after Thanksgiving trades, and closes at one", () => {
    expect([...marketHalfDays(2026)].sort()).toEqual(["2026-11-27", "2026-12-24"]);
    expect(isTradingDay(et("2026-11-27", "10:00"))).toBe(true);
    expect(isMarketOpen(et("2026-11-27", "10:00"))).toBe(true);
    expect(isMarketOpen(et("2026-11-27", "13:30"))).toBe(false);
    expect(sessionCloseHour("2026-11-27")).toBe(13);
    expect(sessionCloseHour("2026-11-30")).toBe(16);
  });

  it("an ordinary session still runs to four", () => {
    expect(isMarketOpen(et("2026-09-18", "15:30"))).toBe(true);
    expect(isMarketOpen(et("2026-09-18", "16:00"))).toBe(false);
    expect(isMarketOpen(et("2026-09-18", "09:29"))).toBe(false);
  });
});

describe("the years the table did not cover", () => {
  it("2027 keeps its nine and gains Juneteenth, observed on the Friday", () => {
    const h = marketHolidays(2027);
    expect(h.has("2027-06-18")).toBe(true); // the 19th is a Saturday
    expect(h.has("2027-03-26")).toBe(true); // Good Friday
    expect(h.has("2027-07-05")).toBe(true); // the 4th is a Sunday
    expect(h.has("2027-12-24")).toBe(true); // Christmas is a Saturday
    expect(h.size).toBe(10);
  });

  it("2028 is a real calendar, not an empty set", () => {
    const h = marketHolidays(2028);
    expect(h.size).toBeGreaterThan(8);
    expect(h.has("2028-01-17")).toBe(true); // MLK
    expect(h.has("2028-04-14")).toBe(true); // Good Friday
    expect(h.has("2028-06-19")).toBe(true); // Juneteenth, a Monday
    expect(h.has("2028-07-04")).toBe(true);
    expect(h.has("2028-11-23")).toBe(true); // Thanksgiving
    expect(isTradingDay(et("2028-07-04", "12:00"))).toBe(false);
  });

  it("New Year's Day on a Saturday is not observed — the NYSE trades that Friday", () => {
    // 2028-01-01 is a Saturday.
    expect(marketHolidays(2028).has("2027-12-31")).toBe(false);
    expect(marketHolidays(2028).has("2028-01-01")).toBe(false);
    expect(isTradingDay(et("2027-12-31", "12:00"))).toBe(true);
  });

  it("every year from 2026 to 2035 has between nine and eleven holidays and no weekend ones", () => {
    for (let y = 2026; y <= 2035; y++) {
      const h = marketHolidays(y);
      expect({ y, n: h.size }).toEqual({ y: y, n: h.size });
      expect(h.size).toBeGreaterThanOrEqual(9);
      expect(h.size).toBeLessThanOrEqual(11);
      for (const d of h) {
        const day = new Date(`${d}T12:00:00Z`).getUTCDay();
        expect({ d, day }).toEqual({ d, day: day });
        expect(day === 0 || day === 6).toBe(false);
      }
    }
  });
});
