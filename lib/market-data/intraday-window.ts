/**
 * The 1D chart's clock window — one definition for the server that trims
 * the bars and the chart that draws them.
 *
 * 7:00 AM to 6:30 PM ET: the regular session (9:30–16:00) dead-center with
 * 2.5 hours of off-hours each side. The tape carries prints from 4:00 AM to
 * 8:00 PM; a print outside this window is never sent to the chart, because
 * the chart sizes its price scale from every bar it holds — SMMT's 4:00 AM
 * print at $19.81 on 2026-09-29 sat above the whole visible day and
 * stretched the scale to a point nobody could see (DAV-340 review).
 */
export const INTRADAY_WINDOW_ET = {
  /** Minutes since midnight ET. */
  start: 7 * 60,
  end: 18 * 60 + 30,
} as const;

/** Minutes since midnight in New York for an instant. */
export function etMinutesOf(iso: string | Date): number {
  const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .split(":")
    .map(Number);
  return hh * 60 + mm;
}

/** The New York calendar date (YYYY-MM-DD) of an instant. */
export function etDateOf(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Inside the window the chart draws. */
export function inIntradayWindow(iso: string | Date): boolean {
  const m = etMinutesOf(iso);
  return m >= INTRADAY_WINDOW_ET.start && m <= INTRADAY_WINDOW_ET.end;
}
