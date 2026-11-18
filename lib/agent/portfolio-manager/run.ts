/**
 * The Portfolio Manager: one run per traded book, Tuesday and Thursday at
 * 10:00 AM ET (lib/inngest/functions/portfolio-manager.ts). Its record
 * (lib/agent/engine/agents/portfolio-manager.ts) holds its job, the blocks it
 * is given and its tools; the agent engine builds its request from it, and
 * the run keeps which part is which. It asks get_theses for the stocks it
 * weighs. It has no analyst: each
 * write acts for the stock's own analyst (lib/agent/analyst-scope.ts), and
 * every trade goes through the approval switch like any run's. Its last
 * reply is its write-up, kept on the run as a RunEvent and read first by its
 * next run.
 */
import type { ToolSet } from "ai";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { loadPortfolioPieces } from "@/lib/agent/portfolio-block";
import { loadBook } from "@/lib/agent/book";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import type { TokenUsage } from "@/lib/agent/token-usage";
import type { RunStep } from "@/lib/agent/run-thread";
import { withRunLimits } from "@/lib/agent/portfolio-manager/limits";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";
import { runAgent } from "@/lib/agent/engine/run";

export const MANAGER_RUN_MODE = "PORTFOLIO_MANAGER";
/** The RunEvent that keeps a run's write-up. */
export const WRITEUP_EVENT = "portfolio_writeup";
export const MANAGER_MODEL = PORTFOLIO_MANAGER.model;

export interface ManagerBook {
  accountId: string;
  environment: "PAPER" | "LIVE";
  userId: string;
}

const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

/** Its last write-up: the second part of its first message, after the day, under its heading (the record's). */
export async function lastWriteup(book: Pick<ManagerBook, "accountId" | "environment">): Promise<string> {
  const last = await prisma.runEvent
    .findFirst({
      where: { type: WRITEUP_EVENT, run: { accountId: book.accountId, environment: book.environment, mode: MANAGER_RUN_MODE } },
      orderBy: { createdAt: "desc" },
      select: { message: true, createdAt: true },
    })
    .catch(() => null);
  return last?.message ? `Written ${day(last.createdAt)}:\n\n${last.message}` : "None yet: this is your first.";
}

export interface ManagerResult {
  /** Its last reply, or null when the run ended with none. */
  writeup: string | null;
  firstMessage: string;
  messages: unknown[];
  steps: RunStep[];
  toolCalls: Array<{ tool: string; input: unknown }>;
  usage: TokenUsage;
  /** Input tokens of each model request, in order. */
  requests: number[];
  error?: string;
}

/**
 * The run: its record through the agent runner (lib/agent/engine/run.ts).
 * Saves nothing itself beyond what its tools save: the job keeps the thread
 * and the write-up. `tools` lets a dry run swap the writes for ones that save
 * nothing. Never throws.
 */
export async function runPortfolioManager(
  book: ManagerBook,
  runId: string | null,
  opts: { now?: Date; tools?: (real: ToolSet) => ToolSet } = {},
): Promise<ManagerResult> {
  const now = opts.now ?? new Date();
  const alpacaCreds = await resolveAlpacaCredentials(book.userId, book.environment);
  const toolset = createResearchTools({
    runId: runId ?? "",
    userId: book.userId,
    accountId: book.accountId,
    runMode: MANAGER_RUN_MODE,
    runEnvironment: book.environment,
    alpacaCreds: alpacaCreds ?? undefined,
  }) as ToolSet;
  const tickerOf = (id: string) => prisma.thesis.findFirst({ where: { id, userId: book.userId }, select: { ticker: true } }).then((t) => t?.ticker ?? null, () => null);
  const run = await runAgent(PORTFOLIO_MANAGER, {
    input: { now, environment: book.environment },
    sources: {
      portfolioPieces: (want) => loadPortfolioPieces({ accountId: book.accountId, environment: book.environment, now, ...want }),
      context: { the_book: () => loadBook(book), last_output: async () => `## Your last write-up\n${await lastWriteup(book)}` },
    },
    runId,
    toolset,
    // A dry run's stand-in writes go under the limits, so its proposals and notes are counted as a real run's.
    wrapTools: (mine) => withRunLimits(opts.tools ? opts.tools(mine) : mine, tickerOf),
    source: "portfolio-manager",
  });
  const { request, text, ...rest } = run;
  return {
    ...rest,
    writeup: text,
    firstMessage: request.message,
    ...(run.error || text ? {} : { error: "The run ended without its write-up." }),
  };
}
