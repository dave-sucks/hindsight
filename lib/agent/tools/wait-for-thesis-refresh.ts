/**
 * wait_for_thesis_refresh — block on a previously-dispatched thesis-writer
 * refresh until the worker completes (or times out).
 *
 * Pattern: dispatch_thesis_research returns a childRunId immediately and
 * fires `app/thesis.write.requested`. The actual research takes ~60-120s.
 * If the caller's next action depends on fresh research being on the
 * Thesis row (e.g. place_trade on a thesis whose researchUpdatedAt was
 * stale), it must wait for the worker to land first. This tool is the
 * wait primitive — it polls ResearchRun.status until the row leaves the
 * RUNNING state.
 *
 * Used by:
 *   - Daily run: stale thesis about to be traded → dispatch refresh →
 *     wait → place_trade.
 *   - Tactical run: trigger fires on stale thesis → dispatch → wait →
 *     execute the declared action.
 *   - Discovery run: immediate-buy path on a hot catalyst → dispatch
 *     mint → wait → place_trade (the worker writes WATCHING, the auto-
 *     promote in place_trade flips it to ACTIVE).
 *
 * Implementation: simple poll loop on `ResearchRun.findUnique`. 2s
 * interval, configurable timeout. We could use Inngest's
 * `step.waitForEvent("app/thesis.written")` for a push-based wait, but
 * the agent loop calls tools through the AI SDK which has no Inngest
 * step semantics. Polling is the simplest path; cost is one cheap
 * indexed SELECT every 2s, ~30-60 queries per call.
 *
 * See docs/plans/THESIS_LIFECYCLE_FIX.md Phase 2.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

const POLL_INTERVAL_MS = 2_000;

export const waitForThesisRefresh = defineTool({
  description:
    "Block until a previously-dispatched thesis-writer refresh completes. Pass the childRunId returned by dispatch_thesis_research; the tool polls ResearchRun.status every 2s until COMPLETE or FAILED (or timeout). Returns the updated thesis excerpt (snapshot + bull/bear bullets + researchAge) so the agent can proceed to place_trade / update_thesis / etc. with fresh context. Required after dispatch_thesis_research(mode: 'refresh') when the next action depends on fresh research being on the row (e.g. place_trade on a thesis the staleness gate would otherwise refuse).",
  schema: z.object({
    child_run_id: z
      .string()
      .describe(
        "The childRunId returned by dispatch_thesis_research. Must be a ResearchRun(mode='THESIS_WRITER') row.",
      ),
    timeout_seconds: z
      .number()
      .int()
      .min(30)
      .max(180)
      .optional()
      .describe(
        "Max wait. Default 150s (covers the ~60-120s typical worker run + headroom). Caps at 180s to keep the parent agent's wall-time bounded.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-dispatch",

  progressLabel: ({ child_run_id }) =>
    `Waiting for thesis-writer ${child_run_id.slice(0, 8)}…`,

  execute: async (args, ctx) => {
    const timeoutMs = (args.timeout_seconds ?? 150) * 1000;
    const deadline = Date.now() + timeoutMs;
    const childRunId = args.child_run_id;

    // Initial existence check — surface a clear error if the agent
    // passed a bogus id (mistyped, copy-pasted from a different run, or
    // dispatched in a previous run that already completed and got
    // garbage-collected from the agent's memory).
    const initial = await prisma.researchRun.findUnique({
      where: { id: childRunId },
      select: {
        id: true,
        mode: true,
        status: true,
        parentRunId: true,
        parameters: true,
      },
    });
    if (!initial) {
      return {
        summary: `wait_for_thesis_refresh: no such run ${childRunId}.`,
        data: {
          status: "FAILED" as const,
          note:
            `No ResearchRun found with id ${childRunId}. Pass the exact childRunId returned by dispatch_thesis_research.`,
        },
        sources: [],
      };
    }
    if (initial.mode !== "THESIS_WRITER") {
      return {
        summary: `wait_for_thesis_refresh: run ${childRunId} is mode=${initial.mode}, not THESIS_WRITER.`,
        data: {
          status: "FAILED" as const,
          note:
            "wait_for_thesis_refresh only works on child runs spawned by dispatch_thesis_research (mode=THESIS_WRITER).",
        },
        sources: [],
      };
    }
    // Defensive scope check — if this child run was dispatched by a
    // DIFFERENT parent (different runId on ctx), the current agent
    // shouldn't be waiting on it. Surfaces the operator's mistake
    // (waiting on the wrong run) rather than silently blocking for
    // 150s on someone else's work.
    if (
      ctx.runId &&
      initial.parentRunId &&
      initial.parentRunId !== ctx.runId
    ) {
      return {
        summary: `wait_for_thesis_refresh: run ${childRunId} was dispatched by a different parent run.`,
        data: {
          status: "FAILED" as const,
          note:
            `Child ${childRunId} has parentRunId=${initial.parentRunId} but this agent is run ${ctx.runId}. Wait on a childRunId you dispatched.`,
        },
        sources: [],
      };
    }

    // Poll loop. Exits on terminal status (COMPLETE / FAILED) or timeout.
    let lastStatus = initial.status;
    while (Date.now() < deadline) {
      if (lastStatus === "COMPLETE" || lastStatus === "FAILED") break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const probe = await prisma.researchRun.findUnique({
        where: { id: childRunId },
        select: { status: true },
      });
      lastStatus = probe?.status ?? lastStatus;
    }

    // After the loop: load the (possibly still-running) thesis row so we
    // can return the current research excerpt regardless of terminal
    // status. On a timeout we still want to give the agent SOMETHING to
    // reason about, even if it's the pre-refresh state.
    const params = (initial.parameters ?? {}) as {
      ticker?: string;
      existingThesisId?: string;
      mode?: string;
    };
    const ticker = params.ticker ?? null;
    const thesisId = params.existingThesisId ?? null;
    let thesisExcerpt: {
      thesisId: string;
      ticker: string;
      snapshot: string | null;
      bullCase: string[];
      bearCase: string[];
      researchAge: ReturnType<typeof classifyResearchAge>;
    } | null = null;
    if (thesisId) {
      const thesis = await prisma.thesis.findUnique({
        where: { id: thesisId },
        select: {
          id: true,
          ticker: true,
          snapshot: true,
          bullCase: true,
          bearCase: true,
          researchUpdatedAt: true,
        },
      });
      if (thesis) {
        thesisExcerpt = {
          thesisId: thesis.id,
          ticker: thesis.ticker,
          snapshot: getThesisSnapshotText(thesis) || null,
          bullCase: getThesisBullCaseBullets(thesis),
          bearCase: getThesisBearCaseBullets(thesis),
          researchAge: classifyResearchAge(thesis.researchUpdatedAt),
        };
      }
    }

    // Outcome branching.
    if (lastStatus === "COMPLETE") {
      const freshness = thesisExcerpt?.researchAge.freshness ?? "missing";
      return {
        summary:
          ticker && thesisExcerpt
            ? `$${ticker} refresh complete — research ${freshness} (${thesisExcerpt.researchAge.daysOld ?? 0}d). Proceed.`
            : `Refresh complete for child ${childRunId.slice(0, 8)}.`,
        data: {
          status: "COMPLETE" as const,
          childRunId,
          ticker,
          thesisExcerpt,
          items: [
            ...(ticker
              ? [
                  {
                    kind: "ticker" as const,
                    ticker,
                    tag: `research ${freshness}`,
                    text: thesisExcerpt
                      ? `Refresh landed. snapshot + ${thesisExcerpt.bullCase.length} bull / ${thesisExcerpt.bearCase.length} bear bullets refreshed.`
                      : `Refresh landed (thesis row not loaded — possibly mid-mint).`,
                  },
                ]
              : []),
            {
              kind: "generic" as const,
              text: `Child run ${childRunId.slice(0, 8)} status=COMPLETE. Safe to proceed with place_trade / update_thesis.`,
            },
          ],
        },
        sources: [],
      };
    }

    if (lastStatus === "FAILED") {
      return {
        summary: `Refresh FAILED for child ${childRunId.slice(0, 8)}. Decide whether to proceed on stale research or defer.`,
        data: {
          status: "FAILED" as const,
          childRunId,
          ticker,
          thesisExcerpt,
          note:
            `The thesis-writer worker did not produce a thesis (FAILED). Your options: (1) proceed with the existing pre-refresh research and acknowledge that in your update_thesis rationale, OR (2) defer the action with update_thesis(REVIEWED-only). Do not silently retry — investigate via /runs/${childRunId}.`,
          items: [
            ...(ticker
              ? [
                  {
                    kind: "ticker" as const,
                    ticker,
                    tag: "refresh failed",
                    text: `Worker failed — research age unchanged${thesisExcerpt ? ` (${thesisExcerpt.researchAge.freshness}, ${thesisExcerpt.researchAge.daysOld ?? "?"}d)` : ""}.`,
                  },
                ]
              : []),
            {
              kind: "generic" as const,
              text: `Investigate at /runs/${childRunId}. Acknowledge the failure explicitly if you proceed off stale research.`,
            },
          ],
        },
        sources: [],
      };
    }

    // Timeout — still RUNNING. Surface clearly so the agent doesn't
    // assume freshness. The worker continues; a subsequent agent run
    // may see the refresh land.
    return {
      summary: `Refresh did not complete within ${args.timeout_seconds ?? 150}s. Worker still running.`,
      data: {
        status: "TIMEOUT" as const,
        childRunId,
        ticker,
        thesisExcerpt,
        note:
          `The thesis-writer worker is still RUNNING after the timeout. Research has NOT been refreshed yet. Same options as a failure: proceed on existing research with explicit acknowledgement, or defer with update_thesis(REVIEWED-only). The worker will continue in the background and the refresh may land in time for a later run.`,
        items: [
          ...(ticker
            ? [
                {
                  kind: "ticker" as const,
                  ticker,
                  tag: "wait timeout",
                  text: `Worker still RUNNING after ${args.timeout_seconds ?? 150}s.`,
                },
              ]
            : []),
          {
            kind: "generic" as const,
            text: `Watch progress at /runs/${childRunId}. Do not assume fresh research.`,
          },
        ],
      },
      sources: [],
    };
  },
});
