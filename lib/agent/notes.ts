/**
 * notes.ts — a note on a stock: what the next reader must carry forward
 * (docs/plans/AGENT_CONTEXT.md §3.1). One `NOTE` Activity line. It stands until
 * a newer note names it in `replaces` or a resolution names it in `resolves`;
 * an analyst's newest note replaces its last. Read by stock-context.ts.
 */
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

export const NOTE_CHARS = 1_200;
export interface NoteMeta {
  author: "PRINCIPAL" | "ANALYST";
  via: string;
  replaces?: string;
  resolves?: string;
}

/** A note, or a line resolving one. Returns the new line's id. */
export function writeNote(args: NoteMeta & { thesisId: string; text: string; runId?: string | null; priceAtTime?: number | null }) {
  const { thesisId, text: raw, runId, priceAtTime, ...meta } = args;
  const text = raw.trim().slice(0, NOTE_CHARS);
  return writeThesisUpdate({
    thesisId,
    type: "NOTE",
    summary: (meta.resolves ? "Resolved a note: " : "") + text.split("\n")[0].slice(0, 140),
    rationale: text,
    fieldChanges: { note: { from: null, to: JSON.parse(JSON.stringify(meta)) } },
    runId: runId ?? null,
    priceAtTime: priceAtTime ?? null,
  });
}
