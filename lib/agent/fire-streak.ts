/**
 * How long a rung has been asking.
 *
 * ABT, 2026-09-15 → 09-25. The Secular Compounder's "below the 200-day →
 * review" rule fired on every one of nine trading days. The runs that
 * received it answered every time, in words: "below the 200-day, but no
 * second guidance cut, no new Libre safety event … I hold." Once they
 * added a 10-day review; the other four times the plan stood. The answers
 * were real. What was missing was on the other side: nothing told the run
 * it was being asked the same question for the ninth time, so the ninth
 * answer was the first answer again.
 *
 * `fireStreak` is that missing INPUT: how many times this rung has fired
 * since the plan last changed, and when that was. It goes in the row text
 * the run reads. It refuses nothing (QB ruling on the ticket: two inputs,
 * one obligation, no gate).
 *
 * The count and the date are measured against the same event — the last
 * change to the plan — so the sentence can't contradict itself. Nine fires
 * since the condition began but six since the last edit is reported as
 * six, because "and the plan has not changed since" is the half that
 * matters.
 *
 * A written answer does NOT reset the count. A run that looks and says
 * "I checked, the plan stands" has answered that day's fire, but the plan
 * did not move, so the next line still says how long this has run. That is
 * the point: the tenth "I checked" should look different from the first.
 *
 * Pure — no prisma, no clock of its own. DAV-323.
 */

/** One audit row, as little of it as this module needs. */
export interface FireStreakUpdate {
  type: string;
  triggerId?: string | null;
  fieldChanges?: unknown;
  timestamp: Date;
}

export interface FireStreak {
  triggerId: string;
  /** Fires of this rung since the plan last changed. Always ≥ 1. */
  fireCount: number;
  /** The oldest fire in the run of them. */
  firstFiredAt: Date;
  /** When the plan last changed. Null = not within the rows given. */
  lastChangedAt: Date | null;
  /** Whole days since the plan last changed (or since the first fire). */
  daysUnchanged: number;
  /** The sentence the run reads. Empty on a first ask — it has no history. */
  line: string;
}

/**
 * Types that mean the thesis moved, whatever the diff says. A status move,
 * a close, an invalidation and a trade are changes by their own existence;
 * none of them carries a field diff worth reading.
 */
const ALWAYS_A_CHANGE = new Set([
  "CREATED",
  "STATUS_CHANGED",
  "CLOSED",
  "INVALIDATED",
  "SUPERSEDED",
  "ACTED",
]);

function hasAnyFieldChange(fieldChanges: unknown): boolean {
  if (fieldChanges == null || typeof fieldChanges !== "object") return false;
  return Object.keys(fieldChanges as Record<string, unknown>).length > 0;
}

/**
 * Did this row change the plan?
 *
 * A fire never counts — a fire is the question, not the answer. A REVIEWED
 * row never counts either: that type exists precisely for "looked, changed
 * nothing." Everything else counts when it carries a diff.
 *
 * What the diff holds is the plan: levels, triggers (`triggerOps`), status,
 * direction, conviction. It does not hold everything — naming a setup
 * lands with an empty diff (NOW and SYK, 2026-09-18) — which is why the
 * sentence says "the plan has not changed", not "nothing has changed".
 */
export function changedTheRow(u: FireStreakUpdate): boolean {
  // A note is information; it is not the plan (lib/agent/notes.ts).
  if (u.type === "TRIGGER_FIRED" || u.type === "REVIEWED" || u.type === "NOTE") return false;
  if (ALWAYS_A_CHANGE.has(u.type)) return true;
  return hasAnyFieldChange(u.fieldChanges);
}

const DAY_MS = 86_400_000;

/**
 * The repeat history of one rung, read off the thesis's audit rows.
 *
 * `updates` is any slice of the thesis's log — order doesn't matter, it is
 * sorted here. Returns null when this rung has no unanswered fire in the
 * slice, which is the common case.
 */
export function fireStreak(
  updates: FireStreakUpdate[],
  triggerId: string,
  now: Date,
): FireStreak | null {
  const rows = [...updates].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  );

  let fireCount = 0;
  let firstFiredAt: Date | null = null;
  let lastChangedAt: Date | null = null;
  for (const u of rows) {
    if (changedTheRow(u)) {
      lastChangedAt = u.timestamp;
      break;
    }
    if (u.type === "TRIGGER_FIRED" && u.triggerId === triggerId) {
      fireCount += 1;
      firstFiredAt = u.timestamp;
    }
  }
  if (fireCount === 0 || firstFiredAt == null) return null;

  const since = lastChangedAt ?? firstFiredAt;
  const daysUnchanged = Math.max(
    0,
    Math.floor((now.getTime() - since.getTime()) / DAY_MS),
  );

  return {
    triggerId,
    fireCount,
    firstFiredAt,
    lastChangedAt,
    daysUnchanged,
    line: buildLine(fireCount, lastChangedAt, firstFiredAt, daysUnchanged),
  };
}

function buildLine(
  fireCount: number,
  lastChangedAt: Date | null,
  firstFiredAt: Date,
  daysUnchanged: number,
): string {
  // A first ask has no history to report; saying "fired 1 time" is noise.
  if (fireCount < 2) return "";
  const day = (lastChangedAt ?? firstFiredAt).toISOString().slice(0, 10);
  const what = lastChangedAt
    ? `the plan has not changed since ${day}`
    : `the plan has not changed since it started firing on ${day}`;
  return (
    `This has fired ${fireCount} times and ${what} (${daysUnchanged}d). ` +
    `Either change the plan or say what is different from the last time you answered it.`
  );
}
