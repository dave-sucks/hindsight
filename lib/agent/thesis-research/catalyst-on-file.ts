/**
 * catalyst-on-file.ts — the event date the company itself announced, and how
 * it meets the date the writer wrote. Pure, so a test can run it on the real
 * EXEL rows without loading the tool catalog.
 *
 * EXEL, 2026-09-25, is the case that set both rules. Its August 5 8-K said
 * the FDA date was December 3, 2026. Its September 10 8-K said the FDA had
 * extended the review and "the updated Prescription Drug User Fee Act action
 * date is March 3, 2027". The calendar found the first and not the second;
 * the writer found the second by search and saved March 3. A first version
 * of this code would have overwritten the writer's correct date with the
 * older filing's on the next save — the wrong way round, again.
 *
 * So: among the company's statements, the NEWEST announcement wins, not the
 * soonest date. And the writer's date is never overwritten by a filing — a
 * filing fills a missing date, and a disagreement is written on the row for
 * a person to read.
 */

import type { CatalystEvent } from "@/lib/market-data/catalyst-calendar";

export interface CatalystOnFile {
  kind: CatalystEvent["kind"];
  /** YYYY-MM-DD. */
  eventDate: string;
  daysAway: number | null;
  announcedDate: string;
  url: string;
  quote: string;
}

/**
 * The event to show: the company's most recent statement of a date still
 * ahead (a moved date is announced again, later), else its most recent
 * statement of a past one.
 */
export function pickCatalystOnFile(events: CatalystEvent[]): CatalystOnFile | null {
  const dated = events.filter((e): e is CatalystEvent & { eventDate: string } => e.eventDate != null);
  if (dated.length === 0) return null;
  const newestFirst = (a: CatalystEvent, b: CatalystEvent) =>
    (b.announcedDate ?? "").localeCompare(a.announcedDate ?? "");
  const ahead = dated.filter((e) => (e.daysAway ?? 0) >= 0).sort(newestFirst);
  const past = dated.filter((e) => (e.daysAway ?? 0) < 0).sort(newestFirst);
  const e = ahead[0] ?? past[0];
  return { kind: e.kind, eventDate: e.eventDate, daysAway: e.daysAway, announcedDate: e.announcedDate, url: e.url, quote: e.quote };
}

/**
 * The date the save stores, and the note that explains it.
 *
 * - The writer gave a date: it stands. If the company's filing on file says
 *   another day, the note records both — the writer may have read a newer
 *   filing than the calendar found (EXEL), or it may be wrong; either way
 *   that is a line for a person, not a silent overwrite.
 * - The writer gave none and the thesis is event-dated: the filing's date
 *   fills it, with the note saying where it came from.
 */
export function resolveEventDate(
  d: { catalyst_date?: string | null; horizon?: string | null; setup_id?: string | null },
  pull: { catalystOnFile: CatalystOnFile | null } | null | undefined,
): { iso: string | undefined; note: string | null } {
  const own = d.catalyst_date && !Number.isNaN(Date.parse(d.catalyst_date)) ? new Date(d.catalyst_date) : null;
  const onFile = pull?.catalystOnFile ?? null;
  const dated = d.horizon === "CATALYST" || d.setup_id === "PRE_CATALYST";
  if (own) {
    const ownDay = own.toISOString().slice(0, 10);
    if (onFile && onFile.eventDate !== ownDay) {
      return {
        iso: own.toISOString(),
        note: `Event date ${ownDay} as written; the company's filing on file (${onFile.announcedDate}) said ${onFile.eventDate} — ${onFile.url}. If the filing is newer, the date is wrong.`,
      };
    }
    return { iso: own.toISOString(), note: null };
  }
  if (dated && onFile && (onFile.daysAway ?? 0) >= 0) {
    return {
      iso: new Date(`${onFile.eventDate}T00:00:00.000Z`).toISOString(),
      note: `Event date ${onFile.eventDate} taken from the company's own filing (${onFile.url}); the note gave none.`,
    };
  }
  return { iso: undefined, note: null };
}
