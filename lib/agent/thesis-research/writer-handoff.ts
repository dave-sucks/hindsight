/**
 * writer-handoff.ts — what the refresh actually wrote, handed back to the run
 * that commissioned it (DAV-301).
 *
 * CYTK, 2026-09-21, seventeen seconds apart:
 *
 *   12:08:00  THESIS_WRITER (child of the morning run)
 *             buy $73.50 → $70.25, fires on the close, target $96 → $88.31,
 *             "The PDUFA date (Nov 14) is confirmed…"
 *   12:08:17  MORNING_PLAN (its parent)
 *             review cadence 7 → 14 days, removed the buy, removed the floor,
 *             removed the target. "Fresh research points to the nHCM filing
 *             still being guided for Q4…"
 *
 * The parent waited properly — it dispatched at 12:04:56, the writer finished
 * at 12:08:01, and it wrote sixteen seconds later. It was not a race. The
 * waiter handed it back a "thesis excerpt" that was snapshot text, bull and
 * bear bullets, and a research age — prose, and no triggers. So the run
 * deleted three levels the refresh had just priced without ever being shown
 * them, and the only survivor was the deletion.
 *
 * This is the missing input, not a new gate: nothing is refused, and the run
 * may still disagree with its own writer. It just has to do it with the
 * numbers in front of it.
 *
 * Pure: the writer's own audit row plus the stock's triggers as it left them.
 */

export interface WriterHandoff {
  /** The writer's own one-line list of what it changed. Null when it changed nothing. */
  changed: string | null;
  /** The stock's triggers as the refresh left them, each as its sentence, in one line. */
  planLine: string;
  /** What the run owes this plan before it overwrites it. */
  instruction: string;
}

/** "Updated CYTK: Entry $73.50 → $70.25, …" → the part after the colon. */
function stripLead(summary: string, ticker: string): string {
  const lead = new RegExp(`^Updated \\$?${ticker}:?\\s*`, "i");
  return summary.replace(lead, "").trim();
}

export function writerHandoff(input: {
  ticker: string;
  /** The ThesisUpdate the writer child run wrote, if it wrote one. */
  update: { summary: string | null } | null;
  /** The stock's own triggers after the refresh, each as its sentence ("Buy if above $51.94 · only on the close"). */
  triggers: string[];
}): WriterHandoff {
  const { ticker, triggers } = input;

  const raw = input.update?.summary?.trim() || null;
  const changed = raw ? stripLead(raw, ticker) || null : null;

  return {
    changed,
    planLine: triggers.length
      ? `The triggers the refresh left: ${triggers.join("; ")}.`
      : `The refresh left $${ticker} with no triggers.`,
    instruction:
      `You commissioned this refresh: read what it wrote before you change it. ` +
      `If you are about to move or remove any of these triggers, say in your rationale why, against these numbers. ` +
      `Removing a level the refresh just priced without naming it is how $CYTK ended up with its levels written and deleted seventeen seconds apart on 2026-09-21.`,
  };
}

/** The one line the tool row and the model both read. */
export function writerHandoffLine(h: WriterHandoff): string {
  return h.changed ? `The refresh changed: ${h.changed}. ${h.planLine}` : h.planLine;
}
