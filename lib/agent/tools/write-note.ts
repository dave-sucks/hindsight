/**
 * write_note — the principal's note on a stock, from /chat (docs/plans/
 * AGENT_CONTEXT.md §3.1). DOCU 2026-09-30: why the starter was small and what
 * would change their mind were settled in an unscoped chat and reached nobody.
 * Works unscoped (the thesis names its analyst) once the thesis is checked as
 * this user's. Information only: trades nothing, changes no plan.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { writeNote, NOTE_CHARS } from "@/lib/agent/notes";
import { getLiveQuote } from "@/lib/market-data/live-quote";

export const writeNoteTool = defineTool({
  description:
    "Write the principal's note on a stock's thesis: their reasoning, what they are waiting for, what would change their mind, in their words. Information only — a price, size or condition they agreed to is a trigger or an edit on the stock (update_thesis), never text in a note. Only after they said yes on the question card, or asked for the note by name. The analyst reads their newest notes first on every review.",
  schema: z.object({
    thesis_id: z.string().describe("The thesis the note belongs on (list_theses_all or get_theses gives it)."),
    text: z.string().min(10).max(NOTE_CHARS).describe("The note, in the principal's words."),
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
      runId: ctx.runId ?? null,
      priceAtTime: quote.quote?.c ?? null,
    });
    return {
      summary: id ? `Note written on $${thesis.ticker} (${id}).` : `The note on $${thesis.ticker} did not save.`,
      data: { items: [{ kind: "ticker" as const, ticker: thesis.ticker, text: args.text.slice(0, 140) }] },
      sources: [],
    };
  },
});
