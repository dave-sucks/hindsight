/**
 * The Portfolio Manager: one run per traded book, Tuesday and Thursday at
 * 10:00 AM ET (lib/inngest/functions/portfolio-manager.ts). The same agent as
 * every other door, with its own job (./prompt.ts) and the whole book in a
 * line each as its first message (./book-table.ts). It has no analyst: each
 * write acts for the stock's own analyst (lib/agent/analyst-scope.ts), and
 * every trade goes through the approval switch like any run's. Its last
 * reply is its write-up, kept on the run as a RunEvent and read first by its
 * next run.
 */
import { generateText, stepCountIs, type ToolSet } from "ai";
import { prisma } from "@/lib/prisma";
import { MODES } from "@/lib/agent/modes";
import { modelFor } from "@/lib/agent/model";
import { createResearchTools } from "@/lib/agent/tools";
import { loadPortfolioBlock } from "@/lib/agent/portfolio-block";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { repeatRefusalGuard } from "@/lib/agent/repeat-refusal";
import { addTokenUsage, emptyTokenUsage, type TokenUsage } from "@/lib/agent/token-usage";
import type { RunStep } from "@/lib/agent/run-thread";
import { bookTable } from "@/lib/agent/portfolio-manager/book-table";
import { buildPortfolioManagerPrompt } from "@/lib/agent/portfolio-manager/prompt";

export const MANAGER_RUN_MODE = "PORTFOLIO_MANAGER";
/** The RunEvent that keeps a run's write-up. */
export const WRITEUP_EVENT = "portfolio_writeup";
/** The morning runs' model. */
export const MANAGER_MODEL = MODES["research-run"].model;
const MAX_STEPS = 40;
const CALL_MS = 770_000;

/** What it may call: the analyst's reads and writes. No note in the owner's name, no new coverage, no close-out tools. */
export const MANAGER_TOOLS = [
  "get_theses",
  "get_stock_data",
  "get_earnings_data",
  "get_sec_filings",
  "web_search",
  "update_thesis",
  "place_trade",
  "manage_position",
  "close_position",
  "dispatch_thesis_research",
] as const;

export interface ManagerBook {
  accountId: string;
  environment: "PAPER" | "LIVE";
  userId: string;
}

const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

/** Its first message: the book in a line each, then its own last write-up. */
export async function managerMessage(book: ManagerBook, now: Date): Promise<string> {
  const [theses, snapshot, last] = await Promise.all([
    prisma.thesis.findMany({
      where: { userId: book.userId, status: { in: ["HOLDING", "WATCHING"] }, researchRun: { agentConfig: { accountId: book.accountId, tradingEnvironment: book.environment } } },
      select: { ticker: true, status: true, conviction: true, coreBelief: true, lastReviewedAt: true, catalystDate: true, researchRun: { select: { agentConfig: { select: { name: true } } } } },
      orderBy: [{ researchUpdatedAt: "desc" }, { id: "asc" }],
    }),
    loadPortfolioSnapshot({ accountId: book.accountId, environment: book.environment, now }).catch(() => null),
    prisma.runEvent
      .findFirst({
        where: { type: WRITEUP_EVENT, run: { accountId: book.accountId, environment: book.environment, mode: MANAGER_RUN_MODE } },
        orderBy: { createdAt: "desc" },
        select: { message: true, createdAt: true },
      })
      .catch(() => null),
  ]);
  const charts = await loadIndicatorSnapshots(theses.map((t) => t.ticker.toUpperCase()), now).catch(() => new Map());
  return [
    `${day(now)}, the ${book.environment} book.`,
    "",
    bookTable(theses.map((t) => ({ ...t, analyst: t.researchRun?.agentConfig?.name ?? null })), snapshot, charts, now),
    "",
    "## Your last write-up",
    last?.message ? `Written ${day(last.createdAt)}:\n\n${last.message}` : "None yet: this is your first.",
  ].join("\n");
}

export interface ManagerResult {
  /** Its last reply, or null when the run ended with none. */
  writeup: string | null;
  firstMessage: string;
  messages: unknown[];
  steps: RunStep[];
  toolCalls: Array<{ tool: string; input: unknown }>;
  usage: TokenUsage;
  error?: string;
}

/**
 * The run's model call. Saves nothing itself beyond what its tools save: the
 * job keeps the thread and the write-up. `tools` lets a dry run swap the
 * writes for ones that save nothing. Never throws.
 */
export async function runPortfolioManager(
  book: ManagerBook,
  runId: string | null,
  opts: { now?: Date; tools?: (real: ToolSet) => ToolSet } = {},
): Promise<ManagerResult> {
  const now = opts.now ?? new Date();
  const [firstMessage, portfolioBlock, alpacaCreds] = await Promise.all([
    managerMessage(book, now),
    loadPortfolioBlock({ accountId: book.accountId, environment: book.environment, now }),
    resolveAlpacaCredentials(book.userId, book.environment),
  ]);
  const every = createResearchTools({
    runId: runId ?? "",
    userId: book.userId,
    accountId: book.accountId,
    runMode: MANAGER_RUN_MODE,
    runEnvironment: book.environment,
    alpacaCreds: alpacaCreds ?? undefined,
  }) as ToolSet;
  const real = Object.fromEntries(MANAGER_TOOLS.map((name) => [name, every[name]])) as ToolSet;
  const usage = emptyTokenUsage();
  const done = (out: Partial<ManagerResult>): ManagerResult => ({ writeup: null, firstMessage, messages: [], steps: [], toolCalls: [], usage, ...out });
  try {
    const { steps, response, text } = await generateText({
      model: modelFor(MANAGER_MODEL, { runId, call: "Main", source: "portfolio-manager" }),
      system: buildPortfolioManagerPrompt(portfolioBlock),
      prompt: firstMessage,
      tools: opts.tools ? opts.tools(real) : real,
      providerOptions: { openai: { strictJsonSchema: true, ...(runId ? { promptCacheKey: runId } : {}) } },
      // The same refused call three times ends the loop (repeat-refusal.ts).
      stopWhen: [stepCountIs(MAX_STEPS), repeatRefusalGuard.stopWhen],
      prepareStep: repeatRefusalGuard.prepareStep,
      abortSignal: AbortSignal.timeout(CALL_MS),
      onStepFinish({ usage: u }) {
        addTokenUsage(usage, u);
      },
    });
    const writeup = text?.trim() || null;
    return done({
      writeup,
      messages: response.messages,
      steps: steps as unknown as RunStep[],
      toolCalls: steps.flatMap((s) => (s.toolCalls ?? []).map((c) => ({ tool: c.toolName, input: c.input }))),
      ...(writeup ? {} : { error: "The run ended without its write-up." }),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[portfolio-manager] the run failed: ${error}`);
    return done({ error });
  }
}
