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
    // 9 AM ET Sundays. Inngest auto-handles EDT/EST.
    { cron: "TZ=America/New_York 0 9 * * 0" },
    // Manual fire — useful for one-off testing.
    { event: "app/discovery.run.manual" },
  ],
  async ({ event, step }) => {
    const targetConfigId =
      (event as { data?: { agentConfigId?: string } })?.data?.agentConfigId ??
      null;

    const configs = await step.run("load-agent-configs", async () => {
      const all = await prisma.agentConfig.findMany({
        where: {
          enabled: true,
          ...(targetConfigId ? { id: targetConfigId } : {}),
        },
      });
      // Skip DAY-only analysts. A weekly Sunday WATCHING thesis with
      // an intraday-level ENTER trigger is architecturally broken —
      // Monday's premarket gap moves the breakout level. DAY analysts
      // discover their candidates from today's tape via their morning
      // daily run, not from week-old routed signals. Targeted manual
      // fires (targetConfigId) still go through — useful for testing.
      if (targetConfigId) return all;
      return all.filter((c: { holdDurations: string[] }) => {
        const holds = (c.holdDurations ?? []).map((h) => h.toUpperCase());
        return !(holds.length > 0 && holds.every((h) => h === "DAY"));
      });
    });

    if (configs.length === 0) {
      return { ran: 0, reason: "no-enabled-configs-after-filter" };
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

        const runEnvironment =
          (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";

        // GAPS P2-10 — idempotency on Inngest step retries. If the outer
        // step throws and Inngest retries, the original code would
        // researchRun.create() a SECOND row, double-billing and producing
        // duplicate theses on success. Reuse any RUNNING discovery run for
        // this analyst from the last hour (covers retries; manual fires
        // outside that window create a fresh row).
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const existing = await prisma.researchRun.findFirst({
          where: {
            agentConfigId: config.id,
            mode: "DISCOVERY",
            status: "RUNNING",
            startedAt: { gte: oneHourAgo },
          },
          orderBy: { startedAt: "desc" },
        });
        const run =
          existing ??
          (await prisma.researchRun.create({
            data: {
              userId: config.userId,
              accountId: config.accountId,
              agentConfigId: config.id,
              source: "AGENT",
              status: "RUNNING",
              mode: "DISCOVERY",
              environment: runEnvironment,
              parameters: {
                triggeredBy: targetConfigId
                  ? "discovery-manual"
                  : "discovery-cron",
                agentMode: true,
                analystName: config.name,
                existingTickerCount: existingTickers.length,
              } as object,
            },
          }));
        if (existing) {
          console.log(
            `[discovery-run] Reusing existing RUNNING run=${run.id} for ${config.name} (Inngest retry)`,
          );
        }

        console.log(
          `[discovery-run] Starting for ${config.name} (config=${config.id}, run=${run.id}, existing=${existingTickers.length})`,
        );

        const alpacaCreds =
          (await resolveAlpacaCredentials(config.userId, runEnvironment)) ??
          undefined;

        // coveredTickers = ACTIVE + WATCHING thesis tickers ∪ watchlist ∪
        // open position tickers. Tools (read_signals discoveryOnly path,
        // get_market_movers/get_earnings_calendar scope:"universe") use
        // this to mean "the set of names you've already chosen NOT to
        // discover again" — anything outside it is a candidate.
        const openPositionTickers = await prisma.position
          .findMany({
            where: { analystId: config.id, status: "OPEN" },
            select: { symbol: true },
          })
          .then((rows: Array<{ symbol: string }>) =>
            rows.map((r) => r.symbol.toUpperCase()),
          );
        const coveredTickers = Array.from(
          new Set([
            ...existingTickers.map((t: string) => t.toUpperCase()),
            ...(config.watchlist ?? []).map((t: string) => t.toUpperCase()),
            ...openPositionTickers,
          ]),
        );

        const allTools = createResearchTools({
          runId: run.id,
          userId: config.userId,
          accountId: config.accountId,
          analystId: config.id,
          watchlist: config.watchlist ?? [],
          positionTickers: openPositionTickers,
          exclusionList: config.exclusionList ?? [],
          sectors: config.sectors ?? [],
          maxPositionSize: Number(config.maxPositionSize),
          realMaxPosition: Number(config.realMaxPosition),
          maxOpenPositions: config.maxOpenPositions,
          minConfidence: config.minConfidence,
          alpacaCreds,
          runEnvironment,
          // Discovery's job is finding NEW coverage. read_signals' discovery
          // path filters by "ticker NOT in coveredTickers" (was incorrectly
          // using routeReasonCode buckets, which dropped AGGREGATE_TICKER_MATCH
          // routes on watchlist names into the watchlist bucket and then hid
          // them — the 2026-05-10 weekly auto-cron hit this).
          discoveryOnly: true,
          coveredTickers,
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
            // FULL analystPrompt — never truncate. This is the analyst's
            // edge, strategy, signal preferences, risk philosophy. Cutting
            // it to 400 chars (prior behavior) reduced the analyst to a
            // name and a fence; the agent had no idea who it was.
            analystPrompt: config.analystPrompt ?? undefined,
            sectors: config.sectors,
            industries: config.industries,
            themes: config.themes,
            marketCapMin: config.marketCapMin,
            marketCapMax: config.marketCapMax,
            exclusionList: config.exclusionList,
            // Strategy-relevant fields the prompt now uses to ground
            // horizon selection, position sizing, and direction bias.
            holdDurations: config.holdDurations,
            directionBias: config.directionBias,
            minConfidence: config.minConfidence,
            maxPositionSize: Number(config.maxPositionSize),
            maxOpenPositions: config.maxOpenPositions,
            signalTypes: config.signalTypes,
            watchlist: config.watchlist,
          },
          existingTickers,
        });

        const userPrompt =
          "Begin your weekly discovery scan. Pull read_signals + get_market_movers(scope:\"universe\") + get_earnings_calendar(scope:\"universe\") in parallel — they're all pre-filtered to your universe and exclude tickers you already cover. Then research every interesting candidate with get_stock_data (and any other tools you need), score on the 4-dim composite, and mint WATCHING theses for everything ≥ 5. Up to 8 theses. Don't re-filter by universe — the tools did it.";

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

          // GAPS P2-11 — status reflects actual work output.
          //   newTheses > 0 OR ranSummary → COMPLETE (the run produced
          //     something). Token-limiting before record_run_summary lands
          //     on a run that minted real theses no longer hides those
          //     theses behind a FAILED badge.
          //   newTheses === 0 AND !ranSummary → FAILED (the run produced
          //     nothing useful and didn't cleanly wrap up).
          // ranSummary alone (without newTheses) still counts as COMPLETE
          // — a legitimate "nothing cleared the bar this week, here's why"
          // summary IS valid output.
          const summaryEvent = await prisma.runEvent.findFirst({
            where: { runId: run.id, type: "run_summary" },
            select: { id: true },
          });
          const ranSummary = summaryEvent !== null;
          const producedWork = newTheses > 0 || ranSummary;

          await prisma.researchRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: {
              status: producedWork ? "COMPLETE" : "FAILED",
              completedAt: new Date(),
              ...(producedWork && !ranSummary
                ? {
                    parameters: {
                      triggeredBy: targetConfigId
                        ? "discovery-manual"
                        : "discovery-cron",
                      agentMode: true,
                      analystName: config.name,
                      existingTickerCount: existingTickers.length,
                      note: `Run minted ${newTheses} thesis${newTheses === 1 ? "" : "es"} but did not call record_run_summary — marked COMPLETE because real work landed.`,
                    } as object,
                  }
                : {}),
            },
          });

          console.log(
            `[discovery-run] ${config.name}: ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms, ${newTheses} new theses, ranSummary=${ranSummary}, status=${producedWork ? "COMPLETE" : "FAILED"}`,
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
