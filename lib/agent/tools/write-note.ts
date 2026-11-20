/**
 * write_note — a note on a stock, one tool for every agent. In a run it is the
 * analyst's note and the review's verdict, saved through `saveThesis`
 * (update-thesis.ts): after a trade the run proposed, it is the proposal's
 * reason (lib/proposals/auto-writeup.ts). In the chat it is the principal's
 * note (docs/plans/AGENT_CONTEXT.md §3.1). DOCU 2026-09-30: why the starter was small and what would change
 * their mind were settled in an unscoped chat and reached nobody. Works
 * unscoped once the stock or analyst is checked as this user's. Information
 * only: trades nothing, changes no plan.
 *
 * On one stock it is a NOTE line in the stock's Activity. To several stocks,
 * one analyst or the whole account it is one shared note, written
 * once and read by every stock it covers (lib/agent/shared-notes.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { writeNote, NOTE_CHARS } from "@/lib/agent/notes";
import { saveThesis } from "@/lib/agent/tools/update-thesis";
import { thesisFields } from "@/lib/agent/tools/thesis-fields";
import { reviewProblem, verdictOf } from "@/lib/agent/thesis-review";
import { isManagerRun } from "@/lib/agent/portfolio-manager/limits";
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

/**
 * Whether a broken thesis on a holding has its sale: the whole holding's sale
 * waits for the owner now (one proposed in this run is waiting), or the owner
 * declined it after the thesis was first called BROKEN. A trim, a sale that
 * lapsed, and a sale from before it broke are not that sale. False when the
 * orders can't be read: the note then says to propose it.
 */
async function saleOnRecord(thesisId: string, ticker: string, userId: string): Promise<boolean> {
  const ofThisHolding = { side: "SELL", intent: "CLOSE", OR: [{ thesisId }, { position: { userId, symbol: ticker, status: "OPEN" } }] };
  try {
    if (await prisma.order.findFirst({ where: { ...ofThisHolding, status: "AWAITING_APPROVAL" }, select: { id: true } })) return true;
    const broke = await prisma.thesisUpdate.findFirst({ where: { thesisId, verdict: "BROKEN" }, orderBy: { timestamp: "asc" }, select: { timestamp: true } });
    if (!broke) return false;
    return !!(await prisma.order.findFirst({ where: { ...ofThisHolding, status: "REJECTED", updatedAt: { gte: broke.timestamp } }, select: { id: true } }));
  } catch {
    return false;
  }
}

const F = thesisFields();

/** The analyst's note, in a run. */
const RUN_NOTE =
  "Your note, written by How you write: what happened to the company and the stock and why, whether it touches why we own it, and what you did; after a trade you proposed this run, it is the reason on the proposal.";

const schema = z.object({
  thesis_id: z.string().optional().describe("The stock's thesis id."),
  // A run's note has no length cap, as update_thesis's rationale had none; the chat's keeps main's (below).
  note: z.string().min(10).describe(RUN_NOTE),
  verdict: F.verdict.optional(),
  verdict_line: F.verdict_line.optional(),
  // A review may move the thesis's state in the same save (lib/agent/thesis-review.ts).
  conviction: F.conviction.optional(),
  conviction_rationale: F.conviction_rationale.optional(),
  outlook: F.outlook.optional(),
  outlook_reason: F.outlook_reason.optional(),
  answers_update_id: F.answers_update_id.optional(),
  trigger_id: z.string().optional().describe("The fired trigger this note answers, by id, when more than one fired."),
  // The chat's: the principal's note to several stocks, one analyst or the account.
  tickers: z.array(z.string()).optional().describe("For one note to two or more stocks: their tickers."),
  analyst_id: z.string().optional().describe("For a note every run of one analyst reads at the top."),
  whole_account: z.boolean().optional().describe("For a note every run reads at the top."),
  pinned_until: z
    .string()
    .optional()
    .describe("YYYY-MM-DD: keep a note to several stocks above their Activity lines until then, at most two weeks, so every look at them reads it first. A note to an analyst or the account lasts a week unless given an end."),
  about_date: z.string().optional().describe("YYYY-MM-DD: the market date the note is about, when there is one."),
});

