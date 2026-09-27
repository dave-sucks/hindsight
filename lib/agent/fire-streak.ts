/**
 * How long a rung has been asking, and what counts as answering it.
 *
 * ABT, 2026-09-15 → 09-25. The Secular Compounder's "below the 200-day →
 * review" rule fired on every one of nine trading days. The runs that
 * received it wrote back, in order: an empty row, a real edit (added a
 * 10-day review), an empty row, an empty row, an empty row. Four of the
 * five answers changed nothing and named nothing — and each one cleared
 * the obligation, so the ninth fire reached the run looking exactly like
 * the first. Nothing in its context said "this is the ninth."
 *
 * Two halves of one idea, kept in one file because they have to agree:
 *
 *   fireStreak  — the INPUT. How many times this rung has fired since
 *                 anything on the row actually changed, and when that was.
 *                 Goes in the row text the run reads.
 *   answersFire — the TEST. Which audit row closes that fire: one that
 *                 names the rung, or one that changed the plan. A row that
 *                 does neither is the ninth empty row.
 *
 * The count and the date are deliberately measured against the same event
 * — the last real change — so the sentence can't contradict itself. Nine
 * fires since the condition began but six since the last edit is reported
 * as six, because "and nothing has changed since" is the half that matters.
 *
 * An attestation does NOT reset the count. A run that looks and says "I
 * checked, the plan stands" has answered that day's fire, but nothing on
 * the row changed, so tomorrow's line still says how long this has run.
 * That is the point: the tenth "I checked" should look different from the
 * first.
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
  /** Fires of this rung since the row last changed. Always ≥ 1. */
  fireCount: number;
  /** The oldest fire in the run of them. */
  firstFiredAt: Date;
  /** When the row last actually changed. Null = not within the rows given. */
  lastChangedAt: Date | null;
  /** Whole days since the row last changed (or since the first fire). */
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
 * Did this row change anything on the thesis?
 *
 * A fire never counts — a fire is the question, not the answer. A REVIEWED
 * row never counts either: that type exists precisely for "looked, changed
 * nothing." Everything else counts when it carries a diff.
 *
 * Trigger edits do land in the diff (`triggerOps`, 74 of the live account's
 * 236 UPDATED rows in the three weeks to 2026-09-27), so an empty diff on
 * an UPDATED row is now a fair reading of "nothing changed" — but it is
 * only ever half the test here, because `answersFire` also accepts a row
 * that names the rung. An edit whose diff went missing still answers.
 */
export function changedTheRow(u: FireStreakUpdate): boolean {
  if (u.type === "TRIGGER_FIRED" || u.type === "REVIEWED") return false;
  if (ALWAYS_A_CHANGE.has(u.type)) return true;
  return hasAnyFieldChange(u.fieldChanges);
}

/**
 * Does this audit row answer that fire?
 *
 * Either it names the rung it is answering — `update_thesis(trigger_id:)`,
 * which is how the agent already answers roughly a quarter of its edits —
 * or it changed the plan, which answers by doing rather than saying.
 */
export function answersFire(u: FireStreakUpdate, triggerId: string): boolean {
  if (u.type === "TRIGGER_FIRED") return false;
  if (u.triggerId != null && u.triggerId === triggerId) return true;
  return changedTheRow(u);
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
    ? `nothing on this row has changed since ${day}`
    : `nothing on this row has changed since it started firing on ${day}`;
  return (
    `This has fired ${fireCount} times and ${what} (${daysUnchanged}d). ` +
    `Either change the plan or say what you checked and why it still stands.`
  );
}
