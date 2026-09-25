/**
 * refusal-carryover.ts — the words that put a refused call back in front of
 * the model. Pure: no database, no clock, so the prompt builder and the
 * runs can share it and a test can pin the text.
 *
 * The rule behind it: a refusal is an input, never an ending. When a tool
 * says no, the model gets the reason back and a chance to correct the call
 * inside the same run (the refusal retry); whatever is still open when the
 * run ends is told to the next run ("Blocked last time") and shown to the
 * principal on the Activity feed. Nothing is dropped on the floor.
 *
 * Nothing here is a magic phrase. A row closes only when the same tool
 * lands on the same stock or thesis — see resolveGateRejections.
 */

import { describeRefusalTool, type OpenRefusal } from "./gate-rejections";

const reasonOf = (r: OpenRefusal): string => (r.detail ?? r.summary).replace(/\s+/g, " ").trim();

const subjectOf = (r: OpenRefusal): string =>
  r.ticker ? `$${r.ticker}` : r.thesisId ? `thesis ${r.thesisId}` : "";

/** One refusal as a line: "Buy on $PLTR — refused: …". */
export function describeRefusal(r: OpenRefusal): string {
  const subject = subjectOf(r);
  return `${describeRefusalTool(r.tool)}${subject ? ` on ${subject}` : ""} (${r.tool}) — refused: ${reasonOf(r)}`;
}

/**
 * The retry message for a run that ended with refusals it never redid.
 * Sent as one user turn after the loop, with the run's own messages ahead
 * of it, so the model corrects its own call rather than starting over.
 */
export function refusalNudge(open: OpenRefusal[]): string {
  const lines = open.map((r, i) => `${i + 1}. ${describeRefusal(r)}`);
  return (
    `${open.length === 1 ? "One of your tool calls was refused and you never redid it" : `${open.length} of your tool calls were refused and you never redid them`}. ` +
    "A refusal is not a decision — the work is still owed. For each one below, read the reason and do one of two things NOW: " +
    "(a) correct the call and make it again, or (b) if the refusal stands, make the call that records that — " +
    "update_thesis on the stock with a one-line rationale saying what you tried and why it cannot be done. " +
    "Then call record_run_summary if you have not, and complete_run. TOOL CALLS only — no narration.\n\n" +
    lines.join("\n")
  );
}

/**
 * The daily run's "Blocked last time" section: the analyst's open refusals
 * from recent runs. Empty string when there are none.
 */
export function blockedLastTimeSection(open: OpenRefusal[]): string {
  if (open.length === 0) return "";
  const lines = open.map((r) => {
    const when = r.createdAt.toISOString().slice(0, 10);
    return `- ${when}: ${describeRefusal(r)}`;
  });
  return [
    "## Blocked last time — resolve today",
    "These calls of yours were refused in a recent run and never redone. Each one is still owed. Today, on that stock's row: correct the call and make it, or record in `update_thesis` why it stands. Do not leave one untouched — it is shown to the principal as open until the same tool lands on that stock.",
    ...lines,
  ].join("\n");
}

/** The open refusals on one thesis or stock, for a tactical run's kickoff. */
export function refusalLinesFor(open: OpenRefusal[], thesisId: string, ticker: string): string {
  const mine = open.filter((r) => r.thesisId === thesisId || r.ticker === ticker.toUpperCase());
  if (mine.length === 0) return "";
  return (
    ` Still open from a recent run on this stock — a refused call that was never redone; correct it or record why it stands: ` +
    mine.map((r) => describeRefusal(r)).join("; ") +
    "."
  );
}
