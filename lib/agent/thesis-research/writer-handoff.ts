/**
 * writer-handoff.ts — what the refresh actually wrote, handed back to the run
 * that commissioned it (DAV-301).
 *
 * CYTK, 2026-09-21, seventeen seconds apart:
 *
 *   12:08:00  THESIS_WRITER (child of the morning run)
 *             buy $73.50 → $70.25, fires on the close, target $96 → $88.31,
 *             composite 6 → 3. "The PDUFA date (Nov 14) is confirmed…"
 *   12:08:17  MORNING_PLAN (its parent)
 *             review cadence 7 → 14 days, removed the buy, removed the floor,
 *             removed the target. "Fresh research points to the nHCM filing
 *             still being guided for Q4…"
 *
 * The parent waited properly — it dispatched at 12:04:56, the writer finished
 * at 12:08:01, and it wrote sixteen seconds later. It was not a race. The
 * waiter handed it back a "thesis excerpt" that was snapshot text, bull and
 * bear bullets, and a research age — prose, and no plan. So the run deleted
 * three levels the refresh had just priced without ever being shown them,
 * and the only survivor was the deletion.
 *
 * This is the missing input, not a new gate: nothing is refused, and the run
 * may still disagree with its own writer. It just has to do it with the
 * numbers in front of it.
 *
 * Pure: the writer's own audit row plus the plan as it left it.
 */

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface WriterPlan {
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  /** The 4-dimension composite, out of 10. */
  composite: number | null;
}

export interface WriterHandoff {
  /** The writer's own one-line list of what it changed. Null when it changed nothing. */
  changed: string | null;
  /** The plan as the refresh left it, in one sentence. */
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
  plan: WriterPlan;
}): WriterHandoff {
  const { ticker, plan } = input;
  const parts: string[] = [];
  if (plan.entryPrice != null) parts.push(`buy ${fmt(plan.entryPrice)}`);
  if (plan.targetPrice != null) parts.push(`target ${fmt(plan.targetPrice)}`);
  if (plan.stopLoss != null) parts.push(`floor ${fmt(plan.stopLoss)}`);
  if (plan.composite != null) parts.push(`composite ${plan.composite}/10`);

  const raw = input.update?.summary?.trim() || null;
  const changed = raw ? stripLead(raw, ticker) || null : null;

  return {
    changed,
    planLine: parts.length
      ? `The plan the refresh left: ${parts.join(", ")}.`
      : `The refresh left no priced plan on $${ticker} — no buy level, target or floor.`,
    instruction:
      `You commissioned this refresh: read what it wrote before you change it. ` +
      `If you are about to move or remove any of these levels, say in your rationale why, against these numbers. ` +
      `Removing a level the refresh just priced without naming it is how $CYTK ended up with its plan written and deleted seventeen seconds apart on 2026-09-21.`,
  };
}

/** The one line the tool row and the model both read. */
export function writerHandoffLine(h: WriterHandoff): string {
  return h.changed ? `The refresh changed: ${h.changed}. ${h.planLine}` : h.planLine;
}
