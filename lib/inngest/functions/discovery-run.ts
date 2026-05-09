// ── Discovery Run ──────────────────────────────────────────────────────
// Weekly cron — Sundays 9 AM ET. Per-analyst spawn of a focused
// discovery agent that finds net-new ticker coverage worth WATCHING.
//
// Why a separate cron from the daily run: the daily run is allowed
// to skip discovery (slots full, hostile regime, no candidates). The
// weekly cron is the safety net so we never go weeks without
// scanning the universe.
//
// Why Sunday 9 AM ET: markets are closed (no race against opening
// price moves), the prior week's signals have all landed, and the
// new WATCHING theses are ready in time for Monday morning's daily
// run to pick them up via the per-thesis review loop.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { buildDiscoverySystemPrompt } from "@/lib/agent/system-prompts/discovery";
import { MODES } from "@/lib/agent/modes";

export const discoveryRun = inngest.createFunction(
  {
    id: "discovery-run",
    name: "Weekly Discovery Run",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    // Sunday weekly discovery — 9 AM ET. Fires for ALL enabled analysts.
    { cron: "TZ=America/New_York 0 9 * * 0" },
    // DAY-trader pre-open discovery — 7 AM ET Mon–Fri. Fires for DAY-only
    // analysts so they get a fresh net-new-name screen before the 8 AM
    // morning playbook run. Runs the same discovery prompt; the prompt
    // detects holdDurations and emits the day-trade-shaped branch.
    { cron: "TZ=America/New_York 0 7 * * 1-5" },
    // Manual fire — useful for one-off testing.
    { event: "app/discovery.run.manual" },
  ],
  async ({ event, step }) => {
    const targetConfigId =
      (event as { data?: { agentConfigId?: string } })?.data?.agentConfigId ??
      null;

    // Sunday cron = all analysts. Mon-Fri 7 AM cron = DAY-only.
    // Day-of-week is the simplest disambiguator since the two crons fire
    // on different days. Inngest doesn't expose which cron fired in the
    // event metadata, so we rely on the wall clock.
    const dayOfWeek = parseInt(
      new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
      }) === "Sun" ? "0" : "1",
      10,
    );
    const isWeekdayCron = dayOfWeek !== 0;

    const isDayOnly = (durations: string[] | null | undefined): boolean =>
      Array.isArray(durations) &&
      durations.length > 0 &&
      durations.every((h) => h.toUpperCase() === "DAY");

    const allConfigs = await step.run("load-agent-configs", async () => {
      return prisma.agentConfig.findMany({
        where: {
          enabled: true,
          ...(targetConfigId ? { id: targetConfigId } : {}),
        },
      });
    });

    // Manual triggers always run. Sunday cron runs for all. Weekday cron
    // (Mon-Fri 7 AM) runs only for DAY-only analysts.
    const isManual = !!targetConfigId;
    const configs = isManual
      ? allConfigs
      : isWeekdayCron
        ? allConfigs.filter((c: { holdDurations: string[] }) => isDayOnly(c.holdDurations))
        : allConfigs;

    if (configs.length === 0) {
      return {
        ran: 0,
        reason: "no-enabled-configs",
        cadence: isWeekdayCron ? "weekday-day-only" : "sunday-all",
      };
    }

    let totalNewTheses = 0;

    for (const config of configs) {
      const result = await step.run(`discovery-${config.id}`, async () => {
        const t0 = Date.now();

        // Load the analyst's existing thesis tickers (active + watching)
        // so the discovery prompt knows what NOT to re-cover.
        const existingTheses = await prisma.thesis.findMany({
          where: {
            researchRun: { agentConfigId: config.id },
            status: { in: ["ACTIVE", "WATCHING"] },
          },
          select: { ticker: true },
          distinct: ["ticker"],
        });
        const existingTickers = existingTheses.map(
          (t: { ticker: string }) => t.ticker,
        );

        const run = await prisma.researchRun.create({
          data: {
            userId: config.userId,
            agentConfigId: config.id,
            source: "AGENT",
            status: "RUNNING",
            mode: "DISCOVERY",
            parameters: {
              triggeredBy: targetConfigId
                ? "discovery-manual"
                : "discovery-cron",
              agentMode: true,
              analystName: config.name,
              existingTickerCount: existingTickers.length,
            } as object,
          },
        });

        console.log(
          `[discovery-run] Starting for ${config.name} (config=${config.id}, run=${run.id}, existing=${existingTickers.length})`,
        );

        const alpacaCreds =
          (await resolveAlpacaCredentials(config.userId)) ?? undefined;

        const allTools = createResearchTools({
          runId: run.id,
          userId: config.userId,
          analystId: config.id,
          watchlist: config.watchlist ?? [],
          exclusionList: config.exclusionList ?? [],
          sectors: config.sectors ?? [],
          maxPositionSize: Number(config.maxPositionSize),
          maxOpenPositions: config.maxOpenPositions,
          minConfidence: config.minConfidence,
          alpacaCreds,
          // Discovery's job is finding NEW coverage. read_signals returns
          // only the discoverySignals bucket; portfolio + watchlist signals
          // are hidden so the agent can't accidentally treat already-covered
          // names as discovery candidates (which is what was happening per
          // the user's manual-trigger run on 2026-05-07 — the chat showed
          // signals on held NVDA / AMD / KLAC etc. and the agent looked
          // confused because it was filtering them mentally instead of the
          // tool doing it).
          discoveryOnly: true,
        });

        const allowlist = MODES["discovery"].toolAllowlist;
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

        const systemPrompt = buildDiscoverySystemPrompt({
          config: {
            name: config.name,
            analystPrompt: config.analystPrompt ?? undefined,
            sectors: config.sectors,
            industries: config.industries,
            themes: config.themes,
            exclusionList: config.exclusionList,
          },
          existingTickers,
        });

        const userPrompt =
          "Begin your weekly discovery scan. Walk read_signals, score the top 2-3 fresh candidates, mint up to 5 new theses. Skip tickers already in your library.";

        try {
          const { steps, response } = await generateText({
            model: openai(MODES["discovery"].model),
            system: systemPrompt,
            prompt: userPrompt,
            tools,
            providerOptions: { openai: { strictJsonSchema: true } },
            stopWhen: stepCountIs(MODES["discovery"].maxSteps),
            abortSignal: AbortSignal.timeout(
              (MODES["discovery"].maxDuration - 30) * 1000,
            ),
          });

          const toolCalls = steps.reduce(
            (sum, s) => sum + (s.toolCalls?.length ?? 0),
            0,
          );
          const elapsed = Date.now() - t0;

          // Persist conversation messages so /runs/[id] can replay the chat.
          // Without this, every discovery run shows "No replay data
          // available" — same pattern as morning-research and tactical-run.
          try {
            const userMessage = {
              role: "user",
              content: [{ type: "text", text: userPrompt }],
            };
            let responseMessages = response?.messages;
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
              }) as typeof responseMessages;
            }
            const allMessages = [userMessage, ...responseMessages];
            const json = JSON.stringify(allMessages);
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
          } catch (msgErr) {
            console.error(
              `[discovery-run] failed to persist messages for run=${run.id}:`,
              msgErr instanceof Error ? msgErr.message : msgErr,
            );
          }

          // Count new theses minted by this run.
          const newTheses = await prisma.thesis.count({
            where: { researchRunId: run.id },
          });

          // The run is COMPLETE if record_run_summary fired (via
          // RunEvent type='run_summary'). Discovery may legitimately
          // mint 0 theses if no candidates clear the bar — the
          // record_run_summary call is the success signal.
          const summaryEvent = await prisma.runEvent.findFirst({
            where: { runId: run.id, type: "run_summary" },
            select: { id: true },
          });
          const ranSummary = summaryEvent !== null;

          await prisma.researchRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: {
              status: ranSummary ? "COMPLETE" : "FAILED",
              completedAt: new Date(),
            },
          });

          console.log(
            `[discovery-run] ${config.name}: ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms, ${newTheses} new theses, ranSummary=${ranSummary}`,
          );

          return { newTheses, steps: steps.length, toolCalls, elapsed };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown";
          console.error(`[discovery-run] ${config.name} FAILED: ${msg}`);
          await prisma.researchRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: { status: "FAILED", completedAt: new Date() },
          });
          return { error: msg };
        }
      });

      if (result && typeof result === "object" && "newTheses" in result) {
        totalNewTheses += (result as { newTheses: number }).newTheses;
      }
    }

    return { ran: configs.length, totalNewTheses };
  },
);
