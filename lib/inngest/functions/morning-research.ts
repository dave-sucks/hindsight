import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs, type ToolSet } from "ai";
import { repeatRefusalGuard, repeatRefusalStop } from "@/lib/agent/repeat-refusal";
import { saveRunThread } from "@/lib/agent/run-thread";
import { bookCardInThread } from "@/lib/agent/book-card";
import { bookOnScreen } from "@/lib/agent/context/the-book";
import { putNotesOnRunProposals, sendNoteWritten } from "@/lib/proposals/auto-writeup";
import { modelFor } from "@/lib/agent/model";
import { createResearchTools } from "@/lib/agent/tools";
import { morningRunRequest } from "@/lib/agent/system-prompt";
import { openingOf } from "@/lib/agent/engine/engine";
import { listOpenRefusalsForRun, recordOpenRefusalsEvent } from "@/lib/agent/gate-rejections";
import { MODES } from "@/lib/agent/modes";
import { addTokenUsage, emptyTokenUsage } from "@/lib/agent/token-usage";
import { buildRunInput } from "@/lib/agent/run-input";
import { seedAccountTriggers } from "@/lib/agent/triggers/seed-account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import { sendNoViewWatch } from "@/lib/agent/thesis-writer-dispatch";
import {
  isAnalystScheduledToday,
  isTradingDay,
  etWeekdayName,
} from "@/lib/market-hours";

// ─── Agent Watch write-ups (DAV-349) ─────────────────────────────────────────

/** At most this many write-ups a morning per account, oldest Agent Watch first. */
const AGENT_WATCH_WRITEUPS_PER_MORNING = 3;

/**
 * A watched stock with a review clock of its own (an Agent Watch, the stock page's test) and no view yet is
 * sent to the writer as a refresh, which commits its view. A plain watch, with no clock, is never sent.
 */
