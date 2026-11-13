/**
 * The Market Reviewer V1: one run per traded book at 7:30 AM ET each weekday
 * (lib/inngest/functions/market-reviewer.ts). One call to the model, like
 * the 8 PM Portfolio Digest's (lib/agent/digest-writer.ts): its instructions
 * and one first message (the portfolio snapshot, each stock's belief in a
 * line, its own last digest), with OpenAI's own web search as its one tool.
 * The model searches inside that call; its reply is the digest and its notes
 * on the stocks its research touched (one JSON object, Structured Outputs),
 * and the job saves both. The request is kept exactly as sent, for the run
 * page's Context.
 */
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotText } from "@/lib/portfolio/snapshot";
import { MODES } from "@/lib/agent/modes";
import { buildMarketReviewerPrompt } from "@/lib/agent/market-reviewer/prompt";
import { etDateOf } from "@/lib/market-data/intraday-window";
import type { OneCall } from "@/lib/runs/account-run";

/** The morning runs' model. */
export const REVIEWER_MODEL = MODES["research-run"].model;
/** The reply's budget: its thinking and its searches count against it. */
const REPLY_TOKENS = 20_000;
/** How long the call may take. */
const CALL_MS = 600_000;
/** A belief is its first sentence, cut here. */
const BELIEF_CHARS = 160;

export interface ReviewBook {
  accountId: string;
  environment: "PAPER" | "LIVE";
  userId: string;
}

/** A note on stocks its first message named: what happened and what it means, how much it could matter, and which way it moves why we own or watch them. */
export interface ReviewNote {
  tickers: string[];
  text: string;
  impact: "low" | "medium" | "high";
  effect: "stronger" | "weaker" | "neutral";
}

/** How long a high note stays pinned: its stocks are on the next run's list until a run writes on them. */
const PIN_MS = 3 * 86_400_000;
/** A high note is pinned; a low or medium one is a line in each stock's Activity. */
export const notePin = (n: Pick<ReviewNote, "impact">, now: Date): Date | null => (n.impact === "high" ? new Date(now.getTime() + PIN_MS) : null);

/** The reply's shape: the digest and the notes. A note names only stocks from its first message. */
const replyFormat = (tickers: string[]) => ({
  type: "json_schema" as const,
  name: "market_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["digest", "notes"],
    properties: {
      digest: { type: "string" },
      notes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tickers", "text", "impact", "effect"],
          properties: {
            tickers: { type: "array", minItems: 1, items: tickers.length ? { type: "string", enum: tickers } : { type: "string" } },
            text: { type: "string" },
            impact: { type: "string", enum: ["low", "medium", "high"] },
            effect: { type: "string", enum: ["stronger", "weaker", "neutral"] },
          },
        },
      },
    },
  },
});

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
/** A text's first sentence, cut at BELIEF_CHARS. */
const firstSentence = (text: string | null) => {
  const t = text?.replace(/\s+/g, " ").trim();
  const first = t?.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t;
  return !first ? "no belief written" : first.length > BELIEF_CHARS ? `${first.slice(0, BELIEF_CHARS).trimEnd()}…` : first;
};
/** How far back its own notes are shown to it, so it doesn't file the same story again. */
const NOTES_SHOWN_MS = 5 * 86_400_000;

/** Its first message: the portfolio snapshot, each stock held or watched with its belief in a line, its own notes of the last 5 days, then its own last digest; and those stocks' tickers. */
export async function bookMessage(book: ReviewBook, now: Date): Promise<{ text: string; tickers: string[] }> {
  const today = etDateOf(now);
  const [theses, snapshot, last, notes] = await Promise.all([
    prisma.thesis.findMany({
      where: { userId: book.userId, status: { in: ["HOLDING", "WATCHING"] }, researchRun: { agentConfig: { accountId: book.accountId, tradingEnvironment: book.environment } } },
      select: { ticker: true, status: true, coreBelief: true },
      orderBy: [{ researchUpdatedAt: "desc" }, { id: "asc" }],
    }),
    // The account's numbers come from the one snapshot, never worked out here.
    loadPortfolioSnapshot({ accountId: book.accountId, environment: book.environment, now }).catch(() => null),
    // A last digest that can't be read is no reason to skip the morning: it reads as none.
    prisma.marketDigest
      .findFirst({ where: { accountId: book.accountId, environment: book.environment, date: { lt: new Date(`${today}T00:00:00.000Z`) } }, orderBy: { date: "desc" }, select: { date: true, digest: true } })
      .catch(() => null),
    // Its own notes, so it writes on a story again only when something new happened. A note has no
    // book (SharedNote has no environment), so the user's PAPER and LIVE books are shown the same notes.
    prisma.sharedNote
      .findMany({
        where: { userId: book.userId, author: "MARKET_REVIEWER", createdAt: { gte: new Date(now.getTime() - NOTES_SHOWN_MS) } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, tickers: true, impact: true, effect: true, body: true },
      })
      .catch(() => null),
  ]);
  const held = new Set((snapshot?.holdings ?? []).map((h) => h.ticker.toUpperCase()));
  // One line a stock: its holding's thesis when two analysts cover it.
  const rows = new Map<string, (typeof theses)[number]>();
  for (const t of theses) {
    const k = t.ticker.toUpperCase();
    if (!rows.has(k) || (t.status === "HOLDING" && rows.get(k)!.status !== "HOLDING")) rows.set(k, t);
  }
  const line = (t: (typeof theses)[number]) => `- ${t.ticker.toUpperCase()} · ${firstSentence(t.coreBelief)}`;
  const isHeld = (t: (typeof theses)[number]) => t.status === "HOLDING" || held.has(t.ticker.toUpperCase());
  const all = [...rows.values()];
  const list = (rows: typeof all) => (rows.length ? rows.map(line) : ["- none"]);
  const text = [
    `${day(today)}, the ${book.environment} book.`,
    "",
    "## The portfolio",
    snapshot ? snapshotText(snapshot) : "The portfolio couldn't be read this run.",
    "",
    "## Why we hold each, in a line",
    ...list(all.filter(isHeld)),
    "",
    "## What we watch, and why",
    ...list(all.filter((t) => !isHeld(t))),
    "",
    "## Your notes in the last 5 days",
    ...(!notes
      ? ["Your notes couldn't be read this run."]
      : notes.length
        ? notes.map((n) => `- ${[day(etDateOf(n.createdAt)), n.tickers.join(", "), n.impact, n.effect, firstSentence(n.body)].filter(Boolean).join(" · ")}`)
        : ["- none"]),
    "",
    "## Your last digest",
    last ? `Written for ${day(last.date.toISOString().slice(0, 10))}:\n\n${last.digest}` : "None yet: this is your first.",
  ].join("\n");
  return { text, tickers: all.map((t) => t.ticker.toUpperCase()) };
}

