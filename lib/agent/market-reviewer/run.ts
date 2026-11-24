/**
 * The Market Reviewer V1: one run per traded book at 9:00 AM ET each weekday
 * (lib/inngest/functions/market-reviewer.ts). Its record
 * (lib/agent/engine/agents/market-reviewer.ts) runs through the agent runner
 * (lib/agent/engine/run.ts): its instructions and one first message (the
 * market numbers, the portfolio snapshot, each stock's belief in a line, its
 * own last digest), with OpenAI's own web search as its one tool. The model
 * searches inside that one call; its reply is the digest and its notes on
 * the stocks its research touched (one JSON object, Structured Outputs), and
 * its own save keeps both.
 */
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { writeSharedNote } from "@/lib/agent/shared-notes.server";
import { runAgent, type AgentRun, type AgentToRun, type RunAgentArgs, type RunFor } from "@/lib/agent/engine/run";
import { MARKET_REVIEWER, reviewDay as day } from "@/lib/agent/engine/agents/market-reviewer";
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

/**
 * Sent once when a run saved a high note: the trigger check then reads the
 * triggers that watch its notes (lib/inngest/functions/trigger-evaluator.ts,
 * NOTES_SAVED). Every note is a line in each stock's Activity; none is pinned.
 */
const NOTES_SAVED = "app/market-notes.saved";

export const REVIEWER_MODEL = MARKET_REVIEWER.model;
export const REVIEWER_RUN_MODE = "MARKET_REVIEWER";

/** A text's first sentence, cut at BELIEF_CHARS. */
const firstSentence = (text: string | null) => {
  const t = text?.replace(/\s+/g, " ").trim();
  const first = t?.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t;
  return !first ? "no belief written" : first.length > BELIEF_CHARS ? `${first.slice(0, BELIEF_CHARS).trimEnd()}…` : first;
};
/** How far back its own notes are shown to it, so it doesn't file the same story again. */
const NOTES_SHOWN_MS = 5 * 86_400_000;

/** The book's tickers: the stocks its notes may name. */
export async function reviewTickers(book: Pick<ReviewBook, "accountId" | "environment">): Promise<string[]> {
  const theses = await prisma.thesis.findMany({
    where: { status: { in: ["HOLDING", "WATCHING"] }, researchRun: { agentConfig: { accountId: book.accountId, tradingEnvironment: book.environment } } },
    select: { ticker: true },
  });
  return [...new Set(theses.map((t) => t.ticker.toUpperCase()))];
}

