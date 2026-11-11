/**
 * The market's own calendar: the dates that move the whole market, not one
 * stock. Fed decisions, the inflation (CPI) and jobs reports, US elections.
 *
 * These dates are published a year or more ahead and don't move, so they are
 * written here, each list with where it came from. No vendor we hold serves
 * an economic calendar (FMP 402, Finnhub 403, 2026-08-19), and BLS refuses
 * scripts. When a list runs out, the calendar says so in words
 * (`calendarGaps`) instead of going quiet: a blank calendar must never read
 * as a quiet market.
 *
 * Why it exists: on Nov 2, 2026 the market check told every morning run the
 * regime and the sectors, and nothing about the vote the next day. Copied
 * from the closed market-tool PR; the market numbers read it
 * (lib/market-data/market-numbers.ts).
 */

export type MarketDateKind = "FED" | "CPI" | "JOBS" | "ELECTION";

export interface MarketDate {
  /** YYYY-MM-DD, US Eastern. */
  date: string;
  kind: MarketDateKind;
  /** "Fed decision", "inflation report (CPI)": reads after a day ("Tue Nov 10 inflation report (CPI)"). */
  what: string;
}

/**
 * federalreserve.gov/monetarypolicy/fomccalendars.htm, read 2026-11-06.
 * Each meeting's second day, when the decision comes out at 2:00 PM ET.
 * `true`: the meeting also publishes the Fed's projections.
 */
const FED_DECISIONS: readonly (readonly [string, boolean])[] = [
  ["2026-01-28", false], ["2026-03-18", true], ["2026-04-29", false], ["2026-06-17", true],
  ["2026-07-29", false], ["2026-09-16", true], ["2026-10-28", false], ["2026-12-09", true],
  ["2027-01-27", false], ["2027-03-17", true], ["2027-04-28", false], ["2027-06-09", true],
  ["2027-07-28", false], ["2027-09-15", true], ["2027-10-27", false], ["2027-12-08", true],
];

/** bls.gov/schedule/news_release/cpi.htm, read 2026-11-06. 8:30 AM ET. */
const CPI_RELEASES: readonly string[] = [
  "2026-11-10", "2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12",
  "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10",
];

/** bls.gov/schedule/news_release/empsit.htm, read 2026-11-06. 8:30 AM ET. */
const JOBS_RELEASES: readonly string[] = [
  "2026-11-06", "2026-12-04", "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07",
  "2027-06-04", "2027-07-02", "2027-08-06", "2027-09-03", "2027-10-08", "2027-11-05", "2027-12-03",
];

/** US federal general elections: the Tuesday after the first Monday in November. */
const ELECTIONS: readonly (readonly [string, string])[] = [
  ["2026-11-03", "US midterm elections"],
  ["2028-11-07", "US presidential election"],
];

const LISTS: readonly { name: string; dates: readonly string[] }[] = [
  { name: "Fed decision", dates: FED_DECISIONS.map(([d]) => d) },
  { name: "inflation report", dates: CPI_RELEASES },
  { name: "jobs report", dates: JOBS_RELEASES },
];

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Today's date in New York, YYYY-MM-DD. */
export function etToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** "Tue Nov 3". */
export function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
}

/** When each kind comes out, New York time: a release today is no longer ahead once its time has passed. An election runs all day. */
const RELEASED_AT: Record<MarketDateKind, string | null> = { FED: "14:00", CPI: "08:30", JOBS: "08:30", ELECTION: null };

/** "20:00": the New York clock. */
function etClock(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/**
 * The scheduled market dates from `today` through `days` ahead, in order.
 * With `now`, a release earlier today is left out: at 8 PM on Nov 10 that
 * morning's inflation report is behind us, not ahead.
 */
export function scheduledMarketDates(today: string, days: number, now?: Date): MarketDate[] {
  const end = addDays(today, days);
  const inWindow = (d: string) => d >= today && d <= end;
  const clock = now ? etClock(now) : null;
  const ahead = (m: MarketDate) => m.date !== today || clock == null || RELEASED_AT[m.kind] == null || clock < RELEASED_AT[m.kind]!;
  const dates: MarketDate[] = [
    ...FED_DECISIONS.filter(([d]) => inWindow(d)).map(([date, projections]) => ({
      date,
      kind: "FED" as const,
      what: projections ? "Fed decision, with its projections" : "Fed decision",
    })),
    ...CPI_RELEASES.filter(inWindow).map((date) => ({ date, kind: "CPI" as const, what: "inflation report (CPI)" })),
    ...JOBS_RELEASES.filter(inWindow).map((date) => ({ date, kind: "JOBS" as const, what: "jobs report" })),
    ...ELECTIONS.filter(([d]) => inWindow(d)).map(([date, what]) => ({ date, kind: "ELECTION" as const, what })),
  ];
  return dates.filter(ahead).sort((a, b) => a.date.localeCompare(b.date));
}

/** Each list that ends inside the window, in words. */
export function calendarGaps(today: string, days: number): string[] {
  const end = addDays(today, days);
  return LISTS.filter((l) => l.dates[l.dates.length - 1] < end).map(
    (l) => `The ${l.name} dates on file end ${l.dates[l.dates.length - 1]}; later ones are missing from this calendar until they are added in lib/market-data/market-calendar.ts.`,
  );
}
