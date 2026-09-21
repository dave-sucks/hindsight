/**
 * NYSE/NASDAQ market hours helper.
 * Mon–Fri, 9:30am–4:00pm Eastern Time.
 * Includes US federal holiday list for the current year.
 */

// ── The NYSE calendar, computed ──────────────────────────────────────────
//
// This was two hand-kept sets, 2026 and 2027, and an empty set for every
// other year. Three things were wrong with that, all of them silent:
// Juneteenth (a full holiday since 2022) was in neither year; the day after
// Thanksgiving was listed as a holiday though it is a real 9:30–13:00
// session; and from 2028 every holiday read as an ordinary trading day.
// A missing holiday means the evaluator runs all day on a dead tape; a
// wrongly-listed one means nothing checks a stop for a whole session.
//
// The rules are fixed, so they are computed rather than typed in.

/** Easter Sunday (Gregorian), Meeus/Jones/Butcher. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Day of week for a calendar date, 0=Sun … 6=Sat. Pure, no timezone. */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The nth given weekday of a month, e.g. the 3rd Monday of January. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = dow(y, m, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** The last given weekday of a month, e.g. the last Monday of May. */
function lastWeekday(y: number, m: number, weekday: number): number {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dow(y, m, days);
  return days - ((last - weekday + 7) % 7);
}

/**
 * A fixed-date holiday's observed date. Saturday moves back to Friday,
 * Sunday forward to Monday — except New Year's Day, which the NYSE simply
 * does not observe when 1 January falls on a Saturday.
 */
function observed(y: number, m: number, d: number, isNewYear = false): string | null {
  const w = dow(y, m, d);
  if (w === 6) return isNewYear ? null : iso(y, m, d - 1);
  if (w === 0) return iso(y, m, d + 1);
  return iso(y, m, d);
}

/** Every full NYSE holiday in a year, as YYYY-MM-DD in Eastern Time. */
export function marketHolidays(year: number): Set<string> {
  const out = new Set<string>();
  const add = (v: string | null) => {
    if (v) out.add(v);
  };
  add(observed(year, 1, 1, true)); // New Year's Day
  add(iso(year, 1, nthWeekday(year, 1, 1, 3))); // MLK Day — 3rd Monday
  add(iso(year, 2, nthWeekday(year, 2, 1, 3))); // Presidents' Day — 3rd Monday
  {
    // Good Friday — two days before Easter Sunday.
    const e = easterSunday(year);
    const gf = new Date(Date.UTC(year, e.month - 1, e.day - 2));
    add(iso(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate()));
  }
  add(iso(year, 5, lastWeekday(year, 5, 1))); // Memorial Day — last Monday
  // Juneteenth — a full NYSE holiday since 2022, and missing from both
  // hand-kept years. 2026-06-19 is a Friday.
  if (year >= 2022) add(observed(year, 6, 19));
  add(observed(year, 7, 4)); // Independence Day
  add(iso(year, 9, nthWeekday(year, 9, 1, 1))); // Labor Day — 1st Monday
  add(iso(year, 11, nthWeekday(year, 11, 4, 4))); // Thanksgiving — 4th Thursday
  add(observed(year, 12, 25)); // Christmas Day
  return out;
}

/**
 * Days the NYSE trades a shortened session, closing at 13:00 ET. These are
 * TRADING days: the evaluator must run through the morning, and must stop
 * at the early bell rather than scoring three more hours against a tape
 * that has already closed.
 */
export function marketHalfDays(year: number): Set<string> {
  const out = new Set<string>();
  // The day after Thanksgiving.
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  out.add(iso(year, 11, thanksgiving + 1));
  // 3 July, when the 4th is itself the observed holiday and the 3rd trades.
  if (dow(year, 7, 3) >= 1 && dow(year, 7, 3) <= 5 && dow(year, 7, 4) >= 1 && dow(year, 7, 4) <= 5) {
    out.add(iso(year, 7, 3));
  }
  // Christmas Eve, when it falls Monday to Thursday.
  const ce = dow(year, 12, 24);
  if (ce >= 1 && ce <= 4) out.add(iso(year, 12, 24));
  const holidays = marketHolidays(year);
  for (const d of out) if (holidays.has(d)) out.delete(d);
  return out;
}

const holidayCache = new Map<number, Set<string>>();
function getHolidays(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    set = marketHolidays(year);
    holidayCache.set(year, set);
  }
  return set;
}

const halfDayCache = new Map<number, Set<string>>();
function getHalfDays(year: number): Set<string> {
  let set = halfDayCache.get(year);
  if (!set) {
    set = marketHalfDays(year);
    halfDayCache.set(year, set);
  }
  return set;
}

/** The hour the bell rings on a given ET date: 13:00 on a half day, else 16:00. */
export function sessionCloseHour(ymd: string): number {
  const year = parseInt(ymd.slice(0, 4), 10);
  return getHalfDays(year).has(ymd) ? 13 : 16;
}

/**
 * Returns true if the US stock market is currently open.
 * Checks: weekday, not holiday, 9:30am–4:00pm ET.
 */
/**
 * Returns the current trading-day date as a UTC midnight Date.
 *
 * The "date" used to key MorningBrief, daily Signal filters, EOD snapshots,
 * etc. must be the *Eastern Time* calendar date, not the server-local
 * (UTC on Vercel) date. Otherwise any code that runs after 8 PM ET sees
 * "tomorrow" while the ET trading day is still in progress.
 *
 * Convention: YYYY-MM-DD in ET, materialised as 00:00:00 UTC of that same
 * calendar date. Sorts correctly, comparable across timezones, and matches
 * how the morning cron wrote rows when it ran before UTC midnight.
 */
