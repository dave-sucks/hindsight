/**
 * write_market_note — the Market Reviewer's note: to one or several stocks,
 * one analyst or the whole account. Saved as a SharedNote with author
 * MARKET_REVIEWER, so Activity names it.
 *
 * Each stock it names gets its own level: CONTEXT (read on its next look),
 * REVIEW (the PINNED_NOTE situation until a run writes on it), URGENT (a run
 * starts on it once the reviewer's brief is saved: lib/agent/market-reviewer/run.ts)
 * or PROPOSAL (about the sale waiting on it, shown on that proposal's card).
 * A stock with a sale waiting is off its analyst's list, so a note asking for
 * a look there goes on the proposal instead; that change is said back.
 * A note is evidence: it trades nothing and changes no plan.
 *
 * Each field has its own limit (NOTE_FIELD_CHARS); a call with a field over
 * it is refused once, naming every field over and by how much. A note names
 * at most 5 stocks, and is refused whole, with its overage, past the 2,000
 * characters a note keeps. An URGENT stock (the one path to a run no one
 * started) must name what it hits: a held stock its numbered condition, a
 * watched one a condition or the catalyst; a run marks at most 3 stocks
 * urgent, counted before the note is written so calls in one step can't all
 * pass (startUrgentRuns holds the same cap). A stock's
 * line quotes the first words of the condition or assumption it cites, from
 * the thesis, so a reader sees the claim the note says it touches.
 * Check only (`ctx.dryRun`, the no-save run): every rule runs, nothing is
 * saved, and the note comes back on `data.note`.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { NOTE_LEVELS, SHARED_NOTE_CHARS, levelWords, type NoteAudience, type NoteLevel } from "@/lib/agent/shared-notes";
import { writeSharedNote } from "@/lib/agent/shared-notes.server";
import { etToday } from "@/lib/market-data/market-calendar";
import { NOTE_FIELD_CHARS, firstWords } from "./market-note-fields";

export { MARKET_NOTE_CHARS, NOTE_FIELD_CHARS, QUOTE_CHARS, firstWords } from "./market-note-fields";

const LIVE = ["HOLDING", "WATCHING"] as const;
/** A note names at most this many stocks: past it, split the finding. */
export const NOTE_STOCKS_MAX = 5;
/** A run marks at most this many stocks urgent: each starts a run no one asked for. */
export const URGENT_PER_RUN = 3;
/** The stocks each run has marked urgent so far (one run is one process: lib/agent/market-reviewer/run.ts). */
const urgentByRun = new Map<string, Set<string>>();
/** The run is over: forget its count (lib/agent/market-reviewer/run.ts calls this when the model call ends). */
export function forgetUrgentCount(runId: string): void {
  urgentByRun.delete(runId);
}
const SALES = ["CLOSE", "PARTIAL_CLOSE"];
const TOUCHES = ["the catalyst", "a new risk", "nothing named"];
// "condition 2", or "condition 2" with the model's own quote after it: the tool quotes the thesis's words either way.
const CITED = /^(condition|assumption) (\d+)\b/;

/** The schema's ceiling is twice the limit, so the model is never cut off mid-sentence; the tool checks the limit. */
const text = (min: number, limit: number, what: string) => z.string().min(min).max(limit * 2).describe(`${what} ${limit} characters at most.`);

