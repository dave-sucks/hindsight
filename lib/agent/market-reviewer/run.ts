/**
 * One Market Reviewer run: read the inputs, open a ResearchRun (so it shows
 * in /runs with everything it was given), let the agent search, look at
 * stocks and write its notes, and end on write_market_brief. The cron
 * (lib/inngest/functions/market-reviewer.ts) calls this once per book.
 *
 * The run belongs to the account, not an analyst (`agentConfigId` null). It
 * feeds the trigger engine and trades nothing: its tools read, write notes,
 * and save the brief and the digest (MODES["market-reviewer"]).
 */
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";
import { saveRunThread, type RunStep } from "@/lib/agent/run-thread";
import { addTokenUsage, emptyTokenUsage, recordTokenUsage } from "@/lib/agent/token-usage";
import { repeatRefusalGuard, repeatRefusalStop } from "@/lib/agent/repeat-refusal";
import { recordRequests } from "@/lib/agent/run-requests";
import { getOwnerUserId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { ensureAccountStandingRules } from "@/lib/agent/triggers/seed-account";
import { fireUrgentNote } from "@/lib/agent/triggers/urgent-note";
import { levelFor } from "@/lib/agent/shared-notes";
import { URGENT_PER_RUN, forgetUrgentCount } from "@/lib/agent/tools/write-market-note";
import { buildMarketReviewerPrompt } from "./prompt";
import { loadMarketReviewerInputs, renderInputs, type Book, type MarketReviewerFacts } from "./inputs";

export const MARKET_REVIEWER_RUN_MODE = "MARKET_REVIEWER";
const MODE = MODES["market-reviewer"];

/** Ends the run once write_market_brief has saved; a call it refused (a brief too long, say) lets the model try again. */
export const briefSaved = ({ steps }: { steps: ReadonlyArray<{ toolResults: ReadonlyArray<{ toolName: string; output?: unknown }> }> }): boolean =>
  steps.some((s) =>
    s.toolResults.some((r) => {
      const out = r.output as { ok?: boolean; data?: { digestId?: string; dry_run?: boolean } } | undefined;
      return r.toolName === "write_market_brief" && out?.ok === true && (!!out.data?.digestId || out.data?.dry_run === true);
    }),
  );

export interface MarketReviewerRunArgs {
  accountId: string;
  environment: Book;
  /** The New York date the run is for, YYYY-MM-DD. */
  date: string;
  now?: Date;
  /** The model to run. Production uses MODES["market-reviewer"]; a test passes one over a fake fetch. */
  model?: LanguageModel;
  /** The inputs, when already read; loaded here otherwise. */
  facts?: MarketReviewerFacts;
}

export interface MarketReviewerRunResult {
  runId: string | null;
  status: "COMPLETE" | "FAILED" | "SKIPPED";
  written: boolean;
  /** The stocks an urgent note started a run on. */
  urgent?: string[];
  reason?: string;
}

/**
 * The run's urgent notes start their runs once it has ended, so each one
 * reads the brief it just saved. Only the stocks a note marked URGENT; each
 * through the account's urgent-note rule (lib/agent/triggers/urgent-note.ts).
 * Written down on the run as one event.
 */
const OUTCOME_WORDS: Record<string, string> = {
  SENT: "a run started",
  FLAGGED: "flagged for the next run",
  ANSWERED: "already answered by a run",
  REPEAT: "the same condition was cited urgent and answered within 5 trading days",
  NO_RULE: "no urgent-note rule",
};

export async function startUrgentRuns(runId: string, userId: string, book: { accountId: string; environment: string }): Promise<string[]> {
  const started: string[] = [];
  const lines: string[] = [];
  try {
    const notes = await prisma.sharedNote.findMany({
      where: { runId, audience: "STOCKS" },
      select: { id: true, tickers: true, levels: true, body: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const done = new Set<string>();
    for (const n of notes) {
      // One fire per stock per run, from its first urgent note, and URGENT_PER_RUN stocks at most, oldest first.
      const urgent = n.tickers.filter((t) => levelFor(n, t) === "URGENT" && !done.has(t));
      const room = Math.max(0, URGENT_PER_RUN - done.size);
      const tickers = urgent.slice(0, room);
      for (const t of urgent.slice(room)) lines.push(`${t}: over the cap (${URGENT_PER_RUN} urgent stocks a run), no run started`);
      if (tickers.length === 0) continue;
      tickers.forEach((t) => done.add(t));
      for (const f of await fireUrgentNote({ id: n.id, userId, tickers, body: n.body, createdAt: n.createdAt, ...book })) {
        lines.push(`${f.ticker}: ${OUTCOME_WORDS[f.outcome] ?? f.outcome}`);
        if (f.outcome === "SENT") started.push(f.ticker);
      }
    }
  } catch (err) {
    // Written on the run; the run's brief and notes stand.
    lines.push(`couldn't start them: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (lines.length) {
    await prisma.runEvent.create({ data: { runId, type: "urgent_runs", title: `Urgent notes: ${lines.join("; ")}`, message: null } }).catch(() => undefined);
  }
  return started;
}

/**
 * The last two steps can only call write_market_brief, so a run that spent
 * its steps on searches and notes still ends with a brief. Two, so a brief
 * refused as too long gets one more try.
 */
export function forceBriefAtTheEnd({ steps, stepNumber }: { steps: Parameters<typeof briefSaved>[0]["steps"]; stepNumber: number }) {
  if (stepNumber < MODE.maxSteps - 2 || briefSaved({ steps })) return undefined;
  return { toolChoice: { type: "tool" as const, toolName: "write_market_brief" }, activeTools: ["write_market_brief"] };
}

/** The Market Reviewer's tools, from its mode's list. `dryRun`: the saving tools check and save nothing. */
export function reviewerTools(ctx: { runId: string; userId: string; accountId: string; environment: Book; creds?: Awaited<ReturnType<typeof bookOwner>>["creds"]; dryRun?: boolean }): ToolSet {
  const all = createResearchTools({
    runId: ctx.runId,
    userId: ctx.userId,
    accountId: ctx.accountId,
    runMode: MARKET_REVIEWER_RUN_MODE,
    runEnvironment: ctx.environment,
    alpacaCreds: ctx.creds,
    dryRun: ctx.dryRun,
  });
  return Object.fromEntries((MODE.toolAllowlist ?? []).map((name) => [name, all[name as keyof typeof all]] as const).filter(([, t]) => t != null)) as ToolSet;
}

/**
 * The model call, as the cron makes it; the no-save run (scripts/market-reviewer-dry-run.ts) makes the same one.
 * Every request it sends is kept on the run (lib/agent/run-requests.ts) when `runId` names a run row; the no-save run passes none.
 */
export function callReviewer(args: { model: LanguageModel; tools: ToolSet; opening: string; cacheKey: string; runId?: string | null; onUsage: (usage: Parameters<typeof addTokenUsage>[1]) => void }) {
  const sent = recordRequests(args.runId, "Main", "market-reviewer");
  const call = sent.around(generateText({
    model: args.model,
    system: buildMarketReviewerPrompt(),
    prompt: args.opening,
    tools: args.tools,
    // One tool call at a time: the urgent cap and the brief's place at the end hold call by call.
    providerOptions: { openai: { strictJsonSchema: true, promptCacheKey: args.cacheKey, parallelToolCalls: false } },
    // Ends on the saved brief; the step cap and the same refused call three times are the backstops.
    stopWhen: [briefSaved, stepCountIs(MODE.maxSteps), repeatRefusalGuard.stopWhen],
    prepareStep: (step) => {
      const forced = forceBriefAtTheEnd(step);
      const nudge = repeatRefusalGuard.prepareStep(step);
      return forced || nudge ? { ...nudge, ...forced } : undefined;
    },
    abortSignal: AbortSignal.timeout((MODE.maxDuration - 30) * 1000),
    onStepFinish(step) {
      sent.step(step);
      args.onUsage(step.usage);
    },
  }));
  // The run's urgent count lives only as long as its model call (the tools are keyed by the run id, which both callers pass as the cache key).
  return call.finally(() => forgetUrgentCount(args.cacheKey));
}

/** The book's owner and broker keys: whose theses and notes, and what prices them. */
export async function bookOwner(accountId: string, environment: Book) {
  const userId = await getOwnerUserId(accountId);
  const creds = userId ? ((await resolveAlpacaCredentials(userId, environment).catch(() => null)) ?? undefined) : undefined;
  return { userId, creds };
}

/** The inputs for one book, read as the run would read them. The cron reads them in their own step. */
export async function loadInputsForBook(args: { accountId: string; environment: Book; date: string; now?: Date }): Promise<MarketReviewerFacts | null> {
  const { userId, creds } = await bookOwner(args.accountId, args.environment);
  return userId ? loadMarketReviewerInputs({ ...args, userId, creds }) : null;
}

export async function runMarketReviewer(args: MarketReviewerRunArgs): Promise<MarketReviewerRunResult> {
  const { accountId, environment, date } = args;
  const { userId, creds } = await bookOwner(accountId, environment);
  if (!userId) return { runId: null, status: "SKIPPED", written: false, reason: "the account has no owner" };
  // An urgent note fires the account's urgent-note rule: make sure it is there (added once, never re-added after a deletion).
  await ensureAccountStandingRules(accountId).catch((err) => console.warn(`[market-reviewer] standing rules not checked:`, err instanceof Error ? err.message : err));
  const facts = args.facts ?? (await loadMarketReviewerInputs({ accountId, environment, date, userId, creds, now: args.now }));

  const run = await prisma.researchRun.create({
    data: {
      userId,
      accountId,
      agentConfigId: null,
      source: "AGENT",
      status: "RUNNING",
      mode: MARKET_REVIEWER_RUN_MODE,
      environment,
      startedAt: new Date(),
      parameters: { triggeredBy: "market-reviewer-cron", agentMode: true, date, model: MODE.model, facts } as object,
    },
    select: { id: true, startedAt: true },
  });

  const tools = reviewerTools({ runId: run.id, userId, accountId, environment, creds });
  const opening = renderInputs(facts);
  const tokenUsage = emptyTokenUsage();
  const t0 = Date.now();
  try {
    const { steps, response } = await callReviewer({
      model: args.model ?? openai(MODE.model),
      tools,
      opening,
      cacheKey: run.id,
      runId: run.id,
      onUsage: (usage) => addTokenUsage(tokenUsage, usage),
    });
    console.log(`[market-reviewer] ${environment} ${date}: ${steps.length} steps, ${steps.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0)} tool calls, ${Date.now() - t0}ms`);

    await saveRunThread(
      run.id,
      { opening: [{ role: "user", content: [{ type: "text", text: opening }] }], messages: response?.messages, steps: steps as unknown as RunStep[] },
      "market-reviewer",
    );
    await recordTokenUsage(run.id, tokenUsage, MODE.model);

    const written = (await prisma.marketDigest.findFirst({ where: { runId: run.id }, select: { id: true } })) != null;
    const stopped = repeatRefusalStop(steps);
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: written ? "COMPLETE" : "FAILED", completedAt: new Date() } });
    if (!written) {
      await prisma.runEvent.create({
        data: {
          runId: run.id,
          type: "run_failed",
          title: "The Market Reviewer ended without writing the brief",
          message: stopped ?? `It stopped after ${steps.length} steps without calling write_market_brief.`,
        },
      });
    }
    const urgent = await startUrgentRuns(run.id, userId, { accountId, environment });
    return { runId: run.id, status: written ? "COMPLETE" : "FAILED", written, urgent, ...(written ? {} : { reason: stopped ?? "no brief written" }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[market-reviewer] ${environment} ${date}: ${msg}`);
    await recordTokenUsage(run.id, tokenUsage, MODE.model);
    try {
      const fresh = await prisma.researchRun.findUnique({ where: { id: run.id }, select: { parameters: true } });
      await prisma.researchRun.update({
        where: { id: run.id },
        data: { status: "FAILED", completedAt: new Date(), parameters: { ...((fresh?.parameters as object) ?? {}), error: msg } as object },
      });
    } catch {
      await prisma.researchRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date() } }).catch(() => undefined);
    }
    // An urgent note it wrote before the failure still starts its run.
    const urgent = await startUrgentRuns(run.id, userId, { accountId, environment });
    return { runId: run.id, status: "FAILED", written: false, urgent, reason: msg };
  }
}
