/**
 * notes.ts — the principal's note on a stock (docs/plans/AGENT_CONTEXT.md §3.1).
 * Information only: why, what they are waiting for, what would change their
 * mind. One `NOTE` Activity line, written by their chat after their yes; nothing
 * happens to it afterward. A price, size or condition is a trigger, never a note.
 * Read by stock-context.ts.
 */
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

export const NOTE_CHARS = 1_200;

/** Returns the new line's id. */
export function writeNote(args: { thesisId: string; text: string; runId?: string | null; priceAtTime?: number | null }) {
  const text = args.text.trim().slice(0, NOTE_CHARS);
  return writeThesisUpdate({
    thesisId: args.thesisId,
    type: "NOTE",
    summary: text.split("\n")[0].slice(0, 140),
    rationale: text,
    runId: args.runId ?? null,
    priceAtTime: args.priceAtTime ?? null,
  });
}
