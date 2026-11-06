/**
 * write_note — the principal's note, from /chat (docs/plans/AGENT_CONTEXT.md
 * §3.1). DOCU 2026-09-30: why the starter was small and what would change
 * their mind were settled in an unscoped chat and reached nobody. Works
 * unscoped once the stock or analyst is checked as this user's. Information
 * only: trades nothing, changes no plan.
 *
 * On one stock it is a NOTE line in the stock's Activity. To several stocks,
 * a sector, one analyst or the whole account it is one shared note, written
 * once and read by every stock it covers (lib/agent/shared-notes.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { writeNote, NOTE_CHARS } from "@/lib/agent/notes";
import { getLiveQuote } from "@/lib/market-data/live-quote";
import { SHARED_NOTE_CHARS, type NoteAudience } from "@/lib/agent/shared-notes";
import { writeSharedNote } from "@/lib/agent/shared-notes.server";

const LIVE = ["HOLDING", "WATCHING", "PROMOTED"] as const;

/** The end of a New York day, from YYYY-MM-DD; null for anything else. */
function endOfDay(day: string | undefined): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.trim())) return null;
  const d = new Date(`${day.trim()}T23:59:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const writeNoteTool = defineTool({
  description:
    "Write the principal's note: their reasoning, what they are waiting for, what would change their mind, in their words. On one stock (thesis_id), or once to several stocks (tickers), a sector, one analyst or the whole account, where every stock it covers reads it. Information only — a price, size or condition they agreed to is a trigger or an edit on the stock (update_thesis), never text in a note. Only after they said yes on the question card, or asked for the note by name. The analyst reads their newest notes first on every review.",
  schema: z.object({
    thesis_id: z.string().optional().describe("For a note on one stock: its thesis (get_theses gives it)."),
    text: z.string().min(10).max(Math.max(NOTE_CHARS, SHARED_NOTE_CHARS)).describe("The note, in the principal's words."),
    tickers: z.array(z.string()).optional().describe("For one note to two or more stocks: their tickers."),
    sector: z.string().optional().describe("For a note to every stock we hold or watch in a sector, as the thesis names it."),
    analyst_id: z.string().optional().describe("For a note every run of one analyst reads at the top."),
    whole_account: z.boolean().optional().describe("For a note every run reads at the top."),
    pinned_until: z
      .string()
      .optional()
      .describe("YYYY-MM-DD: keep a note to several stocks in front of their runs until then, at most two weeks; each stock goes on the next run's list until a run answers it. A note to an analyst or the account lasts a week unless given an end."),
    about_date: z.string().optional().describe("YYYY-MM-DD: the market date the note is about, when there is one."),
  }),
  ui: "tool-ui" as const,
  progressLabel: () => "Writing a note",

  execute: async (args, ctx) => {
    const tickers = [...new Set((args.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))];

    // One stock: a NOTE line in its Activity, as before.
    const oneStock = args.thesis_id
      ? await prisma.thesis.findFirst({ where: { id: args.thesis_id, userId: ctx.userId }, select: { id: true, ticker: true } })
      : tickers.length === 1 && !args.sector && !args.analyst_id && !args.whole_account
        ? await prisma.thesis.findFirst({
            where: { userId: ctx.userId, ticker: tickers[0], status: { in: [...LIVE] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, ticker: true },
          })
        : null;
    if (args.thesis_id && !oneStock) return { summary: `No thesis ${args.thesis_id} on this account — nothing written.`, data: { items: [] }, sources: [] };
    if (oneStock) {
      const quote = await getLiveQuote(oneStock.ticker, { caller: "other", creds: ctx.alpacaCreds });
      const id = await writeNote({ thesisId: oneStock.id, text: args.text.slice(0, NOTE_CHARS), runId: ctx.runId ?? null, priceAtTime: quote.quote?.c ?? null });
      return {
        summary: id ? `Note written on $${oneStock.ticker} (${id}).` : `The note on $${oneStock.ticker} did not save.`,
        data: { items: [{ kind: "ticker" as const, ticker: oneStock.ticker, text: args.text.slice(0, 140) }] },
        sources: [],
      };
    }

    // More than one stock: one shared note. The first audience named is the one used.
    const audience: NoteAudience | null =
      tickers.length > 0 ? "STOCKS" : args.sector?.trim() ? "SECTOR" : args.analyst_id ? "ANALYST" : args.whole_account ? "ACCOUNT" : null;
    if (!audience) {
      return { summary: "Name who the note is for: thesis_id for one stock, or tickers, sector, analyst_id or whole_account. Nothing written.", data: { items: [] }, sources: [] };
    }
    if (audience === "ANALYST") {
      const own = await prisma.agentConfig.findFirst({ where: { id: args.analyst_id, userId: ctx.userId }, select: { id: true } });
      if (!own) return { summary: `No analyst ${args.analyst_id} on this account — nothing written.`, data: { items: [] }, sources: [] };
    }
    const { id, pinnedUntil, adjusted } = await writeSharedNote({
      userId: ctx.userId,
      author: "OWNER",
      runId: ctx.runId ?? null,
      body: args.text,
      audience,
      analystId: args.analyst_id ?? null,
      sector: args.sector ?? null,
      tickers,
      eventDate: args.about_date ?? null,
      pinnedUntil: endOfDay(args.pinned_until),
    });
    const to = audience === "STOCKS" ? tickers.map((t) => `$${t}`).join(", ") : audience === "SECTOR" ? `the ${args.sector} stocks` : audience === "ANALYST" ? "that analyst's runs" : "every run";
    const until = pinnedUntil ? `, until ${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(pinnedUntil)}` : "";
    return {
      summary: `Note written to ${to}${until} (${id}).${adjusted.length ? ` Changed on save: ${adjusted.join("; ")}.` : ""}`,
      data: {
        items: [
          ...(audience === "STOCKS" ? tickers.map((t) => ({ kind: "ticker" as const, ticker: t, text: args.text.slice(0, 140) })) : [{ kind: "generic" as const, text: `To ${to}: ${args.text.slice(0, 140)}` }]),
        ],
      },
      sources: [],
    };
  },
});
