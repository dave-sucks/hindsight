/**
 * The Market Reviewer V1: one run per traded book at 7:30 AM ET each weekday
 * (lib/inngest/functions/market-reviewer.ts). One call to the model, like
 * the 8 PM Portfolio Digest's (lib/agent/digest-writer.ts): its instructions
 * and one first message (the portfolio snapshot, each stock's belief in a
 * line, its own last digest), with OpenAI's own web search as its one tool.
 * The model searches inside that call; its reply is the digest, and the job
 * saves it. The request is kept exactly as sent, for the run page's Context.
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

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
const belief = (text: string | null) => {
  const t = text?.replace(/\s+/g, " ").trim();
  const first = t?.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t;
  return !first ? "no belief written" : first.length > BELIEF_CHARS ? `${first.slice(0, BELIEF_CHARS).trimEnd()}…` : first;
};

/** Its first message: the portfolio snapshot, each stock held or watched with its belief in a line, then its own last digest. */
export async function bookMessage(book: ReviewBook, now: Date): Promise<string> {
  const today = etDateOf(now);
  const [theses, snapshot, last] = await Promise.all([
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
  ]);
  const held = new Set((snapshot?.holdings ?? []).map((h) => h.ticker.toUpperCase()));
  // One line a stock: its holding's thesis when two analysts cover it.
  const rows = new Map<string, (typeof theses)[number]>();
  for (const t of theses) {
    const k = t.ticker.toUpperCase();
    if (!rows.has(k) || (t.status === "HOLDING" && rows.get(k)!.status !== "HOLDING")) rows.set(k, t);
  }
  const line = (t: (typeof theses)[number]) => `- ${t.ticker.toUpperCase()} · ${belief(t.coreBelief)}`;
  const isHeld = (t: (typeof theses)[number]) => t.status === "HOLDING" || held.has(t.ticker.toUpperCase());
  const all = [...rows.values()];
  const list = (rows: typeof all) => (rows.length ? rows.map(line) : ["- none"]);
  return [
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
    "## Your last digest",
    last ? `Written for ${day(last.date.toISOString().slice(0, 10))}:\n\n${last.digest}` : "None yet: this is your first.",
  ].join("\n");
}

/** What the call searched, in one line for the run page. */
const searchedLine = (searches: string[]) => `Searched the web ${searches.length} time${searches.length === 1 ? "" : "s"}: ${searches.map((q) => `“${q}”`).join(" · ")}`;

/**
 * The run's one call. Its reply is the digest (`digest`), or null when the
 * call failed or was cut off; the record names why. Never throws.
 */
export async function writeMarketReview(book: ReviewBook, opts: { now?: Date } = {}): Promise<OneCall & { digest: string | null; searches: string[] }> {
  const startedAt = new Date().toISOString();
  const first = await bookMessage(book, opts.now ?? new Date());
  // The request body, kept as it goes to OpenAI.
  const body = {
    model: REVIEWER_MODEL,
    input: [
      { role: "system" as const, content: buildMarketReviewerPrompt() },
      { role: "user" as const, content: first },
    ],
    tools: [{ type: "web_search" as const }],
    max_output_tokens: REPLY_TOKENS,
  };
  const done = (digest: string | null, searches: string[], error?: string) => ({
    request: { v: 1 as const, call: "Main", source: "market-reviewer", model: REVIEWER_MODEL, startedAt, endedAt: new Date().toISOString(), requests: [body], ...(error ? { error } : {}) },
    thread: [
      body.input[1],
      ...(searches.length || digest
        ? [{ role: "assistant", content: [...(searches.length ? [searchedLine(searches)] : []), ...(digest ? [digest] : [])].map((text) => ({ type: "text", text })) }]
        : []),
    ],
    digest,
    searches,
  });
  try {
    const resp = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" }).responses.create(body, { timeout: CALL_MS });
    const searches = resp.output.flatMap((o) =>
      o.type === "web_search_call" && o.action?.type === "search" ? (o.action.queries?.length ? o.action.queries : o.action.query ? [o.action.query] : []) : [],
    );
    const text = resp.output_text?.trim() ?? "";
    if (resp.status === "incomplete") return done(null, searches, `The reply was cut off: ${resp.incomplete_details?.reason ?? "incomplete"}.`);
    if (!text) return done(null, searches, "The model replied with no text.");
    return done(text, searches);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`[market-reviewer] model call failed: ${why}`);
    return done(null, [], why);
  }
}
