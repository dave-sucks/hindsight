/**
 * When the next earnings report is close enough to say so out loud.
 *
 * The report's date, bell and both street estimates live on the upcoming
 * column's hover in the earnings card. A permanent header restating them was
 * on screen from the moment the date was known — ISRG carried "Next report
 * Oct 20 · after close · in 19 days" above the plot for nineteen days.
 *
 * Its own module, with no imports, so it is testable: the card is a .tsx and
 * this project's jest setup does not parse JSX.
 */

/** How close a report has to be before a surface says so in words. */
export const SOON_DAYS = 10;

/** Whole days from today to a report date, UTC-to-UTC. */
export function daysUntilReport(iso: string, now = new Date()): number {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.round(
    (d.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000,
  );
}

/**
 * Inside the window, and not already past — a date that has gone by belongs
 * to the plot, not to a header saying it is coming.
 */
export function earningsSoon(iso: string, now = new Date()): boolean {
  const days = daysUntilReport(iso, now);
  return days >= 0 && days <= SOON_DAYS;
}
