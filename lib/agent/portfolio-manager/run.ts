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
import { generateText, stepCountIs, type ToolSet } from "ai";
import { prisma } from "@/lib/prisma";
import { modelFor } from "@/lib/agent/model";
import { createResearchTools } from "@/lib/agent/tools";
import { loadPortfolioPieces } from "@/lib/agent/portfolio-block";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { repeatRefusalGuard } from "@/lib/agent/repeat-refusal";
import { addTokenUsage, emptyTokenUsage, type TokenUsage } from "@/lib/agent/token-usage";
import type { RunStep } from "@/lib/agent/run-thread";
import { withRunLimits } from "@/lib/agent/portfolio-manager/limits";
import { buildAgentRequest } from "@/lib/agent/engine/engine";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";

export const MANAGER_RUN_MODE = "PORTFOLIO_MANAGER";
/** The RunEvent that keeps a run's write-up. */
export const WRITEUP_EVENT = "portfolio_writeup";
export const MANAGER_MODEL = PORTFOLIO_MANAGER.model;
const CALL_MS = 770_000;

export interface ManagerBook {
  accountId: string;
  environment: "PAPER" | "LIVE";
  userId: string;
}

const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

/** Its last write-up, under its heading: the second part of its first message, after the day. */
export async function lastWriteup(book: Pick<ManagerBook, "accountId" | "environment">): Promise<string> {
  const last = await prisma.runEvent
    .findFirst({
      where: { type: WRITEUP_EVENT, run: { accountId: book.accountId, environment: book.environment, mode: MANAGER_RUN_MODE } },
      orderBy: { createdAt: "desc" },
      select: { message: true, createdAt: true },
    })
    .catch(() => null);
  return ["## Your last write-up", last?.message ? `Written ${day(last.createdAt)}:\n\n${last.message}` : "None yet: this is your first."].join("\n");
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
  const [request, alpacaCreds] = await Promise.all([
    buildAgentRequest(PORTFOLIO_MANAGER, { now, environment: book.environment }, {
      portfolioPieces: (want) => loadPortfolioPieces({ accountId: book.accountId, environment: book.environment, now, ...want }),
      lastWriteup: () => lastWriteup(book),
    }),
    resolveAlpacaCredentials(book.userId, book.environment),
  ]);
  const firstMessage = request.message;
  const every = createResearchTools({
    runId: runId ?? "",
    userId: book.userId,
    accountId: book.accountId,
    runMode: MANAGER_RUN_MODE,
    runEnvironment: book.environment,
    alpacaCreds: alpacaCreds ?? undefined,
  }) as ToolSet;
  const tickerOf = (id: string) => prisma.thesis.findFirst({ where: { id, userId: book.userId }, select: { ticker: true } }).then((t) => t?.ticker ?? null, () => null);
  // A dry run's stand-in writes go under the limits, so its proposals and notes are counted as a real run's.
  const mine = Object.fromEntries(request.tools.map((name) => [name, every[name]])) as ToolSet;
  const real = withRunLimits(opts.tools ? opts.tools(mine) : mine, tickerOf);
  const usage = emptyTokenUsage();
  const requests: number[] = [];
  const done = (out: Partial<ManagerResult>): ManagerResult => ({ writeup: null, firstMessage, messages: [], steps: [], toolCalls: [], usage, requests, ...out });
  try {
    const { steps, response, text } = await generateText({
      model: modelFor(MANAGER_MODEL, { runId, call: "Main", source: "portfolio-manager", parts: request.parts }),
      system: request.instructions,
      prompt: firstMessage,
      tools: real,
      providerOptions: { openai: { strictJsonSchema: true, ...(runId ? { promptCacheKey: runId } : {}) } },
      // The same refused call three times ends the loop (repeat-refusal.ts).
      stopWhen: [stepCountIs(PORTFOLIO_MANAGER.maxSteps), repeatRefusalGuard.stopWhen],
      prepareStep: repeatRefusalGuard.prepareStep,
      abortSignal: AbortSignal.timeout(CALL_MS),
      onStepFinish({ usage: u }) {
        addTokenUsage(usage, u);
        requests.push(u?.inputTokens ?? 0);
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