const THE_CHATS = { thesis_id: true, note: true, tickers: true, analyst_id: true, whole_account: true, pinned_until: true, about_date: true } as const;
/** A look by the stock's analyst: the note that ends a review, with its verdict and any change to conviction or outlook. */
const A_LOOKS = { thesis_id: true, note: true, verdict: true, verdict_line: true, conviction: true, conviction_rationale: true, outlook: true, outlook_reason: true, answers_update_id: true, trigger_id: true } as const;
/** Every other run's note: the stock and the text. */
const A_RUNS = { thesis_id: true, note: true } as const;
/** The runs that review a thesis: the morning run and the trigger run. */
/** The post-trade write-up shares the trigger run's mode and is not one: its trade is made, and its note is that trade's reason. */
const isLook = (ctx: { runMode?: string; afterAutoTrade?: boolean }) => (ctx.runMode === "MORNING_PLAN" || ctx.runMode === "INTRADAY_TACTICAL") && !ctx.afterAutoTrade;
const isChat = (ctx: { runMode?: string }) => ctx.runMode === "PRINCIPAL_CHAT";

/** Each caller's fields: a run's note has a thesis; a trigger run's thesis and trigger are code's; the Portfolio Manager's note has no verdict. */
function schemaFor(ctx: { runMode?: string; runStock?: unknown; afterAutoTrade?: boolean }) {
  if (isChat(ctx)) return schema.pick(THE_CHATS).extend({ note: z.string().min(10).max(Math.max(NOTE_CHARS, SHARED_NOTE_CHARS)).describe("The note, in the principal's words.") });
  const thesis_id = z.string().describe("The stock's thesis id.");
  if (!isLook(ctx)) return schema.pick(A_RUNS).extend({ thesis_id });
  // A look ends with its verdict: a note sent without one comes back with what to send (reviewProblem), not a schema error.
  const look = schema.pick(A_LOOKS).extend({ thesis_id });
  return ctx.runStock ? look.omit({ thesis_id: true, trigger_id: true }) : look;
}