/** The tokens the call used, from OpenAI's own count. */
export interface ReviewUsage {
  in: number;
  out: number;
}

const n = (x: number) => x.toLocaleString("en-US");
/** What the call searched and the tokens it used, in one line for the run page. */
const searchedLine = (searches: string[], usage: ReviewUsage | null) =>
  [
    `Searched the web ${searches.length} time${searches.length === 1 ? "" : "s"}${searches.length ? `: ${searches.map((q) => `“${q}”`).join(" · ")}` : ""}.`,
    usage ? `Tokens: ${n(usage.in)} in, ${n(usage.out)} out.` : null,
  ]
    .filter(Boolean)
    .join(" ");
/** A note on the run page: a title the code writes, then the model's own text. */
const noteText = (note: ReviewNote, now: Date) =>
  `**Note on ${note.tickers.join(", ")} · ${note.impact} · ${note.effect}${notePin(note, now) ? " · flagged for review" : ""}**\n\n${note.text}`;

/**
 * The run's one call. Its reply is the digest (`digest`) and its notes, or a
 * null digest and no notes when the call failed, was cut off, or wasn't the
 * shape asked for; the record names why. Never throws.
 */
export async function writeMarketReview(
  book: ReviewBook,
  opts: { now?: Date } = {},
): Promise<OneCall & { digest: string | null; notes: ReviewNote[]; searches: string[]; usage: ReviewUsage | null }> {
  const startedAt = new Date().toISOString();
  const now = opts.now ?? new Date();
  const first = await bookMessage(book, now);
  // The request body, kept as it goes to OpenAI.
  const body = {
    model: REVIEWER_MODEL,
    input: [
      { role: "system" as const, content: buildMarketReviewerPrompt() },
      { role: "user" as const, content: first.text },
    ],
    tools: [{ type: "web_search" as const }],
    text: { format: replyFormat(first.tickers) },
    max_output_tokens: REPLY_TOKENS,
  };
  const done = (digest: string | null, notes: ReviewNote[], searches: string[], usage: ReviewUsage | null, error?: string) => {
    const said = [...(usage || searches.length ? [searchedLine(searches, usage)] : []), ...(digest ? [digest] : []), ...notes.map((note) => noteText(note, now))];
    return {
      request: { v: 1 as const, call: "Main", source: "market-reviewer", model: REVIEWER_MODEL, startedAt, endedAt: new Date().toISOString(), requests: [body], ...(error ? { error } : {}) },
      thread: [body.input[1], ...(said.length ? [{ role: "assistant", content: said.map((text) => ({ type: "text", text })) }] : [])],
      digest,
      notes,
      searches,
      usage,
    };
  };
  try {
    const resp = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" }).responses.create(body, { timeout: CALL_MS });
    const searches = resp.output.flatMap((o) =>
      o.type === "web_search_call" && o.action?.type === "search" ? (o.action.queries?.length ? o.action.queries : o.action.query ? [o.action.query] : []) : [],
    );
    const usage = resp.usage ? { in: resp.usage.input_tokens, out: resp.usage.output_tokens } : null;
    const text = resp.output_text?.trim() ?? "";
    if (resp.status === "incomplete") return done(null, [], searches, usage, `The reply was cut off: ${resp.incomplete_details?.reason ?? "incomplete"}.`);
    if (!text) return done(null, [], searches, usage, "The model replied with no text.");
    // The format is strict, so a reply that parses is the shape asked for.
    let reply: { digest: string; notes: ReviewNote[] } | null = null;
    try {
      reply = JSON.parse(text);
    } catch {
      /* answered below */
    }
    if (!reply?.digest?.trim()) return done(null, [], searches, usage, "The reply wasn't the digest and its notes.");
    return done(reply.digest.trim(), reply.notes ?? [], searches, usage);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`[market-reviewer] model call failed: ${why}`);
    return done(null, [], [], null, why);
  }
}