export const writeMarketNote = defineTool({
  description:
    "Write a note where a development matters to a stock's thesis: to one or several stocks in the book, one analyst, or the whole account. A finding about a sector or a group is ONE note naming each affected stock, each with its own level and impact. It is evidence: it trades nothing and changes no plan. Most days you write none.",
  schema: z.object({
    title: text(5, NOTE_FIELD_CHARS.title, "A short title: what happened, in a few words."),
    stocks: z
      .array(
        z.object({
          ticker: z.string(),
          level: z.enum(NOTE_LEVELS).describe("This stock's level, by the rules in your instructions."),
          touches: z
            .string()
            .describe(
              'What of its written claim it bears on: "condition N" or "assumption N" (its number in your inputs) whenever the development bears on that line, and at URGENT only a line it does what it says; "a new risk" only for a risk none of its numbered lines names; otherwise "the catalyst" or "nothing named". The note quotes the line you cite.',
            ),
          impact: text(5, NOTE_FIELD_CHARS.impact, "How much it affects this stock, and why, in one sentence."),
        }),
      )
      .optional()
      .describe("For a note to stocks: each stock from the book it names, with its level."),
    analyst_id: z.string().optional().describe("For a note to one analyst: its id from your inputs."),
    whole_account: z.boolean().optional().describe("For a note to the whole account."),
    evidence: text(10, NOTE_FIELD_CHARS.evidence, "What happened, in a sentence or two."),
    source_title: text(1, NOTE_FIELD_CHARS.source_title, "The outlet and headline: a headline from your inputs or a page from this run's searches."),
    source_url: z.string().max(400).describe("Its link, when it has one; empty otherwise. Not counted in the note's length."),
    source_date: z.string().describe("YYYY-MM-DD: the day it was reported."),
    meaning: text(10, NOTE_FIELD_CHARS.meaning, "What it means for the stocks named, in one sentence."),
    check: text(10, NOTE_FIELD_CHARS.check, "What the analyst should check."),
    about_date: z
      .string()
      .optional()
      .describe("Only a FUTURE date the note is about, YYYY-MM-DD: a report, a ruling, a vote, a market date ahead. Never the date of the news. Empty when there is none."),
  }),
  ui: "tool-ui" as const,
  progressLabel: (args) => `Writing a note${args?.title ? `: ${args.title}` : ""}`,

  execute: async (args, ctx) => {
    const named = [...new Map((args.stocks ?? []).map((s) => [s.ticker.trim().toUpperCase(), s] as const)).entries()].filter(([t]) => t);
    if (named.length > NOTE_STOCKS_MAX) {
      return { summary: `Nothing written: the note names ${named.length} stocks, ${NOTE_STOCKS_MAX} at most. Name the ${NOTE_STOCKS_MAX} it bears on most, or split it.`, data: { items: [] }, sources: [] };
    }
    const analystId = args.analyst_id?.trim() || null;
    const audience: NoteAudience | null = named.length > 0 ? "STOCKS" : analystId ? "ANALYST" : args.whole_account ? "ACCOUNT" : null;
    if (!audience) return { summary: "Name who the note is for: stocks, analyst_id or whole_account. Nothing written.", data: { items: [] }, sources: [] };

    const said: string[] = [];
    const wrong: string[] = [];
    const over = (what: string, value: string, limit: number) => {
      const n = value.trim().length;
      if (n > limit) wrong.push(`${what} is ${n} characters, ${limit} at most (cut ${n - limit})`);
    };
    let stocks: Array<{ ticker: string; level: NoteLevel; touches: string; impact: string }> = [];
    if (audience === "STOCKS") {
      // Only stocks we hold or watch in this run's book: a run reads the note there.
      const book = ctx.runEnvironment ? { researchRun: { agentConfig: { accountId: ctx.accountId, tradingEnvironment: ctx.runEnvironment } } } : {};
      const [live, sales] = await Promise.all([
        prisma.thesis.findMany({
          where: { userId: ctx.userId, ticker: { in: named.map(([t]) => t) }, status: { in: [...LIVE] }, ...book },
          select: { id: true, ticker: true, status: true, keyAssumptions: true, invalidationConds: true, researchUpdatedAt: true },
          // One answer when two analysts watch a stock: the holding, then the newest research (the inputs pick the same).
          orderBy: [{ researchUpdatedAt: "desc" }, { id: "asc" }],
        }),
        prisma.order.findMany({
          where: { status: "AWAITING_APPROVAL", intent: { in: SALES }, symbol: { in: named.map(([t]) => t) }, position: { accountId: ctx.accountId, ...(ctx.runEnvironment ? { environment: ctx.runEnvironment } : {}) } },
          select: { symbol: true },
        }),
      ]);
      const onBook = new Set(live.map((t) => t.ticker.toUpperCase()));
      const saleWaiting = new Set(sales.map((o) => o.symbol.toUpperCase()));
      // The claim a stock's note cites: its holding's, else the first watch with one (the inputs show the same).
      const claimOf = (t: string) => {
        const mine = live.filter((x) => x.ticker.toUpperCase() === t);
        return mine.find((x) => x.status === "HOLDING") ?? mine[0];
      };
      const left = named.filter(([t]) => !onBook.has(t)).map(([t]) => t);
      if (left.length) said.push(`not held or watched, left out: ${left.join(", ")}`);
      stocks = named
        .filter(([t]) => onBook.has(t))
        .map(([t, s]) => {
          let level = s.level as NoteLevel;
          // A stock with a sale waiting is the owner's to decide: a note asking for a look there goes on the proposal.
          if (saleWaiting.has(t) && (level === "REVIEW" || level === "URGENT")) {
            said.push(`${t} has a sale waiting, so the note goes on that proposal for the owner`);
            level = "PROPOSAL";
          } else if (!saleWaiting.has(t) && level === "PROPOSAL") {
            said.push(`${t} has no sale waiting, so it is context`);
            level = "CONTEXT";
          }
          over(`${t}'s impact`, s.impact, NOTE_FIELD_CHARS.impact);
          const asked = s.touches.trim().toLowerCase();
          const cited = CITED.exec(asked);
          // Urgent starts a run no one asked for: it names the line it hits.
          if (level === "URGENT") {
            const held = claimOf(t)?.status === "HOLDING";
            const hits = cited?.[1] === "condition" || (!held && asked === "the catalyst");
            if (!hits) wrong.push(held ? `${t} is urgent, so its touches is the numbered condition it hits ("condition N")` : `${t} is urgent, so its touches is a condition it hits ("condition N") or "the catalyst"`);
          }
          let touches = asked;
          if (cited) {
            const claim = claimOf(t);
            const lines = cited[1] === "condition" ? (claim?.invalidationConds ?? []) : (claim?.keyAssumptions ?? []);
            const line = lines[Number(cited[2]) - 1];
            if (line) touches = `${cited[0]} ("${firstWords(line)}")`;
            else wrong.push(`${t} has ${lines.length} ${cited[1]}${lines.length === 1 ? "" : "s"}, so "${cited[0]}" isn't one`);
          } else if (!TOUCHES.includes(asked)) {
            wrong.push(`${t}'s touches is "${s.touches}": say "condition N", "assumption N", "the catalyst", "a new risk" or "nothing named"`);
          }
          return { ticker: t, level, touches, impact: s.impact.trim() };
        });
      if (stocks.length === 0) return { summary: `None of ${left.join(", ")} is held or watched — nothing written.`, data: { items: [] }, sources: [] };
    }
    if (audience === "ANALYST") {
      const own = await prisma.agentConfig.findFirst({ where: { id: analystId!, accountId: ctx.accountId }, select: { id: true } });
      if (!own) return { summary: `No analyst ${analystId} on this account — nothing written.`, data: { items: [] }, sources: [] };
    }
    // At most URGENT_PER_RUN stocks urgent in a run.
    const urgentSoFar = urgentByRun.get(ctx.runId) ?? new Set<string>();
    const newUrgent = stocks.filter((s) => s.level === "URGENT" && !urgentSoFar.has(s.ticker)).map((s) => s.ticker);
    if (urgentSoFar.size + newUrgent.length > URGENT_PER_RUN) {
      const room = Math.max(0, URGENT_PER_RUN - urgentSoFar.size);
      wrong.push(
        `this run has marked ${urgentSoFar.size ? [...urgentSoFar].join(", ") : "no stock"} urgent and ${URGENT_PER_RUN} is the most a run may, so ${newUrgent.slice(room).join(", ")} can't be: mark it to review`,
      );
    }
    over("title", args.title, NOTE_FIELD_CHARS.title);
    over("evidence", args.evidence, NOTE_FIELD_CHARS.evidence);
    over("source_title", args.source_title, NOTE_FIELD_CHARS.source_title);
    over("meaning", args.meaning, NOTE_FIELD_CHARS.meaning);
    over("check", args.check, NOTE_FIELD_CHARS.check);
    if (wrong.length) {
      return { summary: `Nothing written: ${wrong.join("; ")}. Fix those and send it again.`, data: { items: [] }, sources: [] };
    }

    // A date the note is about is ahead of today; the news's own date goes in source_date.
    const about = args.about_date?.trim() ?? "";
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(about) && about > etToday(new Date()) ? about : null;
    if (about && !eventDate) said.push(`about_date ${about} dropped: it is only a future date the note is about`);

    const source = `(${args.source_title.trim()}, ${args.source_date.trim()})${args.source_url.trim() ? ` ${args.source_url.trim()}` : ""}`;
    const body = [
      args.title.trim(),
      ...stocks.map((s) => `${s.ticker}${levelWords(s.level) || " · context"} · ${s.touches}: ${s.impact}`),
      `${args.evidence.trim()} ${source}`,
      `What it means: ${args.meaning.trim()}`,
      `To check: ${args.check.trim()}`,
    ].join("\n");
    // A note keeps SHARED_NOTE_CHARS, its link and every stock's line in; past that it would be cut, so it is refused.
    if (body.length > SHARED_NOTE_CHARS) {
      return { summary: `Nothing written: the note is ${body.length.toLocaleString("en-US")} characters with its link, ${SHARED_NOTE_CHARS.toLocaleString("en-US")} at most (cut ${body.length - SHARED_NOTE_CHARS}). Name fewer stocks or shorten their lines.`, data: { items: [] }, sources: [] };
    }

    const note = {
      userId: ctx.userId,
      author: "MARKET_REVIEWER" as const,
      runId: ctx.runId ?? null,
      body,
      audience,
      analystId,
      tickers: stocks.map((s) => s.ticker),
      eventDate,
      levels: Object.fromEntries(stocks.map((s) => [s.ticker, s.level])),
    };
    // Counted before the write's await: every check above ran with no await between it and here, so a call
    // in the same step, resuming after this one, sees these stocks already counted.
    if (newUrgent.length) urgentByRun.set(ctx.runId, new Set([...urgentSoFar, ...newUrgent]));
    let id: string;
    try {
      ({ id } = ctx.dryRun ? { id: "not-saved" } : await writeSharedNote(note));
    } catch (err) {
      if (newUrgent.length) urgentByRun.set(ctx.runId, urgentSoFar);
      throw err;
    }

    const urgent = stocks.filter((s) => s.level === "URGENT").map((s) => `$${s.ticker}`);
    const to = audience === "STOCKS" ? stocks.map((s) => `$${s.ticker}${levelWords(s.level)}`).join(", ") : audience === "ANALYST" ? "that analyst" : "the whole account";
    return {
      summary:
        `Note written to ${to} (${id}).` +
        (said.length ? ` Changed: ${said.join("; ")}.` : "") +
        (urgent.length ? ` A run starts on ${urgent.join(", ")} once the brief is saved.` : ""),
      data: {
        noteId: id,
        ...(ctx.dryRun ? { dry_run: true, note } : {}),
        items:
          audience === "STOCKS"
            ? stocks.map((s) => ({ kind: "ticker" as const, ticker: s.ticker, text: `${args.title}${levelWords(s.level)} · ${s.touches}: ${s.impact}` }))
            : [{ kind: "generic" as const, text: `To ${to}: ${args.title}` }],
      },
      sources: args.source_url.trim() ? [{ provider: args.source_title, title: args.title, url: args.source_url.trim() }] : [],
    };
  },
});