async function sendAgentWatchWriteups(
  configs: Array<{ id: string; name: string; accountId: string; userId: string; tradingEnvironment: string }>,
): Promise<{ sent: string[]; skipped: string[] }> {
  const analysts = new Map(configs.map((c) => [c.id, c]));
  const rows = await prisma.thesis.findMany({
    where: { status: "WATCHING", direction: null, researchRun: { agentConfigId: { in: [...analysts.keys()] } } },
    select: { id: true, ticker: true, triggers: true, researchRun: { select: { agentConfigId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const sentPerAccount = new Map<string, number>();
  const sent: string[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const days = agentWatchDays(row.triggers);
    const analyst = analysts.get(row.researchRun.agentConfigId ?? "");
    if (days == null || !analyst) continue;
    if ((sentPerAccount.get(analyst.accountId) ?? 0) >= AGENT_WATCH_WRITEUPS_PER_MORNING) {
      skipped.push(`${row.ticker} (over today's ${AGENT_WATCH_WRITEUPS_PER_MORNING})`);
      continue;
    }
    const res = await sendNoViewWatch({
      thesisId: row.id,
      ticker: row.ticker,
      analyst,
      reason: `Sent to research by the morning job: ${row.ticker} is on the watchlist with a ${days}-day review and no view yet.`,
      dispatchedBy: "agent-watch-writeup",
    });
    if ("notSent" in res) {
      skipped.push(`${row.ticker} (${res.notSent})`);
      continue;
    }
    const { childRunId } = res;
    sentPerAccount.set(analyst.accountId, (sentPerAccount.get(analyst.accountId) ?? 0) + 1);
    sent.push(`${row.ticker} (${analyst.name}, run ${childRunId})`);
  }
  console.log(
    `[morning-research] Agent Watch write-ups: sent ${sent.length}${sent.length ? ` — ${sent.join(", ")}` : ""}` +
      (skipped.length ? `; not sent: ${skipped.join(", ")}` : ""),
  );
  return { sent, skipped };
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const morningResearch = inngest.createFunction(
  {
    id: "morning-research",
    name: "Morning Research Cron",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 0 10 * * 1-5" }, // 10:00 AM ET Mon–Fri, half an hour after the open, so a run reads live prices (auto-adjusts for EDT/EST)
    { event: "app/research.run.manual" },
  ],
  async ({ event, step }) => {
    // Optional: if triggered manually for a specific analyst, only run that one
    const targetConfigId = (event as { data?: { agentConfigId?: string } })
      ?.data?.agentConfigId ?? null;
    // A manual start names its account and runs only that account's analysts; the 10 AM schedule names none.
    const startedFor = (event as { data?: { accountId?: string } })?.data?.accountId ?? null;

    // ── Step 1: Load enabled AgentConfigs (all, or filtered to one) ──────────

    const configs = await step.run("load-agent-configs", async () => {
      return prisma.agentConfig.findMany({
        where: {
          enabled: true,
          ...(targetConfigId ? { id: targetConfigId } : {}),
          ...(startedFor ? { accountId: startedFor } : {}),
        },
      });
    });

    if (configs.length === 0) {
      return { ran: 0, reason: "no-enabled-configs" };
    }

    // ── Per-analyst run-days schedule gate (daily-run cost control) ──────────
    //
    // Each analyst's `runDaysOfWeek` (ISO weekdays 1=Mon..5=Fri) decides which
    // days its morning run executes. Skip any analyst not scheduled for today's
    // Eastern-Time weekday. A null/empty array means "all weekdays" (defensive:
    // legacy rows keep running). Computed via the ET helper, NOT server-local
    // UTC day-of-week. The 5-min trigger cron is untouched, so intraday
    // reactivity still fires every day on off days.
    //
    // An explicit manual run for one analyst (targetConfigId set — the "Run"
    // button / urgent-signal path) bypasses this gate: the user is asking for
    // that analyst NOW, regardless of the day.
    // A market holiday is not a run day for anyone. The weekday schedule
    // below can't know that, so the three analysts ran on Labor Day 2026
    // against Friday's closes (DAV-235). A manual run still goes through.
    if (!targetConfigId && !isTradingDay()) {
      console.log(
        `[morning-research] skipping all analysts: ${etWeekdayName()} is a market holiday`,
      );
      return { ran: 0, reason: "market-holiday" };
    }

    // Every Agent Watch gets its write-up (DAV-349), before any analyst runs so a run's own dispatch meets the in-flight check.
    // Fail-soft: a write-up that can't be sent waits a day; a throw here would cost every analyst's run.
    await step.run("agent-watch-writeups", () =>
      sendAgentWatchWriteups(configs).catch((err) => {
        console.error("[morning-research] Agent Watch write-ups failed (non-fatal):", err);
        return null;
      }),
    );

    const scheduledConfigs = targetConfigId
      ? configs
      : configs.filter((config) => {
          const scheduled = isAnalystScheduledToday(config.runDaysOfWeek);
          if (!scheduled) {
            console.log(
              `[morning-research] skipping ${config.name} (${config.id}): ` +
                `not scheduled for ${etWeekdayName()} ` +
                `(runDaysOfWeek=[${(config.runDaysOfWeek ?? []).join(",")}])`,
            );
          }
          return scheduled;
        });

    if (scheduledConfigs.length === 0) {
      return { ran: 0, reason: "none-scheduled-today" };
    }

    let totalTradesPlaced = 0;

    // ── Step 2: Per-analyst agent run ──────────────────────────────────────

    for (const config of scheduledConfigs) {
      const result = await step.run(`research-${config.id}`, async () => {
        const t0 = Date.now();

        // 2a. Per-analyst per-day idempotency guard.
        //
        // Function-level `concurrency: { limit: 1 }` (above) keeps two
        // morning-cron invocations from running CONCURRENTLY, but doesn't
        // prevent a second invocation from running SEQUENTIALLY after the
        // first completes. The function also subscribes to
        // `app/research.run.manual` events (manual UI runs via
        // /api/research/trigger), which can fire mid-cron
        // OR shortly after — producing a second MORNING_PLAN row for the same
        // analyst the same day.
        //
        // Production incident 2026-05-27: the live analyst (Earnings Drift
        // Trader) got two MORNING_PLAN runs at 12:00:59 + 12:06:58 UTC. Run A
        // deferred MRVL PROMOTED → WATCHING; Run B re-read WATCHING MRVL and
        // bought it live via place_trade. Run B overrode Run A's deliberate
        // defer decision purely because the duplicate fired. Real money on
        // the line; agent discipline lost to infrastructure.
        //
        // The guard: if a MORNING_PLAN run for this analyst started within
        // the last 12 hours and is RUNNING or COMPLETE, skip with a log.
        // FAILED runs are not counted — a failure should be retryable within
        // the same day. 12-hour lookback is timezone-agnostic and covers
        // both the 10 AM ET cron + any earlier manual events; the next
        // legitimate cron fires ~24h later so there's no collision.
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        const lookbackStart = new Date(Date.now() - TWELVE_HOURS_MS);
        const existingToday = await prisma.researchRun.findFirst({
          where: {
            agentConfigId: config.id,
            mode: "MORNING_PLAN",
            startedAt: { gte: lookbackStart },
            status: { in: ["RUNNING", "COMPLETE"] },
          },
          orderBy: { startedAt: "desc" },
          select: { id: true, status: true, startedAt: true },
        });
        if (existingToday) {
          console.log(
            `[morning-research] SKIP ${config.name} (${config.id}): ` +
              `MORNING_PLAN run ${existingToday.id} already ${existingToday.status} ` +
              `(started ${existingToday.startedAt.toISOString()}). ` +
              `Per-analyst daily quota exhausted; duplicate trigger suppressed.`,
          );
          return {
            skipped: true,
            reason: "duplicate_morning_run_suppressed",
            existingRunId: existingToday.id,
            existingStatus: existingToday.status,
            existingStartedAt: existingToday.startedAt.toISOString(),
          };
        }

        // 2b. Check open positions for THIS analyst (not all analysts combined)
        const openCount = await prisma.position.count({
          where: {
            analystId: config.id,
            status: "OPEN",
          },
        });
        // Never skip the run — the agent should always research. A full
        // analyst still reviews its book; it just cannot open a new
        // position, which the prompt states in words and the tools enforce.
        console.log(
          `[morning-research] ${config.name}: ${openCount} of ${config.maxOpenPositions} positions open`,
        );

        // Watchlist = WATCHING theses for this analyst (post-collapse).
        const watchlistSymbols = await getWatchlistSymbols(config.id);

        // Snapshot the analyst's env onto the run so place_trade /
        // get_portfolio_context route to the right Alpaca account.
        const runEnvironment =
          (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";

        // 2c. Create ResearchRun record (status: RUNNING)
        const run = await prisma.researchRun.create({
          data: {
            userId: config.userId,
            accountId: config.accountId,
            agentConfigId: config.id,
            source: "AGENT",
            status: "RUNNING",
            environment: runEnvironment,
            parameters: {
              sectors: config.sectors,
              tickers: watchlistSymbols,
              triggeredBy: "morning-cron",
              agentMode: true,
              analystName: config.name,
            } as object,
          },
        });

        console.log(`[morning-research] Starting agent run for ${config.name} (config=${config.id}, run=${run.id})`);

        // Resolve per-user Alpaca credentials for this analyst's owner,
        // scoped to the run's environment (PAPER vs LIVE).
        const alpacaCreds =
          (await resolveAlpacaCredentials(config.userId, runEnvironment)) ??
          undefined;

        // An account never seeded (a signup whose seed write failed) gets its
        // standing rules now; a seeded one is left alone (seed-account.ts).
        // Fail-soft: the read-side fallback still protects its holdings.
        try {
          if (await seedAccountTriggers(config.accountId)) console.log(`[morning-research] account=${config.accountId} seeded its standing rules`);
        } catch (err) {
          console.error("[morning-research] seedAccountTriggers failed (non-fatal):", err);
        }

        const runInput = await buildRunInput(config.id, config.userId, alpacaCreds);

        // 2d. Create tools with run context, then enforce the
        // research-run allowlist (Fix #5). The unified route already
        // does this; the cron previously did not, so the Daily Run
        // saw every tool — including record_thesis + manage_watchlist
        // — and could mint new coverage that's Discovery's
        // job. Mirrors the same allowlist-filter pattern in
        // tactical-run.ts.
        const allTools = createResearchTools({
          runId: run.id,
          userId: config.userId,
          accountId: config.accountId,
          analystId: config.id,
          runMode: "MORNING_PLAN",
          watchlist: watchlistSymbols,
          exclusionList: config.exclusionList ?? [],
          sectors: config.sectors ?? [],
          minPositionSize: Number(config.minPositionSize),
          maxPositionSize: Number(config.maxPositionSize),
          maxPositionTotal: Number(config.maxPositionTotal),
          maxOpenPositions: config.maxOpenPositions,
          alpacaCreds,
          runEnvironment,
        });
        const allowlist = MODES["research-run"].toolAllowlist;
        const tools = allowlist
          ? Object.fromEntries(
              allowlist
                .map(
                  (name) =>
                    [name, allTools[name as keyof typeof allTools]] as const,
                )
                .filter(([, v]) => v != null),
            )
          : allTools;

        // 2c. The request: the analyst's facts read for it by the engine
        // (lib/agent/context/: the analyst, the market and portfolio, its
        // book as get_theses reads it, the week), its
        // book through the run's own get_theses; the kickoff from the run input.
        const contextRun: Parameters<typeof morningRunRequest>[0] = {
          subject: { kind: "analyst", userId: config.userId, accountId: config.accountId, environment: runEnvironment, analystId: config.id },
          now: new Date(),
          agent: "morning_run",
          toolset: allTools as ToolSet,
        };
        const request = await morningRunRequest(contextRun, runInput);
        // The run page's card of the book in its first message: the same read, shown.
        const bookCard = bookCardInThread(await bookOnScreen(contextRun));
        const systemPrompt = request.instructions;

        // 2e. Run the agent (generateText, not streamText — no client to stream to)
        // Use AbortSignal to kill the agent before Vercel's 300s timeout kills the process.
        // Without this, a timeout leaves the run stuck in RUNNING status forever.
        console.log(`[morning-research] Starting generateText for ${config.name} run=${run.id} systemPrompt=${systemPrompt.length}chars`);

        // toolStats aggregator — mirrors the pattern in /api/agent/[mode]/route.ts
        // so morning-cron runs are observable in /intelligence/health alongside
        // UI-triggered runs. Without this, toolStats is null on every cron row
        // and we cannot tell from the DB what the agent actually called.
        const toolStats: Record<string, { count: number; totalLatencyMs: number; errors: number }> = {};
        // Token accounting (2026-08-13 cost fix). Per-step usage was logged
        // to console and thrown away while the fleet quietly burned ~1M
        // tokens per analyst per morning. Accumulated across the run's
        // loop, persisted into parameters.tokenUsage so cost
        // is a queryable metric per run. cachedInput tells us whether
        // OpenAI's prompt caching is actually hitting. The counter is the
        // one every agent uses (lib/agent/token-usage.ts).
        const tokenUsage = emptyTokenUsage();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trackUsage = (usage: any) => {
          addTokenUsage(tokenUsage, usage);
        };
        const failedToolCalls: Array<{ toolName: string; error: string; at: string }> = [];
        let lastStepTimeMs = t0;

        // V2 user prompt (was Fix #4). The legacy V1 string ("Begin your
        // research session. Follow all phases in order.") matched the
        // wording used in interactive /runs/[id] chats and caused the
        // model to treat cron runs like assistant-style conversations,
        // terminating on prose-style questions. The V2 string below makes
        // the lack of a human respondent explicit. V1 path deprecated.
        const userPrompt = request.message;

        try {
          const { text, steps, response } = await generateText({
            // 2026-05-15 — model + abortSignal now read from MODES["research-run"]
            // instead of hardcoded "gpt-4o" + 240_000ms. The cron path was the
            // last spot still hardcoded; tactical + discovery already used the
            // pattern below. See lib/agent/modes.ts for the gpt-5.5 swap
            // rationale and the Vercel Pro maxDuration:800 upgrade.
            // .chat(): Chat Completions instead of the default Responses API.
            // The 2026-08-17 probe that concluded "tools never cache; the
            // ceiling is server-side" was wrong: its request was not
            // byte-identical. One trigger field carried a random default
            // id that the SDK re-ran on every request, so every request's
            // tool block differed at that point and the cache stopped
            // there (the fixed 14,976 / 17,024 cached tokens per step seen
            // from 09-18). Fixed 2026-10-02 (triggers/schema.ts,
            // triggerInputSchema): the same request cached 71% before and
            // 97% after. Chat Completions is kept; it cached the head
            // further than Responses did in that probe.
            model: modelFor(MODES["research-run"].model, { api: "chat", runId: run.id, call: "Main", source: "morning-research", parts: request.parts, agent: request.agent }),
            system: systemPrompt,
            prompt: userPrompt,
            tools,
            // strictJsonSchema forces OpenAI to reject tool calls whose arguments
            // don't match the Zod-derived JSON Schema. Without this, the model
            // can invent parameters (observed: passing bucket="DISCOVERY" on
            // read_signals even after bucket was removed from the schema) that
            // Zod silently strips, leaving the transcript misleading.
            providerOptions: {
              openai: {
                strictJsonSchema: true,
                // Prompt-cache routing (2026-08-14). First measured morning
                // showed a 6-9% cache hit rate on an agent loop that should
                // re-hit its entire growing prefix every step — near-total
                // routing misses, every step re-billed at list price.
                // prompt_cache_key pins all of a run's requests to the same
                // cache route (OpenAI's documented fix for exactly this
                // shape). Zero behavioral change; effect is measured by
                // parameters.tokenUsage.cachedInput the next morning.
                promptCacheKey: run.id,
              },
            },
            // The same refused call three times ends the loop (repeat-refusal.ts). The step cap is the mode's
            // own number; a 30 here cut a run off with a stock still owed (2026-10-30, FTNT).
            stopWhen: [stepCountIs(MODES["research-run"].maxSteps), repeatRefusalGuard.stopWhen],
            // (maxDuration - 30) * 1000 leaves 30s of headroom before Vercel's
            // hard kill so the catch block can persist messages + mark the run
            // COMPLETE/FAILED cleanly. With maxDuration=800 under Pro, this is
            // 770_000ms — was 240_000ms hardcoded prior to the gpt-5.5 swap.
            abortSignal: AbortSignal.timeout(
              (MODES["research-run"].maxDuration - 30) * 1000,
            ),
            onStepFinish({ stepNumber, toolCalls: stepTools, toolResults, text: stepText, finishReason, usage }) {
              trackUsage(usage);
              const now = Date.now();
              const elapsed = now - t0;
              const stepLatencyMs = now - lastStepTimeMs;
              lastStepTimeMs = now;
              const ts = new Date().toISOString().slice(11, 23);
              const toolNames = stepTools.map((tc) => tc.toolName).join(", ") || "none";
              const textPreview = stepText?.slice(0, 120)?.replace(/\n/g, " ") || "";
              console.log(
                `[morning-research] ${ts} STEP #${stepNumber} ${config.name} run=${run.id} elapsed=${elapsed}ms tools=[${toolNames}] finish=${finishReason} tokens=${usage?.totalTokens ?? "?"} text="${textPreview}${stepText && stepText.length > 120 ? "..." : ""}"`
              );

              // Aggregate toolStats — attribute step wall time across this
              // step's tool calls, inspect tool results for ok:false errors.
              // Approximate for parallel calls (each credited the full step
              // delta) but directionally correct for the diagnostic.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const results = (toolResults ?? []) as Array<any>;
              for (const call of stepTools) {
                const bucket = toolStats[call.toolName] ?? { count: 0, totalLatencyMs: 0, errors: 0 };
                bucket.count += 1;
                bucket.totalLatencyMs += stepLatencyMs;
                toolStats[call.toolName] = bucket;
              }
              for (const r of results) {
                // AI SDK v6 tool-result shape: { toolCallId, toolName, output }
                // where `output` is our ToolResult<T> envelope. Legacy `result`
                // field checked defensively.
                // P0-9b: also catch data.success===false (record_run_summary FAILED
                // summary-action-check shape) and data.status==="FAILED" (complete_run
                // preflight rejection) — ok===false alone misses both.
                const out = (r?.output ?? r?.result) as {
                  ok?: boolean;
                  error?: string;
                  data?: { success?: boolean; status?: string };
                } | undefined;
                const isFailure =
                  out?.ok === false ||
                  out?.data?.success === false ||
                  out?.data?.status === "FAILED";
                if (out && isFailure) {
                  const bucket = toolStats[r.toolName] ?? { count: 0, totalLatencyMs: 0, errors: 0 };
                  bucket.errors += 1;
                  toolStats[r.toolName] = bucket;
                  if (failedToolCalls.length < 3) {
                    failedToolCalls.push({
                      toolName: r.toolName ?? "unknown",
                      error: String(out.error ?? "").slice(0, 500),
                      at: new Date().toISOString(),
                    });
                  }
                }
              }
            },
          });

          const toolCalls = steps.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0);
          const elapsed = Date.now() - t0;
          console.log(`[morning-research] Agent completed for ${config.name}: ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`);
          // Stopped for sending a refused call a third time: the run closes
          // with what it has, FAILED with that reason.
          const stopped = repeatRefusalStop(steps);

          // What is still refused and undone is recorded on the run (no screen
          // shows it yet); no later run is told.
          await recordOpenRefusalsEvent(run.id, await listOpenRefusalsForRun(run.id));

          // Count positions opened by checking DB (the place_trade tool already created them)
          const tradesPlaced = await prisma.tradeDecision.count({
            where: {
              runId: run.id,
              decision: "BUY",
            },
          });

          // Ensure run is marked terminal. complete_run normally does this,
          // but if the agent stopped mid-workflow without calling it we
          // need to do it here AND honestly report the outcome.
          //
          // Decision-framework v1 (2026-04-25): the success signal is
          // "record_run_summary fired" (which only happens after the agent
          // explicitly captures its primary_decision). A run that reaches
          // record_run_summary with HOLD as the decision and 0 theses /
          // 0 trades IS a successful run — that's the agent saying "no
          // A-grade setups today, preserve capital." Forcing such runs to
          // FAILED was the old compliance-machine bug.
          //
          // FAILED criteria (any one):
          //   • stopped for sending the same refused call three times
          //   • record_run_summary never fired AND there's no thesis or
          //     trade decision (agent died mid-flow with no work output)
          // Theses touched: distinct thesisIds on ThesisUpdate rows with
          // this runId. Captures both record_thesis
          // (writes a CREATED entry) and update_thesis (writes UPDATED /
          // REVIEWED / TRIGGER_FIRED / etc.) so a run that legitimately
          // updates 5 held theses isn't false-failed for "0 thesis rows
          // inserted."
          const [touchedTheses, decisionCount, runSummaryEvent] =
            await Promise.all([
              prisma.thesisUpdate.findMany({
                where: { runId: run.id },
                select: { thesisId: true },
                distinct: ["thesisId"],
              }),
              prisma.tradeDecision.count({ where: { runId: run.id } }),
              prisma.runEvent.findFirst({
                where: { runId: run.id, type: "run_summary" },
                select: { id: true },
              }),
            ]);
          const thesisCount = touchedTheses.length;
          const ranSummary = runSummaryEvent !== null;
          const hasWork = thesisCount > 0 || decisionCount > 0 || ranSummary;

          const finalStatus = stopped ? "FAILED" : hasWork ? "COMPLETE" : "FAILED";
          // Atomic: only transition RUNNING → terminal. No-op if complete_run
          // already marked it COMPLETE.
          const beltResult = await prisma.researchRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: { status: finalStatus, completedAt: new Date() },
          });
          if (beltResult.count > 0 && finalStatus === "FAILED") {
            const reason = stopped
              ? stopped
              : !ranSummary
                ? "agent stopped before record_run_summary — no decision captured"
                : "no work output (no theses, no trades, no run summary)";
            console.warn(
              `[morning-research] ⚠️ ${config.name} run=${run.id} FAILED — ${reason}. Steps: ${steps.length}, tool calls: ${toolCalls}, theses: ${thesisCount}, decisions: ${decisionCount}.`
            );
            // Surface the failure in the run UI
            try {
              await prisma.runEvent.create({
                data: {
                  runId: run.id,
                  type: "run_failed",
                  title: "Run did not complete",
                  message: `Run marked FAILED: ${reason}. Agent ran ${steps.length} steps and ${toolCalls} tool calls.`,
                  payload: {
                    steps: steps.length,
                    toolCalls,
                    thesisCount,
                    decisionCount,
                    ranSummary,
                  } as object,
                },
              });
            } catch { /* event write is best-effort */ }
          }
          // Enrich parameters with run metadata + toolStats (non-critical,
          // separate write). toolStats mirrors /api/agent/[mode]/route.ts
          // shape so /intelligence/health can read cron runs and UI runs
          // uniformly.
          const totalToolCalls = Object.values(toolStats).reduce((s, b) => s + b.count, 0);
          try {
            const freshRun = await prisma.researchRun.findUnique({ where: { id: run.id }, select: { parameters: true } });
            await prisma.researchRun.update({
              where: { id: run.id },
              data: {
                parameters: {
                  ...((freshRun?.parameters as object) ?? {}),
                  tradesPlaced,
                  agentSteps: steps.length,
                  agentToolCalls: toolCalls,
                  elapsedMs: elapsed,
                  toolStats: {
                    totalToolCalls,
                    durationMs: elapsed,
                    byTool: toolStats,
                    failedToolCalls,
                  },
                  // Cost accounting — model + summed usage across the
                  // run's loop. cachedInput / input = the prompt-cache
                  // hit rate; if it stays ~0, every step re-bills the full
                  // growing context at list price.
                  tokenUsage: {
                    ...tokenUsage,
                    model: MODES["research-run"].model,
                  },
                } as object,
              },
            });
          } catch (err) {
            console.error(`[morning-research] Failed to persist toolStats for ${config.name}:`, err);
          }

          // Thin-run warning (mirrors agent route) — surface as log; the
          // /intelligence/health dashboard's run-failure-triage reads these.
          if (finalStatus === "COMPLETE" && (totalToolCalls < 5 || elapsed < 60_000)) {
            console.warn(
              `[morning-research] ⚠️ THIN RUN ${config.name} run=${run.id} tool_calls=${totalToolCalls} duration_ms=${elapsed}`
            );
          }

          // The conversation for /runs/[id] (run-thread.ts). It opens with the start of the day and the book's card; the blocks the model read are on the Context panel.
          await saveRunThread(
            run.id,
            { opening: [{ role: "user", content: [{ type: "text", text: openingOf(request) }] }, ...bookCard], messages: response?.messages, steps },
            "morning-research",
          );

          // The run's notes become its proposals' reasons (lib/proposals/auto-writeup.ts).
          try {
            for (const orderId of await putNotesOnRunProposals({ runId: run.id, analystId: config.id, since: run.startedAt })) await sendNoteWritten(orderId);
          } catch (err) {
            console.error(`[morning-research] could not put the notes on ${config.name}'s proposals:`, err instanceof Error ? err.message : err);
          }

          // Per-analyst briefing deprecated (docs/plans/PORTFOLIO_DIGEST.md):
          // continuity now comes from the account-level PortfolioDigest, read
          // by buildRunInput. updateAnalystBriefing no longer called.

          return { tradesPlaced, steps: steps.length, toolCalls, elapsedMs: elapsed };
        } catch (err) {
          const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted") || err.message.includes("timed out"));
          const abortBudgetS = MODES["research-run"].maxDuration - 30;
          const message = isTimeout
            ? `Agent timed out after ${abortBudgetS}s (${Math.round((Date.now() - t0) / 1000)}s elapsed). Any theses and trades completed before timeout are preserved.`
            : err instanceof Error ? err.message : String(err);
          console.error(`[morning-research] Agent ${isTimeout ? "TIMED OUT" : "FAILED"} for ${config.name}: ${message}`);

          // Check if any theses/trades were placed before the timeout
          const partialTheses = await prisma.thesis.count({ where: { researchRunId: run.id } });
          const partialTrades = await prisma.tradeDecision.count({ where: { runId: run.id, decision: "BUY" } });
          const hasPartialWork = partialTheses > 0 || partialTrades > 0;

          const finalStatus = isTimeout && hasPartialWork ? "COMPLETE" : "FAILED";
          // Atomic: only transition RUNNING → terminal. If complete_run already
          // marked it COMPLETE, this is a no-op and we preserve that status.
          const timeoutResult = await prisma.researchRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: { status: finalStatus, completedAt: new Date() },
          });
          // Enrich parameters with error metadata + toolStats (non-critical,
          // separate write). Writing toolStats on the error path is the
          // most valuable case — it's how we diagnose WHY a run failed.
          const totalToolCalls = Object.values(toolStats).reduce((s, b) => s + b.count, 0);
          try {
            const freshRun = await prisma.researchRun.findUnique({ where: { id: run.id }, select: { parameters: true } });
            await prisma.researchRun.update({
              where: { id: run.id },
              data: {
                parameters: {
                  ...((freshRun?.parameters as object) ?? {}),
                  error: message,
                  failedAt: new Date().toISOString(),
                  ...(hasPartialWork ? { partialTheses, partialTrades, timedOut: true } : {}),
                  toolStats: {
                    totalToolCalls,
                    durationMs: Date.now() - t0,
                    byTool: toolStats,
                    failedToolCalls,
                  },
                } as object,
              },
            });
          } catch { /* parameter enrichment is non-critical */ }

          // Per-analyst briefing deprecated (docs/plans/PORTFOLIO_DIGEST.md):
          // the account-level PortfolioDigest replaces it. No briefing write
          // on the error path either.

          return { error: message, partialTheses, partialTrades };
        }
      });

      // Accumulate trades from successful runs
      if (result && typeof result === "object" && "tradesPlaced" in result) {
        totalTradesPlaced += (result as { tradesPlaced: number }).tradesPlaced;
      }
    }

    // ── Step 3: Sweep stale RUNNING runs from this batch ──────────────────
    // If any step.run timed out or was killed, the ResearchRun stays RUNNING.
    // This catch-all ensures they get marked FAILED so they don't appear as live.
    await step.run("sweep-stale-runs", async () => {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 min
      const staleRuns = await prisma.researchRun.updateMany({
        where: {
          status: "RUNNING",
          source: "AGENT",
          startedAt: { lt: staleThreshold },
          agentConfigId: { in: scheduledConfigs.map((c) => c.id) },
        },
        data: {
          status: "FAILED",
          completedAt: new Date(),
        },
      });
      if (staleRuns.count > 0) {
        console.warn(`[morning-research] Swept ${staleRuns.count} stale RUNNING runs to FAILED`);
      }
    });

    return { ran: scheduledConfigs.length, totalTradesPlaced };
  }
);
