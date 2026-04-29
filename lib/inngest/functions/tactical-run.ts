// ── Tactical Run ──────────────────────────────────────────────────────────
// Consumes `app/thesis.trigger.fired` events emitted by trigger-evaluator.
// One event = one (thesis, trigger, signal?) tuple = one focused agent run.
//
// Scope is deliberately narrow:
//   • Single ticker (thesis.ticker)
//   • Single decision (validate trigger, then act / update / pass)
//   • 15 step budget (vs 65 for the daily run)
//   • update_thesis is the REQUIRED close-out — every tactical run
//     writes one ThesisUpdate row whether or not it traded.
//
// Tool surface comes from MODES["tactical"] in lib/agent/modes.ts.
// record_thesis is intentionally absent — tactical never mints new
// theses; if conviction breaks the agent calls update_thesis with
// change_status="INVALIDATED" and close_position.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { MODES } from "@/lib/agent/modes";
import type { Trigger } from "@/lib/agent/triggers/types";

// ── Types ───────────────────────────────────────────────────────────────

interface FiredPayload {
  thesisId: string;
  triggerId: string;
  signalId?: string;
  analystId: string;
  ticker: string;
  action: Trigger["action"];
  predicateKind: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findTriggerById(triggersJson: unknown, id: string): Trigger | null {
  const parsed = triggersArraySchema.safeParse(triggersJson);
  if (!parsed.success) return null;
  const found = parsed.data.find((t) => t.id === id);
  if (!found || typeof found.id !== "string") return null;
  return found as Trigger;
}

// ── Inngest function ───────────────────────────────────────────────────

export const tacticalRun = inngest.createFunction(
  {
    id: "tactical-run",
    name: "Tactical Run (event-driven)",
    // Concurrency cap — multiple triggers can fire in the same minute. We
    // serialize per-thesis to avoid two tactical runs racing on the same
    // book entry (e.g. EXIT trigger + ADD trigger firing back-to-back).
    concurrency: { limit: 4, key: "event.data.thesisId" },
    retries: 1,
  },
  { event: "app/thesis.trigger.fired" },
  async ({ event, step }) => {
    const payload = event.data as Partial<FiredPayload>;
    if (
      !payload.thesisId ||
      !payload.triggerId ||
      !payload.analystId ||
      !payload.ticker
    ) {
      return { skipped: "missing-payload" };
    }
    const fired = payload as FiredPayload;

    // ── Load thesis + trigger + signal + position ─────────────────────
    // Note on step.run: Inngest JSON-serializes the return value, so Dates
    // come out as ISO strings on the other side. We pre-compute everything
    // we need in numeric / string form here.
    const ctx = await step.run("load-context", async () => {
      const thesis = await prisma.thesis.findUnique({
        where: { id: fired.thesisId },
        include: {
          researchRun: { select: { agentConfigId: true } },
          updates: {
            orderBy: { timestamp: "desc" },
            take: 5,
            select: {
              type: true,
              summary: true,
              rationale: true,
              timestamp: true,
            },
          },
        },
      });
      if (!thesis) return null;
      if (thesis.status !== "ACTIVE" && thesis.status !== "WATCHING") {
        return null;
      }
      const trigger = findTriggerById(thesis.triggers, fired.triggerId);
      if (!trigger) return null;
      const analystId = thesis.researchRun.agentConfigId;
      if (!analystId) return null;

      const [agentConfig, signal, position] = await Promise.all([
        prisma.agentConfig.findUnique({
          where: { id: analystId },
          select: {
            id: true,
            userId: true,
            name: true,
            analystPrompt: true,
            sectors: true,
            minConfidence: true,
            maxPositionSize: true,
            maxOpenPositions: true,
            watchlist: true,
            exclusionList: true,
          },
        }),
        fired.signalId
          ? prisma.signal.findUnique({
              where: { id: fired.signalId },
              select: {
                id: true,
                type: true,
                sentiment: true,
                urgency: true,
                headline: true,
                summary: true,
                sourceUrls: true,
              },
            })
          : Promise.resolve(null),
        prisma.position.findFirst({
          where: {
            analystId: fired.analystId,
            symbol: thesis.ticker,
            status: "OPEN",
          },
          select: {
            quantity: true,
            avgCost: true,
            openedAt: true,
          },
        }),
      ]);
      if (!agentConfig) return null;

      // Pre-compute daysHeld here so the step.run boundary doesn't hand
      // us a string and force runtime parsing.
      const daysHeld = position
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - position.openedAt.getTime()) / 86_400_000,
            ),
          )
        : null;

      return {
        thesis: {
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          horizon: thesis.horizon,
          coreBelief: thesis.coreBelief,
          keyAssumptions: thesis.keyAssumptions,
          invalidationConds: thesis.invalidationConds,
          entryPrice: thesis.entryPrice != null ? Number(thesis.entryPrice) : null,
          targetPrice:
            thesis.targetPrice != null ? Number(thesis.targetPrice) : null,
          stopLoss: thesis.stopLoss != null ? Number(thesis.stopLoss) : null,
          targetSizePct:
            thesis.targetSizePct != null ? Number(thesis.targetSizePct) : null,
          scalingPlan: thesis.scalingPlan,
          updates: thesis.updates.map((u) => ({
            type: u.type,
            summary: u.summary,
            rationale: u.rationale,
            timestamp: u.timestamp.toISOString(),
          })),
        },
        trigger,
        agentConfig,
        signal,
        position: position
          ? {
              quantity: Number(position.quantity),
              avgCost: Number(position.avgCost),
              daysHeld: daysHeld ?? 0,
            }
          : null,
      };
    });

    if (!ctx) {
      return { skipped: "context-not-loadable", thesisId: fired.thesisId };
    }
    const { thesis, trigger, agentConfig, signal, position } = ctx;

    // ── Create ResearchRun row ────────────────────────────────────────
    const run = await step.run("create-run", async () => {
      return prisma.researchRun.create({
        data: {
          userId: agentConfig.userId,
          agentConfigId: agentConfig.id,
          source: "AGENT",
          status: "RUNNING",
          mode: "INTRADAY_TACTICAL",
          parameters: {
            triggeredBy: "trigger-fired",
            thesisId: thesis.id,
            triggerId: trigger.id,
            signalId: signal?.id ?? null,
            ticker: thesis.ticker,
            action: trigger.action,
            predicateKind: fired.predicateKind,
            agentMode: true,
            analystName: agentConfig.name,
          } as object,
        },
        select: { id: true },
      });
    });

    // ── Run the agent ─────────────────────────────────────────────────
    const outcome = await step.run("agent-run", async () => {
      const t0 = Date.now();
      const alpacaCreds =
        (await resolveAlpacaCredentials(agentConfig.userId)) ?? undefined;

      const allTools = createResearchTools({
        runId: run.id,
        userId: agentConfig.userId,
        analystId: agentConfig.id,
        watchlist: agentConfig.watchlist ?? [],
        exclusionList: agentConfig.exclusionList ?? [],
        sectors: agentConfig.sectors ?? [],
        maxPositionSize: Number(agentConfig.maxPositionSize),
        maxOpenPositions: agentConfig.maxOpenPositions,
        minConfidence: agentConfig.minConfidence,
        alpacaCreds,
      });

      const allowlist = MODES["tactical"].toolAllowlist;
      const tools = allowlist
        ? Object.fromEntries(
            allowlist
              .map(
                (name) => [name, allTools[name as keyof typeof allTools]] as const,
              )
              .filter(([, v]) => v != null),
          )
        : allTools;

      const systemPrompt = buildTacticalSystemPrompt({
        analyst: { name: agentConfig.name, mandate: agentConfig.analystPrompt },
        thesis: {
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          horizon: thesis.horizon,
          coreBelief: thesis.coreBelief,
          keyAssumptions: thesis.keyAssumptions,
          invalidationConds: thesis.invalidationConds,
          entryPrice: thesis.entryPrice,
          targetPrice: thesis.targetPrice,
          stopLoss: thesis.stopLoss,
          targetSizePct: thesis.targetSizePct,
          scalingPlan: thesis.scalingPlan,
        },
        trigger,
        signal,
        position,
        recentUpdates: thesis.updates,
      });

      try {
        const { steps } = await generateText({
          model: openai(MODES["tactical"].model),
          system: systemPrompt,
          prompt: `A trigger you set on your $${thesis.ticker} thesis just fired. Validate, decide, act if warranted, then close out via update_thesis.`,
          tools,
          providerOptions: { openai: { strictJsonSchema: true } },
          stopWhen: stepCountIs(MODES["tactical"].maxSteps),
          abortSignal: AbortSignal.timeout(
            (MODES["tactical"].maxDuration - 30) * 1000,
          ),
        });

        const toolCalls = steps.reduce(
          (sum, s) => sum + (s.toolCalls?.length ?? 0),
          0,
        );
        const elapsed = Date.now() - t0;
        console.log(
          `[tactical-run] thesis=${thesis.id} trigger=${trigger.id} ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`,
        );

        // Verify update_thesis was actually called for this thesis (the
        // close-out contract). If not, mark FAILED so the operator sees it.
        const update = await prisma.thesisUpdate.findFirst({
          where: { runId: run.id, thesisId: thesis.id },
          select: { id: true },
        });
        const closedOut = update !== null;

        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: closedOut ? "COMPLETE" : "FAILED",
            completedAt: new Date(),
          },
        });

        if (!closedOut) {
          await prisma.runEvent.create({
            data: {
              runId: run.id,
              type: "run_failed",
              title: "Tactical run did not close out",
              message:
                "Tactical contract: update_thesis MUST be called once. Agent finished without writing a ThesisUpdate row for this thesis.",
              payload: {
                thesisId: thesis.id,
                triggerId: trigger.id,
                steps: steps.length,
                toolCalls,
              } as object,
            },
          });
        }

        return {
          steps: steps.length,
          toolCalls,
          elapsed,
          closedOut,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error(
          `[tactical-run] thesis=${thesis.id} trigger=${trigger.id} agent error: ${msg}`,
        );
        await prisma.researchRun.update({
          where: { id: run.id },
          data: { status: "FAILED", completedAt: new Date() },
        });
        return { error: msg, closedOut: false };
      }
    });

    return {
      runId: run.id,
      thesisId: thesis.id,
      triggerId: trigger.id,
      signalId: signal?.id ?? null,
      ticker: thesis.ticker,
      action: trigger.action,
      ...outcome,
    };
  },
);