/** Its last output (the context's last_output): its own notes of the last 5 days and its last digest. */
export async function reviewerLastOutput(book: ReviewBook, now: Date): Promise<string> {
  const today = etDateOf(now);
  const [last, notes] = await Promise.all([
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
  const noteLines = !notes
    ? ["Your notes couldn't be read this run."]
    : notes.length
      ? notes.map((n) => `- ${[day(etDateOf(n.createdAt)), n.tickers.join(", "), n.impact, n.effect, firstSentence(n.body)].filter(Boolean).join(" · ")}`)
      : ["- none"];
  return [
    `## Your notes in the last 5 days\n${noteLines.join("\n")}`,
    `## Your last digest\n${last ? `Written for ${day(last.date.toISOString().slice(0, 10))}:\n\n${last.digest}` : "None yet: this is your first."}`,
  ].join("\n\n");
}

/** What its run is given: its subject, the account, whose facts the engine reads (lib/agent/context/), and its stocks for its reply's schema. No tools of ours. */
export async function reviewerArgs(book: Pick<RunFor, "accountId" | "environment" | "userId">, now: Date = new Date()): Promise<Omit<RunAgentArgs, "runId">> {
  return {
    input: { now, environment: book.environment, stocks: await reviewTickers(book) },
    subject: { kind: "account", userId: book.userId, accountId: book.accountId, environment: book.environment },
    toolset: {},
    source: "market-reviewer",
  };
}

export interface MarketReview {
  /** The digest, or null when the run failed or its reply had none. */
  digest: string | null;
  notes: ReviewNote[];
  /** What it searched the web for. */
  searches: string[];
  error?: string;
}

/** The review in its run's reply: the digest and its notes, and what it searched. */
export function reviewOf(run: AgentRun): MarketReview {
  const searches = run.steps.flatMap((s) =>
    (s.toolResults ?? []).flatMap((r) => {
      const action = (r.output as { action?: { type?: string; query?: string } } | undefined)?.action;
      return action?.type === "search" && action.query ? [action.query] : [];
    }),
  );
  if (run.error) return { digest: null, notes: [], searches, error: run.error };
  const reply = run.output as { digest?: string; notes?: ReviewNote[] } | undefined;
  if (!reply?.digest?.trim()) return { digest: null, notes: [], searches, error: "The reply wasn't the digest and its notes." };
  return { digest: reply.digest.trim(), notes: reply.notes ?? [], searches };
}

const n = (x: number) => x.toLocaleString("en-US");
/** What the call searched and the tokens it used, in one line for the run page. */
const searchedLine = (run: AgentRun, searches: string[]) =>
  [
    `Searched the web ${searches.length} time${searches.length === 1 ? "" : "s"}${searches.length ? `: ${searches.map((q) => `“${q}”`).join(" · ")}` : ""}.`,
    run.usage.requests ? `Tokens: ${n(run.usage.input)} in, ${n(run.usage.output)} out.` : null,
  ]
    .filter(Boolean)
    .join(" ");
/** A note on the run page: a title the code writes, then the model's own text. */
const noteText = (note: ReviewNote) => `**Note on ${note.tickers.join(", ")} · ${note.impact} · ${note.effect}**\n\n${note.text}`;

/** How its reply reads on the run page: what it searched, the digest, then each note. */
export function reviewThread(run: AgentRun): unknown[] {
  const review = reviewOf(run);
  const said = [...(run.usage.requests || review.searches.length ? [searchedLine(run, review.searches)] : []), ...(review.digest ? [review.digest] : []), ...review.notes.map(noteText)];
  return said.length ? [{ role: "assistant", content: said.map((text) => ({ type: "text", text })) }] : [];
}

/** Its own save: the day's digest for the book, and each note on its stocks; a saved high note starts the check of the triggers that watch notes. A note that doesn't save never fails the digest. */
export async function keepReview(runId: string, run: AgentRun, book: RunFor): Promise<string | void> {
  const review = reviewOf(run);
  if (!review.digest) return review.error;
  const now = new Date();
  const day = new Date(`${etDateOf(now)}T00:00:00.000Z`);
  await prisma.marketDigest.upsert({
    where: { accountId_environment_date: { accountId: book.accountId, environment: book.environment, date: day } },
    create: { accountId: book.accountId, environment: book.environment, date: day, digest: review.digest, model: REVIEWER_MODEL, runId },
    update: { digest: review.digest, model: REVIEWER_MODEL, runId, createdAt: now },
  });
  let high = 0;
  for (const note of review.notes) {
    try {
      await writeSharedNote({ userId: book.userId, author: "MARKET_REVIEWER", runId, body: note.text, audience: "STOCKS", tickers: note.tickers, impact: note.impact, effect: note.effect });
      if (note.impact === "high") high += 1;
    } catch (err) {
      console.warn(`[market-reviewer] a note on ${note.tickers.join(", ")} didn't save:`, err instanceof Error ? err.message : err);
    }
  }
  if (high === 0) return;
  try {
    await inngest.send({ name: NOTES_SAVED, data: { runId, high } });
  } catch (err) {
    console.warn("[market-reviewer] the note check wasn't started; the next pass in market hours reads the notes:", err);
  }
}

/** The Market Reviewer as the runner runs it: one saved run per traded book, read only. */
export const REVIEWER_RUN: AgentToRun = {
  record: MARKET_REVIEWER,
  mode: REVIEWER_RUN_MODE,
  args: (book) => reviewerArgs(book),
  thread: (run) => reviewThread(run),
  keep: keepReview,
};

/** The review with no run of its own (the wire test). Never throws. */
export async function writeMarketReview(book: ReviewBook, opts: { now?: Date; runId?: string | null } = {}): Promise<MarketReview & { run: AgentRun }> {
  const run = await runAgent(MARKET_REVIEWER, { ...(await reviewerArgs(book, opts.now)), runId: opts.runId ?? null });
  return { ...reviewOf(run), run };
}
