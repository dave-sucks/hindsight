/**
 * latest-note.ts — whether the Overview's newest note and its flag line show.
 *
 * WHICH notes the Overview shows is not decided here: it is the list every
 * run is handed, `recentAnswers` (lib/agent/stock-context.ts), read by the
 * dossier route over the same newest Activity lines, shown as Activity rows. (Until 2026-10-29 the sheet had its own list of types, which
 * let an expired proposal's line lead GEV's sheet over the analyst's note.)
 *
 * WHETHER to show it: the note shows on every stock, sold and passed ones
 * included. The work-flag line is live-only — it is computed against a live
 * price and means nothing on a stock the run will never pick up again.
 */

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
