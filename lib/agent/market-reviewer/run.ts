/**
 * The Market Reviewer V1: one run per traded book at 7:30 AM ET each weekday
 * (lib/inngest/functions/market-reviewer.ts). It is given its instructions,
 * the portfolio snapshot (the one set of numbers every reader gets), each
 * stock's belief in a line, and its own last digest, and nothing else: it
 * finds the market's moves, the calendar and the news with its tools, and
 * ends by saving the digest. Its run is read only; the first request is kept
 * exactly as sent, and every tool call and result after it is in the thread.
 */
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import type { AlpacaCredentials } from "@/lib/alpaca";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotText } from "@/lib/portfolio/snapshot";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";
import { createToolContext } from "@/lib/agent/tool-context";
import { writeMarketDigest } from "@/lib/agent/tools/write-market-digest";
import { forgetPagesFound } from "@/lib/agent/tools/web-search";
import { buildMarketReviewerPrompt } from "@/lib/agent/market-reviewer/prompt";
import { etDateOf } from "@/lib/market-data/intraday-window";
import type { OneCall } from "@/lib/runs/account-run";

/** The morning runs' model. */
export const REVIEWER_MODEL = MODES["research-run"].model;
export const REVIEWER_STEPS = 25;
/** Its tools besides the one that saves the digest. */
const READ_TOOLS = ["web_search", "get_market_context", "get_stock_data", "get_theses"] as const;
/** What a save returned, when it saved the digest (a refused save carries neither). */
const savedDigest = (r: { toolName: string; output: unknown }) => {
  const o = r.output as { ok?: boolean; data?: { digest?: string; digestId?: string } } | undefined;
  return r.toolName === "write_market_digest" && o?.ok && (o.data?.digestId || o.data?.digest) ? o : null;
};
/** A belief is its first sentence, cut here. */
const BELIEF_CHARS = 160;

export interface ReviewBook {
  accountId: string;
  environment: "PAPER" | "LIVE";
  userId: string;
  creds?: AlpacaCredentials;
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

/** The run's call: the agent with its five tools, ending on the saved digest. Never throws: a failure is on its record. */
export async function writeMarketReview(book: ReviewBook, runId: string, opts: { now?: Date; dryRun?: boolean } = {}): Promise<OneCall & { digest: string | null }> {
  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  const ctx = createToolContext({ runId, userId: book.userId, accountId: book.accountId, runMode: "MARKET_REVIEWER", runEnvironment: book.environment, alpacaCreds: book.creds, dryRun: opts.dryRun });
  const research = createResearchTools(ctx) as Record<string, unknown>;
  const tools = { ...Object.fromEntries(READ_TOOLS.map((t) => [t, research[t]])), write_market_digest: writeMarketDigest(ctx) } as Parameters<typeof generateText>[0]["tools"];
  const opening: ModelMessage[] = [{ role: "user", content: await bookMessage(book, now) }];
  let result: Awaited<ReturnType<typeof generateText>> | null = null;
  let error: string | undefined;
  try {
    result = await generateText({
      model: openai.chat(REVIEWER_MODEL),
      system: buildMarketReviewerPrompt(),
      messages: opening,
      tools,
      // It ends on a saved digest: a refused save (too long) goes back for another try.
      stopWhen: [stepCountIs(REVIEWER_STEPS), ({ steps }) => steps.some((s) => s.toolResults.some(savedDigest))],
      // The last two steps can only save the digest, so a run always ends with one.
      prepareStep: ({ stepNumber }) =>
        stepNumber >= REVIEWER_STEPS - 2 ? { toolChoice: { type: "tool", toolName: "write_market_digest" }, activeTools: ["write_market_digest"] } : {},
      abortSignal: AbortSignal.timeout(600_000),
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    forgetPagesFound(runId);
  }
  const steps = result?.steps ?? [];
  const saved = steps.flatMap((s) => s.toolResults).map(savedDigest).find(Boolean);
  if (!error && !saved) error = "The run ended without saving a digest.";
  return {
    request: {
      v: 1,
      call: "Main",
      source: "market-reviewer",
      model: REVIEWER_MODEL,
      startedAt,
      endedAt: new Date().toISOString(),
      // The first request, exactly as sent: what the run started with.
      requests: steps[0]?.request?.body ? [steps[0].request.body] : [],
      of: steps.length,
      ...(error ? { error } : {}),
    },
    thread: opening,
    messages: result?.response.messages ?? [],
    steps: steps as unknown as OneCall["steps"],
    digest: saved?.data?.digest ?? null,
  };
}