export function etTradingDayDate(now: Date = new Date()): Date {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * ISO weekday (1=Mon … 7=Sun) of the given instant, evaluated in Eastern Time.
 *
 * Vercel runs in UTC, so a naive `Date.getDay()` can report the wrong weekday
 * near midnight ET (e.g. the 8 AM ET Monday cron fires at 12:00 UTC — fine —
 * but any pre-market or late-evening path can straddle the UTC date line).
 * Always derive the schedule weekday through this helper, never `getDay()`.
 */
export function etWeekday(now: Date = new Date()): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[short] ?? 0;
}

/**
 * Should the daily morning run execute for an analyst today?
 *
 * `runDaysOfWeek` holds ISO weekdays (1=Mon..5=Fri). A null/empty array is
 * treated defensively as "all weekdays" — legacy rows written before the
 * column existed must never silently stop running. Weekends are out of scope
 * (the cron is Mon–Fri and markets are closed), but the predicate stays honest
 * for any day it's asked about.
 *
 * Pure + timezone-correct: the weekday is computed in Eastern Time via
 * {@link etWeekday}, so it's safe to call from UTC infrastructure.
 */
export function isAnalystScheduledToday(
  runDaysOfWeek: number[] | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!runDaysOfWeek || runDaysOfWeek.length === 0) return true;
  return runDaysOfWeek.includes(etWeekday(now));
}

/** Full ET weekday name for logging, e.g. "Monday". */
export function etWeekdayName(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);
}

/**
 * Is today (ET) a day the market trades at all — a weekday that is not an
 * NYSE holiday? The daily-run cron needs this and not `isMarketOpen`, which
 * also asks whether the bell has rung: the cron fires at 08:00, before it.
 * Without this the three analysts ran on Labor Day 2026 against Friday's
 * prices and proposed an exit nobody could act on (DAV-235).
 */
export function isTradingDay(now: Date = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  return !getHolidays(parseInt(parts.year, 10)).has(
    `${parts.year}-${parts.month}-${parts.day}`,
  );
}

/**
 * How many calendar days it takes to get through `sessions` trading days,
 * starting the day after `from`.
 *
 * A setup's short time limits are written in sessions — "no progress in 20
 * sessions is a failed breakout" — but a trigger's day count from the buy is
 * measured in calendar days. Multiplying by 7/5 is close, and wrong by a day
 * around every holiday; this walks the real NYSE calendar the same
 * `isTradingDay` the crons use, so Thanksgiving week and Good Friday are
 * counted as the market actually keeps them.
 *
 * 20 sessions from Monday 2026-09-14 lands on 2026-10-12 — 28 calendar days,
 * because Columbus Day is a session and nothing else intervenes. The same 20
 * from 2026-11-20 takes 30, because of Thanksgiving and Christmas.
 *
 * Returns 0 for a count of zero or less. The walk is bounded: a run of days
 * with no session in it stops at the cap and returns what it has, which is a
 * review that fires a little early rather than a cron that never returns.
 */
export function sessionsToCalendarDays(sessions: number, from: Date = new Date()): number {
  if (!Number.isFinite(sessions) || sessions <= 0) return 0;
  const DAY = 86_400_000;
  const cap = Math.ceil(sessions) * 3 + 30;
  let counted = 0;
  let days = 0;
  while (counted < sessions && days < cap) {
    days += 1;
    if (isTradingDay(new Date(from.getTime() + days * DAY))) counted += 1;
  }
  return days;
}

/** 16:00 ET on the trading day before the current (or last) session — the close a quote's `prevClose` is. */
export function priorSessionCloseAt(now: Date = new Date()): Date {
  const DAY = 86_400_000;
  const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  let cursor = new Date(`${ymd(now)}T16:00:00Z`);
  while (!isTradingDay(cursor)) cursor = new Date(cursor.getTime() - DAY);
  cursor = new Date(cursor.getTime() - DAY);
  while (!isTradingDay(cursor)) cursor = new Date(cursor.getTime() - DAY);
  return etWallClock(ymd(cursor), 16, 0);
}

/** The UTC instant of a wall-clock time in New York on a given date (DST-aware). */
function etWallClock(ymd: string, hour: number, minute: number): Date {
  for (const offset of [4, 5]) {
    const candidate = new Date(`${ymd}T${String(hour + offset).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
    const h = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(candidate),
    );
    if (h === hour) return candidate;
  }
  return new Date(`${ymd}T${String(hour + 5).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

export function isMarketOpen(now: Date = new Date()): boolean {
  // Convert to Eastern Time
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = Object.fromEntries(
    etFormatter.formatToParts(now).map((p) => [p.type, p.value])
  );

  const weekday = parts.weekday; // "Mon", "Tue", etc.
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;

  // Weekends
  if (weekday === "Sat" || weekday === "Sun") return false;

  // Holidays
  const holidays = getHolidays(parseInt(parts.year, 10));
  if (holidays.has(dateStr)) return false;

  // 9:30am ET to the bell — 16:00 normally, 13:00 on a half day. Without
  // the half-day close the evaluator spent three hours scoring stops
  // against a tape that had already shut.
  const totalMinutes = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 570
  const marketClose = sessionCloseHour(dateStr) * 60;

  return totalMinutes >= marketOpen && totalMinutes < marketClose;
}

/**
 * Returns minutes until market open (0 if already open).
 */
export function minutesUntilOpen(now: Date = new Date()): number {
  if (isMarketOpen(now)) return 0;
  // Simplified: next 9:30am ET
  const next = new Date(now);
  next.setHours(next.getHours() + 1); // rough estimate
  return 60;
}
