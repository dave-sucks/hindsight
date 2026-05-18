/**
 * dispatch_thesis_research — orchestrator-side tool. Spawns a thesis-writer
 * sub-agent run for one ticker. Returns immediately with the child run ID;
 * the actual deep-research work happens asynchronously in the
 * `thesis-writer` Inngest function.
 *
 * Pattern: insert a child ResearchRun (mode="THESIS_WRITER",
 * parentRunId=ctx.runId), fire `app/thesis.write.requested`, return the
 * childRunId. Discovery / Daily / Tactical / Principal Chat all call this
 * — per-orchestrator wait semantics live in the caller (fire-and-forget vs
 * waitForEvent vs inline call).
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §6.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

export const dispatchThesisResearch = defineTool({
  description:
    "Dispatch a thesis-writer sub-agent to write or refresh a deep-research thesis on one " +
    "ticker. Use this whenever the user (or your orchestration logic) wants a fresh, " +
    "multi-section equity-research note — it spawns a focused child agent that pulls the " +
    "structured data, calls the deep-research model, and persists the thesis. Returns " +
    "immediately with a child run ID; the research itself takes ~60-120s and runs " +
    "asynchronously in an Inngest function. The user can watch the child run stream live " +
    "at /runs/<childRunId>.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. NVDA"),
    analyst_id: z
      .string()
      .describe(
        "AgentConfig.id — whose voice to write in. The thesis row is FK'd to this analyst.",
      ),
    mode: z
      .enum(["mint", "refresh"])
      .describe(
        "mint = net-new coverage; refresh = update an existing thesis with new evidence.",
      ),
    existing_thesis_id: z
      .string()
      .optional()
      .describe(
        "Required when mode='refresh' — the Thesis.id whose research should be updated.",
      ),
    reason: z
      .string()
      .min(20)
      .describe(
        "Why this dispatch is happening (e.g. 'User asked for a fresh thesis on $F via " +
          "Principal Chat'). Persisted on the child run's parameters for traceability.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-dispatch",

  progressLabel: ({ ticker, mode }) =>
    mode === "refresh"
      ? `Refreshing $${ticker.toUpperCase()} thesis`
      : `Dispatching $${ticker.toUpperCase()} thesis-writer`,

  execute: async (args, ctx) => {
    const T = args.ticker.toUpperCase();

    // Verify the analyst exists + belongs to this account before inserting
    // the child run row. The FK on ResearchRun.agentConfigId is SetNull, so
    // a bogus id wouldn't fail at insert — it'd just orphan the run.
    const analyst = await prisma.agentConfig.findFirst({
      where: { id: args.analyst_id, accountId: ctx.accountId },
      select: { id: true, name: true, userId: true, accountId: true },
    });
    if (!analyst) {
      return {
        summary: `Dispatch failed: analyst ${args.analyst_id} not found on this account.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            `No analyst with id ${args.analyst_id} exists on this account. Use list_analysts ` +
            `to find the right analyst_id before calling dispatch_thesis_research.`,
        },
        sources: [],
      };
    }

    if (args.mode === "refresh" && !args.existing_thesis_id) {
      return {
        summary: `Dispatch failed for $${T}: refresh mode requires existing_thesis_id.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            "When mode='refresh', pass existing_thesis_id — the Thesis.id whose research " +
            "should be updated. For net-new coverage, use mode='mint' instead.",
        },
        sources: [],
      };
    }

    // mode is intentionally a String column on ResearchRun (not a Prisma
    // enum) so new values like "THESIS_WRITER" don't need a migration. See
    // docs/plans/THESIS_RESEARCH_V2.md §7.
    const childRun = await prisma.researchRun.create({
      data: {
        userId: analyst.userId,
        accountId: analyst.accountId,
        agentConfigId: analyst.id,
        source: "AGENT",
        status: "RUNNING",
        mode: "THESIS_WRITER",
        environment: ctx.runEnvironment ?? "PAPER",
        parentRunId: ctx.runId,
        parameters: {
          ticker: T,
          mode: args.mode,
          existingThesisId: args.existing_thesis_id ?? null,
          reason: args.reason,
          parentRunId: ctx.runId,
          dispatchedAt: new Date().toISOString(),
        } as object,
      },
      select: { id: true },
    });

    await inngest.send({
      name: "app/thesis.write.requested",
      data: {
        childRunId: childRun.id,
        ticker: T,
        analystId: analyst.id,
        mode: args.mode,
        existingThesisId: args.existing_thesis_id ?? null,
        reason: args.reason,
        parentRunId: ctx.runId,
      },
    });

    return {
      summary: `Dispatched thesis-writer for $${T} (${args.mode}) — child run ${childRun.id}`,
      data: {
        childRunId: childRun.id,
        ticker: T,
        mode: args.mode,
        analystName: analyst.name,
        estimatedDurationMs: 90_000,
        items: [
          {
            kind: "ticker" as const,
            ticker: T,
            tag: args.mode === "refresh" ? "refresh dispatched" : "mint dispatched",
            text: `Worker spawned for ${analyst.name} · child run ${childRun.id.slice(0, 8)}…`,
          },
          {
            kind: "generic" as const,
            text:
              `Watch progress at /runs/${childRun.id}. ETA ~60-120s. ` +
              `Result lands as a Thesis with researchData + researchSections populated.`,
          },
        ],
      },
      sources: [],
    };
  },
});
