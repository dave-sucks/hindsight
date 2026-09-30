/**
 * write_note — the principal's note on a stock, from /chat (docs/plans/
 * AGENT_CONTEXT.md §3.1). DOCU 2026-09-30: the size, the add at $74 and the IAM
 * case were settled in an unscoped chat and reached nobody. Works unscoped (the
 * thesis names its analyst) once the thesis is checked as this user's. Trades nothing.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { writeNote, NOTE_CHARS } from "@/lib/agent/notes";
import { getLiveQuote } from "@/lib/market-data/live-quote";

export const writeNoteTool = defineTool({
  description:
    "Write the principal's note on a stock's thesis — what was decided, what would change the mind, any size or level, in their words. Only after they said yes on the question card, or asked for the note by name. The analyst reads it first until it is replaced or resolved.",
  schema: z.object({
    thesis_id: z.string().describe("The thesis the note belongs on (list_theses_all or get_theses gives it)."),
    text: z.string().min(10).max(NOTE_CHARS).describe("The note, in the principal's words."),
    replaces_note_id: z.string().optional().describe("An earlier note of theirs this one takes the place of."),
  }),
  ui: "tool-ui" as const,
  progressLabel: () => "Writing a note on the stock",

  execute: async (args, ctx) => {
    const thesis = await prisma.thesis.findFirst({ where: { id: args.thesis_id, userId: ctx.userId }, select: { id: true, ticker: true } });
    if (!thesis) return { summary: `No thesis ${args.thesis_id} on this account — nothing written.`, data: { items: [] }, sources: [] };
    const quote = await getLiveQuote(thesis.ticker, { caller: "other", creds: ctx.alpacaCreds });
    const id = await writeNote({
      thesisId: thesis.id,
      text: args.text,
      author: "PRINCIPAL",
      via: "chat",
      runId: ctx.runId ?? null,
      priceAtTime: quote.quote?.c ?? null,
      replaces: args.replaces_note_id,
    });
    return {
      summary: id ? `Note written on $${thesis.ticker} (${id}).` : `The note on $${thesis.ticker} did not save.`,
      data: { items: [{ kind: "ticker" as const, ticker: thesis.ticker, text: args.text.slice(0, 140) }] },
      sources: [],
    };
  },
});
