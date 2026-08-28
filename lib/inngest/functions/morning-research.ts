import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { buildDailyRunSystemPromptV2 } from "@/lib/agent/system-prompt";
import { MODES } from "@/lib/agent/modes";
import { buildRunInput } from "@/lib/agent/run-input";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { isAnalystScheduledToday, etWeekdayName } from "@/lib/market-hours";

// ─── Inngest function ─────────────────────────────────────────────────────────

export const morningResearch = inngest.createFunction(
  {
    id: "morning-research",
    name: "Morning Research Cron",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 0 8 * * 1-5" }, // 8:00 AM ET Mon–Fri (auto-adjusts for EDT/EST)
    { event: "app/research.run.manual" },
  ],
  async ({ event, step }) => {
    // Optional: if triggered manually for a specific analyst, only run that one
    const targetConfigId = (event as { data?: { agentConfigId?: string } })
      ?.data?.agentConfigId ?? null;

    // ── Step 1: Load enabled AgentConfigs (all, or filtered to one) ──────────

    const configs = await step.run("load-agent-configs", async () => {
      return prisma.agentConfig.findMany({
        where: {
          enabled: true,
          ...(targetConfigId ? { id: targetConfigId } : {}),
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
        // `app/research.run.manual` events (urgent-trigger on email signals,
        // manual UI runs via /api/research/trigger), which can fire mid-cron
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
        // both the 8 AM ET cron + any pre-market manual events; the next
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
        const slotsRemaining = Math.max(0, config.maxOpenPositions - openCount);
        // Never skip the run — the agent should always research.
        // slotsRemaining=0 just means it won't place new trades.

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
              markets: config.markets,
              sectors: config.sectors,
              minConfidence: config.minConfidence,
              signalTypes: config.signalTypes,
              tickers: watchlistSymbols,
              triggeredBy: "morning-cron",
              agentMode: true,
              analystName: config.name,
            } as object,
          },
        });

        console.log(`[morning-research] Starting agent run for ${config.name} (config=${config.id}, run=${run.id})`);

        // 2c. Build system prompt with structured run input
        const agentConfig = {
          name: config.name,
          analystPrompt: config.analystPrompt ?? undefined,
          directionBias: config.directionBias,
          holdDurations: config.holdDurations,
          sectors: config.sectors,
          signalTypes: config.signalTypes,
          minConfidence: config.minConfidence,
          minPositionSize: Number(config.minPositionSize),
          maxPositionSize: Number(config.maxPositionSize),
          maxOpenPositions: slotsRemaining, // Use remaining slots, not max
          watchlist: watchlistSymbols,
          exclusionList: config.exclusionList,
        };

        // Resolve per-user Alpaca credentials for this analyst's owner,
        // scoped to the run's environment (PAPER vs LIVE).
        const alpacaCreds =
          (await resolveAlpacaCredentials(config.userId, runEnvironment)) ??
          undefined;

        const runInput = await buildRunInput(config.id, config.userId, alpacaCreds);
        const systemPrompt = buildDailyRunSystemPromptV2(agentConfig, runInput);

        // 2d. Create tools with run context, then enforce the
        // research-run allowlist (Fix #5). The unified route already
        // does this; the cron previously did not, so the Daily Run
        // saw every tool — including record_thesis + manage_watchlist
        // — and could mint new coverage that's the Discovery cron's
        // job. Mirrors the same allowlist-filter pattern in
        // tactical-run.ts and discovery-run.ts.
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
          realMaxPosition: Number(config.realMaxPosition),
          maxOpenPositions: config.maxOpenPositions,
          minConfidence: config.minConfidence,
          alpacaCreds,
          runEnvironment,
          // Fix #6 (V2). Narrows read_signals to portfolio + watchlist
          // buckets only — Daily Run shouldn't act on discovery candidates
          // (that's the Sunday Discovery cron's job). V1 had a different
          // expectation; V1 path is deprecated as of 2026-05-16.
          dailyRunOnly: true,
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
        // tokens per analyst per morning. Accumulated across the main loop
        // AND the retry pass, persisted into parameters.toolStats so cost
        // is a queryable metric per run. cachedInput tells us whether
        // OpenAI's automatic prompt caching is actually hitting.
        const tokenUsage = { input: 0, cachedInput: 0, output: 0, total: 0, requests: 0 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trackUsage = (usage: any) => {
          if (!usage) return;
          tokenUsage.input += usage.inputTokens ?? 0;
          tokenUsage.cachedInput += usage.cachedInputTokens ?? 0;
          tokenUsage.output += usage.outputTokens ?? 0;
          tokenUsage.total += usage.totalTokens ?? 0;
          tokenUsage.requests += 1;
        };
        const failedToolCalls: Array<{ toolName: string; error: string; at: string }> = [];
        let lastStepTimeMs = t0;

        // V2 user prompt (was Fix #4). The legacy V1 string ("Begin your
        // research session. Follow all phases in order.") matched the
        // wording used in interactive /runs/[id] chats and caused the
        // model to treat cron runs like assistant-style conversations,
        // terminating on prose-style questions. The V2 string below makes
        // the lack of a human respondent explicit. V1 path deprecated.
        const userPrompt = "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run.";

        try {
          const { text, steps, response } = await generateText({
            // 2026-05-15 — model + abortSignal now read from MODES["research-run"]
            // instead of hardcoded "gpt-4o" + 240_000ms. The cron path was the
            // last spot still hardcoded; tactical + discovery already used the
            // pattern below. See lib/agent/modes.ts for the gpt-5.5 swap
            // rationale and the Vercel Pro maxDuration:800 upgrade.
            // .chat(): Chat Completions instead of the default Responses API.
            // Measured 2026-08-17 (cache probe, byte-identical harness):
            // OpenAI's cacheable prefix ends at the system+user head on BOTH
            // APIs (tools never cache; even a byte-identical request only
            // matched 58%), but chat canonicalization matches 2.5x more of
            // that head (8,832 vs 3,584 tokens). Small, free win (~$0.4/day);
            // the rest of the cache ceiling is server-side — do not chase it.
            model: openai.chat(MODES["research-run"].model),
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
            stopWhen: stepCountIs(30),
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
                // narration-gate shape) and data.status==="FAILED" (complete_run
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

          let toolCalls = steps.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0);
          let elapsed = Date.now() - t0;
          console.log(`[morning-research] Agent completed for ${config.name}: ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`);

          // ── Process-violation retry ────────────────────────────────────────
          // Decision-framework v1 (2026-04-25): a HOLD run with no theses and
          // no trades IS a successful run — that's the agent saying "no
          // A-grade setups today, preserve capital." We must NOT retry that
          // case anymore.
          //
          // Retry fires only when there's a real process violation:
          //   • get_stock_data was called for one or more tickers AND
          //   • record_thesis count < get_stock_data ticker count (the agent
          //     researched but skipped the thesis step)
          //
          // If the agent did NO research, that's a HOLD-without-research call
          // — log a warning but treat as COMPLETE (record_run_summary should
          // explain why; if it didn't even fire, the downstream hasWork check
          // catches the failure).
          // Count theses TOUCHED in this run, not just newly-created Thesis
          // rows. Held names that hit the same-direction guard go through
          // update_thesis — which modifies an existing Thesis row but
          // writes a ThesisUpdate(UPDATED|REVIEWED) entry with runId =
          // this run. Counting Thesis inserts alone undercounts those
          // legitimate touches and false-fails compliant runs.
          //
          // Source of truth: distinct thesisIds attached to ThesisUpdate
          // rows whose runId is this run.
          const preRetryThesisCount = (
            await prisma.thesisUpdate.findMany({
              where: { runId: run.id },
              select: { thesisId: true },
              distinct: ["thesisId"],
            })
          ).length;
          const stockDataTickers = new Set<string>();
          for (const s of steps) {
            for (const tc of s.toolCalls ?? []) {
              if (tc.toolName === "get_stock_data") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const t = (tc.input as any)?.ticker;
                if (typeof t === "string") stockDataTickers.add(t.toUpperCase());
              }
            }
          }
          const researchedCount = stockDataTickers.size;
          const processViolation =
            researchedCount > 0 && preRetryThesisCount < researchedCount;
          // Coverage violation (2026-08-13 fix): the expectation is the
          // ACTIONABLE set, not the whole book. The pre-fix gate expected a
          // touch on EVERY active thesis — stale V1 "walk everything" logic
          // that survived into the trigger-gated V2 design, so a healthy
          // needsAction-driven run (e.g. 3 of 21 theses actionable, 3
          // touched) fired the retry EVERY morning. Worse, the seeded retry
          // always crashes on the ModelMessage schema and falls back to a
          // historyless mini-run that re-loads the whole book, burns ~25%
          // of the run's tokens, and accomplishes nothing ("theses 3 → 0"
          // in the logs — see docs/plans/AGENT_PERF_COST_FIX.md).
          //
          // The actionable set mirrors what get_theses surfaces as
          // needsAction, approximated from runInput (price-dependent kinds
          // like UNPROTECTED_GAIN can't be recomputed here
          // cheaply — undercounting is fine for a gross-under-coverage
          // safety net):
          //   • triggers fired since last run + matching right now
          //   • priority reviews (near target/stop alerts)
          //   • PROMOTED rows (must resolve this run)
          //   • review-due rows (derived due date in the past — DAV-221)
          //   • unresearched seeds (direction=null → first-research due)
          const nowMs = Date.now();
          const actionableThesisIds = new Set<string>();
          for (const f of runInput.triggersFiredSinceLastRun ?? []) {
            actionableThesisIds.add(f.thesisId);
          }
          for (const m of runInput.triggersMatchingNow ?? []) {
            actionableThesisIds.add(m.thesisId);
          }
          for (const t of runInput.activeTheses ?? []) {
            const reviewDue =
              t.reviewDueAt != null && new Date(t.reviewDueAt).getTime() <= nowMs;
            if (t.status === "PROMOTED" || reviewDue || t.direction == null) {
              actionableThesisIds.add(t.id);
            }
          }
          // priorityReviews carry position ids, not thesis ids — map via
          // ticker against the active book.
          for (const p of runInput.priorityReviews ?? []) {
            const match = (runInput.activeTheses ?? []).find(
              (t) => t.ticker === p.symbol,
            );
            if (match) actionableThesisIds.add(match.id);
          }
          const expectedCoverage = actionableThesisIds.size;
          // ZERO-TOUCH only (review finding #1). The cron-side actionable
          // set is an approximation from runInput streams the agent never
          // sees — it over-counts in ordinary states (fire already answered
          // by a tactical run, fire on a since-RETIRED thesis, ENTER
          // suppressed by a pending buy proposal, near-stop priorityReviews
          // with no needsAction, seeds whose review was legitimately
          // bumped). A count-vs-count comparison would re-trigger the
          // daily phantom retry this PR removes. So the gate only fires on
          // the shape it exists for: work signal present, agent touched
          // NOTHING (the 2026-05-01 EVT / 05-04 Earnings Drift failure).
          // Per-thesis closeout obligations are complete_run's warn-gate's
          // job (Layer 1), not this blunt net's.
          const coverageViolation =
            expectedCoverage > 0 && preRetryThesisCount === 0;
          if (
            expectedCoverage > 0 &&
            preRetryThesisCount > 0 &&
            preRetryThesisCount < expectedCoverage
          ) {
            console.warn(
              `[morning-research] coverage note: ${config.name} touched ${preRetryThesisCount}/${expectedCoverage} estimated-actionable theses — not retrying (estimate over-counts answered/suppressed fires); complete_run's warn-gate owns per-thesis closeout.`,
            );
          }

          // Premature-exit violation: agent loaded data tools (read_signals
          // / get_portfolio_context / get_theses) and stopped without
          // emitting any action tool. Captures the 2026-05-07 prose-
          // termination shape — three Step-1 tool calls returned, the
          // model wrote a markdown thesis-by-thesis review, then the
          // assistant turn ended without queuing the next tool call and
          // generateText returned. coverageViolation should ALSO catch
          // this, but it doesn't fire when expectedCoverage = 0 (analyst
          // with empty Live Theses) and was bypassed for the 5/07 cases
          // because response?.messages came back falsy on a text-only
          // tail. We compute responseMessages with the same step-flatten
          // fallback used in the persistence block so the retry has a
          // valid context to seed from.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let responseMessages: any[] | undefined = response?.messages as
            | // eslint-disable-next-line @typescript-eslint/no-explicit-any
              any[]
            | undefined;
          if (
            !responseMessages ||
            !Array.isArray(responseMessages) ||
            responseMessages.length === 0
          ) {
            responseMessages = steps.flatMap((s) => {
              const stepMsgs = (
                s as unknown as { response?: { messages?: unknown[] } }
              ).response?.messages;
              return Array.isArray(stepMsgs) ? stepMsgs : [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any[];
          }

          // Detect "data-only" runs: every tool call so far was a Step-1
          // data-loading tool, no get_stock_data / record_thesis /
          // update_thesis / place_trade landed. Distinct from
          // coverageViolation because it can fire on analysts whose
          // Live Theses table is empty (new analysts, post-cleanup
          // states) where expectedCoverage = 0.
          const ACTION_TOOLS = new Set([
            "get_stock_data",
            "record_thesis",
            "update_thesis",
            "place_trade",
            "manage_position",
            "close_position",
            "manage_watchlist",
            "record_run_summary",
            "complete_run",
          ]);
          let actionToolCount = 0;
          for (const s of steps) {
            for (const tc of s.toolCalls ?? []) {
              if (ACTION_TOOLS.has(tc.toolName)) actionToolCount += 1;
            }
          }
          const totalToolCallsSoFar = steps.reduce(
            (sum, s) => sum + (s.toolCalls?.length ?? 0),
            0,
          );
          const prematureExitViolation =
            totalToolCallsSoFar > 0 && actionToolCount === 0;

          // Zero-tool-call violation: generateText returned but the model
          // emitted zero tool calls of any kind. Captures the 2026-05-12
          // Earnings Drift Trader silent-timeout shape — model produced
          // no output at all, ran the wall clock to 240s, aborted. The
          // existing prematureExitViolation gate requires
          // totalToolCallsSoFar > 0 (i.e. at least Step-1 data tools
          // landed), so it doesn't catch this. Same retry path; the nudge
          // tells the agent to start the run from the top.
          const zeroToolCallsViolation = totalToolCallsSoFar === 0;

          const shouldRetry =
            (processViolation ||
              coverageViolation ||
              prematureExitViolation ||
              zeroToolCallsViolation) &&
            responseMessages !== undefined &&
            responseMessages.length > 0;

          if (shouldRetry) {
            console.warn(
              `[morning-research] 🔁 ${config.name} researched ${researchedCount} tickers, expected coverage ${expectedCoverage} ACTIONABLE theses (fired/matching/promoted/review-due/seeds), only ${preRetryThesisCount} touched, action tools=${actionToolCount}/${totalToolCallsSoFar} — attempting retry (process=${processViolation}, coverage=${coverageViolation}, premature=${prematureExitViolation})`,
            );
            const nudge = prematureExitViolation
              ? // The agent loaded data and stopped without acting. Tell it
                // exactly what to do, in tool-call language, with no room
                // to summarize the data it just read.
                "You loaded the Step-1 data tools and stopped before acting. The Live Theses block in the system prompt is the source of truth — DO NOT re-summarize it in markdown. " +
                "Begin Step 2 NOW. For each thesis listed in the Live Theses table above, emit one tool call: " +
                "update_thesis(thesis_id=<id>, rationale='Reviewed; no triggers, thesis intact') for the NO branch (no triggers fired), or get_stock_data + the appropriate action tool for the YES branch. " +
                "After every Live Theses row has produced one tool call, run Step 3 (promotion check), Step 4 (discovery if slots open), Step 5/6 (record_run_summary then complete_run). " +
                "TOOL CALLS only. No markdown narrative. Each assistant turn from this point on MUST contain at least one tool call — text-only turns terminate the run as FAILED."
              : "You researched tickers with get_stock_data but did not record / update a thesis for each. The run will be marked FAILED unless you act NOW. " +
                "For EVERY ticker you researched this session, emit ONE tool call as follows — TOOL CALLS only, no narration, no markdown: " +
                "(a) If get_theses showed an ACTIVE same-direction thesis on this ticker (or a prior record_thesis call returned status='USE_UPDATE_THESIS' with an existing_thesis_id), call update_thesis(thesis_id=<that id>, ...patch fields..., rationale='<one line>'). " +
                "(b) Otherwise, call record_thesis(ticker, direction, ...) for new coverage. " +
                "When in doubt, prefer update_thesis with empty patch + a rationale (this writes a REVIEWED entry to the timeline and counts as the required thesis touch). " +
                "Then call record_run_summary. Then call complete_run. Any text output beyond a short status sentence is a failure.";

            // One retry attempt over a caller-supplied message seed. Extracted so
            // we can try it twice: first seeded with the prior in-run context
            // (preserves the research already loaded), and — if that seed is a
            // malformed ModelMessage[] — historyless. The reconstructed
            // responseMessages CAN be malformed (it threw "Invalid prompt: The
            // messages do not match the ModelMessage[] schema" and silently killed
            // the rescue); the system prompt already carries the Live Theses table,
            // so a historyless retry can still complete Step 2+.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const runRetry = async (messages: any[]): Promise<number> => {
              const retry = await generateText({
                // Same model as the main run — switches with research-run config.
                model: openai.chat(MODES["research-run"].model),
                system: systemPrompt,
                messages,
                tools,
                // Same cache route as the main loop — the retry replays the same prefix.
                providerOptions: { openai: { strictJsonSchema: true, promptCacheKey: run.id } },
                stopWhen: stepCountIs(15),
                // Retry is a quick fallback — keep a tight 120s budget regardless
                // of the main run's maxDuration. gpt-5.5 at ~13s/call still fits
                // 9 calls in 120s, plenty for a focused finish-the-summary pass.
                abortSignal: AbortSignal.timeout(120_000),
                onStepFinish({ stepNumber, toolCalls: stepTools, toolResults, finishReason, usage }) {
                  trackUsage(usage);
                  const now = Date.now();
                  const stepLatencyMs = now - lastStepTimeMs;
                  lastStepTimeMs = now;
                  const toolNames = stepTools.map((tc) => tc.toolName).join(", ") || "none";
                  console.log(
                    `[morning-research] RETRY STEP #${stepNumber} ${config.name} tools=[${toolNames}] finish=${finishReason}`
                  );
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const results = (toolResults ?? []) as Array<any>;
                  for (const call of stepTools) {
                    const bucket = toolStats[call.toolName] ?? { count: 0, totalLatencyMs: 0, errors: 0 };
                    bucket.count += 1;
                    bucket.totalLatencyMs += stepLatencyMs;
                    toolStats[call.toolName] = bucket;
                  }
                  for (const r of results) {
                    // P0-9b (retry path): same extended failure check as primary path.
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
              return retry.steps.reduce((s, x) => s + (x.toolCalls?.length ?? 0), 0);
            };

            let retryToolCalls = 0;
            try {
              // Tier 1 — seed from the prior in-run context.
              retryToolCalls = await runRetry([
                ...responseMessages,
                { role: "user", content: nudge },
              ]);
            } catch (seedErr) {
              // The seed was a malformed ModelMessage[] — don't lose the rescue.
              console.error(
                `[morning-research] 🔁 ${config.name} seeded retry rejected (${seedErr instanceof Error ? seedErr.message : seedErr}); retrying historyless`
              );
              try {
                // Tier 2 — historyless. The system prompt carries the state.
                retryToolCalls = await runRetry([{ role: "user", content: nudge }]);
              } catch (retryErr) {
                console.error(
                  `[morning-research] 🔁 ${config.name} retry failed:`,
                  retryErr instanceof Error ? retryErr.message : retryErr
                );
              }
            }
            const postRetryThesisCount = await prisma.thesis.count({
              where: { researchRunId: run.id },
            });
            console.log(
              `[morning-research] 🔁 ${config.name} retry: ${retryToolCalls} tool calls, theses ${preRetryThesisCount} → ${postRetryThesisCount}`
            );
            toolCalls += retryToolCalls;
            elapsed = Date.now() - t0;
          }

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
          //   • record_run_summary never fired AND there's no thesis or
          //     trade decision (agent died mid-flow with no work output)
          //   • research happened (get_stock_data called) but no theses
          //     were recorded (process violation; retry should have caught
          //     this, but if retry also failed, fail loudly)
          // Same source-of-truth as the retry gate: distinct thesisIds
          // touched via ThesisUpdate.runId. Captures both record_thesis
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
          const hadResearch = researchedCount > 0;
          const hasWork = thesisCount > 0 || decisionCount > 0 || ranSummary;

          // Process-violation override removed 2026-04-30 (PR 3 follow-up).
          // The old gate fired when stockDataTickers > distinctThesisTouches,
          // which made sense in PR 2's "research every candidate, mint a
          // thesis per ticker" world. PR 3 has the agent doing peer/sector
          // comparison get_stock_data calls without 1:1 thesis touches —
          // that's the new pattern. The gate false-failed legitimate runs
          // (Earnings Drift Trader + Catalyst Event Raider on 2026-04-30
          // both had record_run_summary fired but were marked FAILED).
          //
          // The retry path above (lines 240-300) still exists and still
          // fires when researchedCount > thesisCount, giving the agent a
          // chance to write missed theses. But we no longer override the
          // final status to FAILED if record_run_summary did fire — the
          // run completed its decision contract.
          // Trade-execution gate (added 2026-05-05). primary_decision=ADD or
          // ROTATE means the agent committed to a new position; if no trade
          // actually landed (tradesPlaced=0), the agent narrated the trade
          // in the run summary's decision_rationale without calling
          // place_trade. Same recurring failure pattern as narrated theses
          // (Stage 3) and narrated watchlist updates (Stage 4) — both have
          // explicit prompt prohibitions plus this kind of programmatic
          // backstop. Captured in CLAUDE.md's "RECURRING BUGS". Without this
          // gate the run shows status=COMPLETE while no order was sent to
          // Alpaca; observed 4-of-5 ADD/ROTATE decisions in 2026-04-29 →
          // 05-01 window producing zero trades despite COMPLETE status.
          let tradeExecutionGap: string | null = null;
          if (ranSummary && tradesPlaced === 0) {
            const summaryEvent = await prisma.runEvent.findFirst({
              where: { runId: run.id, type: "run_summary" },
              orderBy: { createdAt: "desc" },
              select: { payload: true },
            });
            const primaryDecision =
              summaryEvent?.payload && typeof summaryEvent.payload === "object"
                ? (summaryEvent.payload as Record<string, unknown>).primary_decision
                : undefined;
            if (primaryDecision === "ADD" || primaryDecision === "ROTATE") {
              const placeTradeCount = toolStats["place_trade"]?.count ?? 0;
              tradeExecutionGap = `primary_decision=${primaryDecision} but no trades placed (place_trade tool calls: ${placeTradeCount}). Trade was narrated in rationale rather than executed.`;
            }
          }

          const finalStatus =
            tradeExecutionGap !== null
              ? "FAILED"
              : hasWork
                ? "COMPLETE"
                : "FAILED";
          // Keep processViolationFinal for the failure-message branch
          // below so the operator still sees diagnostic info on real
          // failures (where record_run_summary didn't fire).
          const processViolationFinal = false;
          // Atomic: only transition RUNNING → terminal. No-op if complete_run
          // already marked it COMPLETE.
          const beltResult = await prisma.researchRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: { status: finalStatus, completedAt: new Date() },
          });
          if (beltResult.count > 0 && finalStatus === "FAILED") {
            const reason = tradeExecutionGap
              ? `trade execution gap: ${tradeExecutionGap}`
              : processViolationFinal
                ? `process violation: researched ${researchedCount} tickers but only recorded ${thesisCount} theses`
                : !ranSummary
                  ? "agent stopped before record_run_summary — no decision captured"
                  : "no work output (no theses, no trades, no run summary)";
            console.warn(
              `[morning-research] ⚠️ ${config.name} run=${run.id} FAILED — ${reason}. Steps: ${steps.length}, tool calls: ${toolCalls}, researched: ${researchedCount}, theses: ${thesisCount}, decisions: ${decisionCount}.`
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
                    researchedCount,
                    thesisCount,
                    decisionCount,
                    ranSummary,
                    processViolation: processViolationFinal,
                    tradeExecutionGap,
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
                  // Cost accounting — model + summed usage across main loop
                  // and retry pass. cachedInput / input = the prompt-cache
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

          // Persist full conversation messages for replay (atomic — old messages preserved on failure)
          try {
            const userMessage = {
              role: "user",
              content: [{ type: "text", text: userPrompt }],
            };
            // Defensive: response.messages may be undefined depending on the
            // AI SDK provider (observed after switching from OpenAI to Anthropic).
            // Fall back to reconstructing from steps if the top-level is missing.
            let responseMessages = response?.messages;
            if (!responseMessages || !Array.isArray(responseMessages) || responseMessages.length === 0) {
              console.warn(
                `[morning-research] response.messages is ${responseMessages === undefined ? "undefined" : "empty"} for run ${run.id}. ` +
                `Reconstructing from ${steps.length} steps.`
              );
              // Each step has its own response.messages — flatten them
              responseMessages = steps.flatMap((s) => {
                const stepMsgs = (s as unknown as { response?: { messages?: unknown[] } }).response?.messages;
                return Array.isArray(stepMsgs) ? stepMsgs : [];
              }) as typeof responseMessages;
            }
            const allMessages = [userMessage, ...responseMessages];
            const json = JSON.stringify(allMessages);
            console.log(
              `[morning-research] Persisting ${allMessages.length} messages (${(json.length / 1024).toFixed(0)}KB) for run ${run.id}`
            );
            await prisma.$transaction(async (tx) => {
              await tx.runMessage.deleteMany({ where: { runId: run.id } });
              await tx.runMessage.create({
                data: {
                  runId: run.id,
                  role: "thread",
                  content: json,
                },
              });
            });
            console.log(`[morning-research] ✅ Messages persisted for run ${run.id}`);
          } catch (msgErr) {
            console.error(
              `[morning-research] ❌ Failed to persist messages for run ${run.id}:`,
              msgErr instanceof Error ? msgErr.message : msgErr,
            );
          }

          // Per-analyst briefing deprecated (docs/plans/PORTFOLIO_DIGEST.md):
          // continuity now comes from the account-level PortfolioDigest, read
          // by buildRunInput. updateAnalystBriefing no longer called.

          return { tradesPlaced, steps: steps.length, toolCalls, elapsedMs: elapsed };
        } catch (err) {
          const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted") || err.message.includes("timed out"));
          const abortBudgetS = MODES["research-run"].maxDuration - 30;
          let message = isTimeout
            ? `Agent timed out after ${abortBudgetS}s (${Math.round((Date.now() - t0) / 1000)}s elapsed). Any theses and trades completed before timeout are preserved.`
            : err instanceof Error ? err.message : String(err);
          console.error(`[morning-research] Agent ${isTimeout ? "TIMED OUT" : "FAILED"} for ${config.name}: ${message}`);

          // ── Zero-tool-call recovery ──────────────────────────────────────
          // If the agent emitted ZERO tool calls before the abort, that's
          // the 2026-05-12 Earnings Drift silent-timeout shape: model
          // produced no output at all (likely an OpenAI hang or a single
          // text-only assistant turn the abort caught mid-stream). The
          // in-try retry gate can't catch this because it only fires when
          // generateText returns normally; here we hit the catch. Give the
          // agent one more focused swing with a tighter abort before
          // falling through to FAILED. If the recovery itself produces no
          // tool calls, we've confirmed it's a real model/API failure and
          // FAILED is correct.
          const totalToolCallsBeforeRetry = Object.values(toolStats).reduce((s, b) => s + b.count, 0);
          if (isTimeout && totalToolCallsBeforeRetry === 0) {
            console.warn(
              `[morning-research] 🔁 ${config.name} aborted with zero tool calls — attempting catch-path recovery`,
            );
            try {
              const recoveryResp = await generateText({
                // Same model as the main run.
                model: openai.chat(MODES["research-run"].model),
                system: systemPrompt,
                prompt:
                  `The prior attempt at your morning run produced zero tool calls before timing out. Start NOW. ` +
                  `Your first action this turn is read_signals, get_portfolio_context, and get_theses in parallel — no narration before the tool calls. ` +
                  `Then proceed with your normal playbook.`,
                tools,
                // Same cache route as the main loop — the retry replays the same prefix.
                providerOptions: { openai: { strictJsonSchema: true, promptCacheKey: run.id } },
                stopWhen: stepCountIs(30),
                // Recovery is a quick fallback after a zero-tool-call timeout —
                // keep 120s regardless of main maxDuration. If recovery itself
                // produces no tool calls, FAILED is correct.
                abortSignal: AbortSignal.timeout(120_000),
              });
              const recoveryToolCalls = recoveryResp.steps.reduce(
                (sum, s) => sum + (s.toolCalls?.length ?? 0),
                0,
              );
              console.log(
                `[morning-research] catch-path recovery: ${recoveryResp.steps.length} steps, ${recoveryToolCalls} tool calls`,
              );
              if (recoveryToolCalls > 0) {
                // The agent did work this time. Update toolStats so the
                // status decision below (and the FAILED/COMPLETE branch)
                // sees the recovered call count, and persist messages so
                // /runs/[id] shows the recovered thread.
                for (const s of recoveryResp.steps) {
                  for (const tc of s.toolCalls ?? []) {
                    const bucket = toolStats[tc.toolName] ?? { count: 0, totalLatencyMs: 0, errors: 0 };
                    bucket.count += 1;
                    toolStats[tc.toolName] = bucket;
                  }
                }
                try {
                  let recoveryMessages = recoveryResp.response?.messages;
                  if (!recoveryMessages || !Array.isArray(recoveryMessages) || recoveryMessages.length === 0) {
                    recoveryMessages = recoveryResp.steps.flatMap((s) => {
                      const stepMsgs = (s as unknown as { response?: { messages?: unknown[] } }).response?.messages;
                      return Array.isArray(stepMsgs) ? stepMsgs : [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any[];
                  }
                  if (recoveryMessages && recoveryMessages.length > 0) {
                    const userMessage = { role: "user", content: [{ type: "text", text: userPrompt }] };
                    const recoveryNote = { role: "user", content: "(catch-path recovery: prior attempt produced zero tool calls — restarting)" };
                    const allMessages = [userMessage, recoveryNote, ...recoveryMessages];
                    await prisma.$transaction(async (tx) => {
                      await tx.runMessage.deleteMany({ where: { runId: run.id } });
                      await tx.runMessage.create({ data: { runId: run.id, role: "thread", content: JSON.stringify(allMessages) } });
                    });
                  }
                } catch { /* persistence is non-critical */ }
                message = `Recovered after zero-tool-call abort. Recovery produced ${recoveryToolCalls} tool calls.`;
              }
            } catch (recoveryErr) {
              console.error(
                `[morning-research] catch-path recovery failed for ${config.name}:`,
                recoveryErr instanceof Error ? recoveryErr.message : recoveryErr,
              );
            }
          }

          // Check if any theses/trades were placed before the timeout (or during recovery)
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
          // on the error/recovery path either.

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