export const writeNoteTool = defineTool({
  description: "Writes your note on a stock: one line in its Activity that the owner and the next run on it read, ending a review with your verdict.",
  descriptionFor: (ctx) =>
    isChat(ctx)
      ? "Writes the principal's note: their reasoning, what they are waiting for, what would change their mind, in their words. On one stock (thesis_id), or once to several stocks (tickers), one analyst or the whole account, where every stock it covers reads it. Information only — a price, size or condition they agreed to is a trigger (edit_triggers) or a trade, never text in a note. Only after they said yes on the question card, or asked for the note by name. The analyst reads their newest notes first on every review."
      : isLook(ctx)
        ? "Ends your look at a stock: one note in its Activity that the owner and the next run read, with your verdict on the thesis. If the evidence changed how confident you are, or what you expect of the stock, send the new conviction or outlook with its reason in this same call."
        : "Writes your note on a stock: one line in its Activity that the owner and the next run on it read.",
  schema,
  schemaFor,
  // A trigger run notes its own stock and the trigger that fired (tactical-run.ts).
  fromRun: (ctx) => (ctx.runStock ? { thesis_id: ctx.runStock.thesisId, trigger_id: ctx.runStock.triggerId } : null),
  ui: "tool-ui" as const,
  gateLog: "write_note",
  progressLabel: () => "Writing a note",

  execute: async (args, ctx) => {
    if (!isChat(ctx)) {
      if (!args.thesis_id) return { summary: "Name the stock's thesis_id. Nothing written.", data: { ok: false, error: "no_thesis" }, sources: [] };
      if (isLook(ctx)) {
        const row = await prisma.thesis.findFirst({ where: { id: args.thesis_id, userId: ctx.userId }, select: { ticker: true, status: true, direction: true, conviction: true, outlook: true } });
        if (row) {
          const holding = row.status === "HOLDING";
          const problem = reviewProblem({
            verdict: args.verdict,
            verdictLine: args.verdict_line,
            convictionFrom: row.conviction,
            convictionTo: args.conviction,
            convictionReason: args.conviction_rationale,
            outlookFrom: row.outlook,
            outlookTo: args.outlook,
            outlookReason: args.outlook_reason,
            hasView: row.direction === "LONG" || row.direction === "SHORT",
            holding,
            saleOnRecord: holding && verdictOf(args.verdict) === "BROKEN" ? await saleOnRecord(args.thesis_id, row.ticker, ctx.userId) : false,
          });
          if (problem) return { summary: `Nothing written on $${row.ticker}. ${problem}`, data: { ok: false, error: "review_not_ended", fix: problem }, sources: [] };
        }
      }
      const saved = await saveThesis(
        {
          thesis_id: args.thesis_id,
          rationale: args.note,
          verdict: args.verdict,
          verdict_line: args.verdict_line,
          conviction: args.conviction,
          conviction_rationale: args.conviction_rationale,
          outlook: args.outlook,
          outlook_reason: args.outlook_reason,
          answers_update_id: args.answers_update_id,
          trigger_id: args.trigger_id,
        },
        ctx,
      );
      return { ...saved, ui: "thesis-card" as const };
    }
    const tickers = [...new Set((args.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))];

    // One stock: a NOTE line in its Activity, as before.
    const oneStock = args.thesis_id
      ? await prisma.thesis.findFirst({ where: { id: args.thesis_id, userId: ctx.userId }, select: { id: true, ticker: true } })
      : tickers.length === 1 && !args.analyst_id && !args.whole_account
        ? await prisma.thesis.findFirst({
            where: { userId: ctx.userId, ticker: tickers[0], status: { in: [...LIVE] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, ticker: true },
          })
        : null;
    if (args.thesis_id && !oneStock) return { summary: `No thesis ${args.thesis_id} on this account — nothing written.`, data: { items: [] }, sources: [] };
    if (oneStock) {
      const quote = await getLiveQuote(oneStock.ticker, { caller: "other", creds: ctx.alpacaCreds });
      const id = await writeNote({ thesisId: oneStock.id, text: args.note.slice(0, NOTE_CHARS), runId: ctx.runId ?? null, priceAtTime: quote.quote?.c ?? null });
      return {
        summary: id ? `Note written on $${oneStock.ticker} (${id}).` : `The note on $${oneStock.ticker} did not save.`,
        data: { items: [{ kind: "ticker" as const, ticker: oneStock.ticker, text: args.note.slice(0, 140) }] },
        sources: [],
      };
    }

    // More than one stock: one shared note. The first audience named is the one used.
    const audience: NoteAudience | null =
      tickers.length > 0 ? "STOCKS" : args.analyst_id ? "ANALYST" : args.whole_account ? "ACCOUNT" : null;
    if (!audience) {
      return { summary: "Name who the note is for: thesis_id for one stock, or tickers, analyst_id or whole_account. Nothing written.", data: { items: [] }, sources: [] };
    }
    if (audience === "ANALYST") {
      const own = await prisma.agentConfig.findFirst({ where: { id: args.analyst_id, userId: ctx.userId }, select: { id: true } });
      if (!own) return { summary: `No analyst ${args.analyst_id} on this account — nothing written.`, data: { items: [] }, sources: [] };
    }
    const { id, pinnedUntil, adjusted } = await writeSharedNote({
      userId: ctx.userId,
      author: "OWNER",
      runId: ctx.runId ?? null,
      body: args.note,
      audience,
      analystId: args.analyst_id ?? null,
      tickers,
      eventDate: args.about_date ?? null,
      pinnedUntil: endOfDay(args.pinned_until),
      creds: ctx.alpacaCreds,
    });
    const to = audience === "STOCKS" ? tickers.map((t) => `$${t}`).join(", ") : audience === "ANALYST" ? "that analyst's runs" : "every run";
    const until = pinnedUntil ? `, until ${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(pinnedUntil)}` : "";
    return {
      summary: `Note written to ${to}${until} (${id}).${adjusted.length ? ` Changed on save: ${adjusted.join("; ")}.` : ""}`,
      data: {
        items: [
          ...(audience === "STOCKS" ? tickers.map((t) => ({ kind: "ticker" as const, ticker: t, text: args.note.slice(0, 140) })) : [{ kind: "generic" as const, text: `To ${to}: ${args.note.slice(0, 140)}` }]),
        ],
      },
      sources: [],
    };
  },
});
