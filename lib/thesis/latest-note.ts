/**
 * latest-note.ts — which note leads the thesis sheet, and on which stocks.
 *
 * Two separate decisions, both of which shipped wrong on 2026-09-22:
 *
 * 1. WHICH note. The sheet asked for the newest ThesisUpdate of any type.
 *    Over the last 45 days `TRIGGER_FIRED` is 482 of 1,321 rows and is the
 *    only type whose text repeats across stocks (275 distinct texts for 482
 *    rows — 57% unique; every other type is 97-100%). It is a templated
 *    machine event, so it wins the recency race constantly and says nothing
 *    about THIS stock. FIVE led with "Trigger: Down 12% from entry" while
 *    the analyst's actual sell argument sat one row below it.
 *    `PROPOSAL_APPROVED` is worse: 22 rows, zero with a write-up, averaging
 *    94 characters — SMMT's newest note is "Approved CLOSE on SMMT —
 *    submitted to Alpaca (idem=63d4c566)".
 *
 * 2. WHETHER to show it. The block was gated to live statuses on the grounds
 *    that "the terminal banner already says what happened". That banner
 *    (`TerminalStateBanner`) renders only for RETIRED+INVALIDATED and
 *    RETIRED+DROPPED — it returns null for SOLD, PASSED and REPLACED, which
 *    is 698 of the 891 non-live theses. On a sold stock the trade block
 *    shows the numbers; nothing showed the words.
 *
 * The work-flag line IS live-only — it is computed against a live price and
 * means nothing on a stock the run will never pick up again. That part of
 * the original gate was right; it just took the note down with it.
 */

/**
 * Update types eligible to lead the sheet: the ones an analyst wrote about
 * this stock. Excludes TRIGGER_FIRED (templated) and PROPOSAL_APPROVED (an
 * order receipt). Kept as a literal array because Prisma's `in` wants one.
 */
export const HERO_UPDATE_TYPES = [
  "UPDATED",
  "REVIEWED",
  "CREATED",
  "CLOSED",
  "INVALIDATED",
  "SUPERSEDED",
  "STATUS_CHANGED",
  "PROPOSAL_REJECTED",
  "PROPOSAL_EXPIRED",
] as const;

export type HeroUpdateType = (typeof HERO_UPDATE_TYPES)[number];

export function isHeroUpdateType(type: string): type is HeroUpdateType {
  return (HERO_UPDATE_TYPES as readonly string[]).includes(type);
}

/** Statuses the daily run can still act on — the only ones with work flags. */
export function isLiveStatus(status: string): boolean {
  return status === "WATCHING" || status === "HOLDING" || status === "PROMOTED";
}

/** What the flag line under the note should say. */
export type FlagsView =
  | "loading" // the live price is still in flight
  | "reasons" // at least one work flag — render them
  | "none" // checked, nothing flagged
  | "unchecked" // the live price failed, so we could not check
  | "hidden"; // not a live stock; the run will not pick it up

export type LatestNoteView = { showNote: boolean; flags: FlagsView };

/**
 * Returns null when the block has nothing to say at all — no note to show
 * and no flag statement we can honestly make.
 */
export function latestNoteView(input: {
  status: string;
  hasNote: boolean;
  hasReasons: boolean;
  quoteLoading: boolean;
  quoteFailed: boolean;
}): LatestNoteView | null {
  const { status, hasNote, hasReasons, quoteLoading, quoteFailed } = input;

  const flags: FlagsView = !isLiveStatus(status)
    ? "hidden"
    : quoteLoading
      ? "loading"
      : hasReasons
        ? "reasons"
        : quoteFailed
          ? "unchecked"
          : "none";

  // Nothing to render: no note, and no flag statement worth a line.
  if (!hasNote && (flags === "hidden" || flags === "unchecked")) return null;

  return { showNote: hasNote, flags };
}
