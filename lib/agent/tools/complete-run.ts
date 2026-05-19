/**
 * complete_run — migrated to defineTool().
 *
 * STAGE 6 — final tool call. Marks the run COMPLETE, fires the
 * post-run briefing agent (updateAnalystBriefing), writes the
 * briefing_generated RunEvent. Briefing block preserved byte-for-byte.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";
import { updateSegmentBriefing } from "@/lib/podcast/update-segment-briefing";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import type { Trigger } from "@/lib/agent/triggers/types";

export const completeRun = defineTool({
  description:
    "STAGE 6. Mark the run complete. This is your absolute final tool call. No arguments needed. Calling this triggers the post-run briefing agent automatically.",
  schema: z.object({}),
  ui: "tool-ui" as const,

  progressLabel: () => "Wrapping up the run",

  execute: async (_args, ctx) => {
    try {
      // ── Preflight gates (GAPS P0-7 + P0-9c) ──────────────────────────
      // Layer-1 rejection: force the agent to address triggered theses and
      // call record_run_summary before the run is allowed to complete.
      // These run BEFORE the RUNNING→COMPLETE transition so the agent sees
      // rejections in-conversation and can recover without the run going
      // terminal. Skip for podcast segments and unscoped runs.
      if (ctx.runId && ctx.analystId && !ctx.podcastSegmentId) {
        const preflightFailure = await runCompleteRunPreflight(ctx.runId, ctx.analystId, ctx.runMode);
        if (preflightFailure) {
          return {
            summary: `complete_run refused: ${preflightFailure.shortReason}`,
            data: {
              ok: false,
              briefing: "skipped" as const,
              briefingError: null,
              error: preflightFailure.message,
              preflight: preflightFailure.kind,
              items: [{ kind: "generic" as const, text: preflightFailure.message }],
            },
            sources: [],
          };
        }
      }

      // Atomic: only transition RUNNING → COMPLETE. Was previously
      // `status: { not: "COMPLETE" }`, which clobbered FAILED status set
      // by the record_run_summary narration→execution gate (or any other
      // upstream terminal-state writer). RUNNING-only matches the
      // morning-research cron-level gate's transition shape.
      const completeResult = await prisma.researchRun.updateMany({
        where: { id: ctx.runId, status: "RUNNING" },
        data: { status: "COMPLETE", completedAt: new Date() },
      });
      if (completeResult.count === 0) {
        console.log(`[tool] complete_run: run ${ctx.runId} not RUNNING (already terminal), skipping status update`);
      }

      if (ctx.runId) {
        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "run_complete",
              title: "Run complete",
              message: null,
              payload: {} as object,
            },
          });
        } catch (evtErr) {
          console.error(`[tool] complete_run run_complete event failed:`, evtErr instanceof Error ? evtErr.message : evtErr);
        }
      }

      // ── Podcast-segment-run branch ───────────────────────────────────────
      // Skip the analyst-briefing block (analystId is undefined). Instead
      // call updateSegmentBriefing to write a PodcastSegmentBriefing row —
      // same role as AnalystBriefing for analyst runs, simpler shape
      // (no portfolio state). The next run loads the most recent briefing
      // for cross-episode continuity.
      if (ctx.podcastSegmentId) {
        const transcript = await prisma.segmentTranscript.findUnique({
          where: { runId: ctx.runId },
          select: {
            id: true,
            title: true,
            durationSec: true,
            citations: true,
          },
        });

        // Write segment briefing (non-fatal). Mirror of updateAnalystBriefing.
        let briefingStatus: "success" | "failed" | "skipped" = "skipped";
        let briefingError: string | null = null;
        try {
          await updateSegmentBriefing({
            segmentId: ctx.podcastSegmentId,
            runId: ctx.runId,
            userId: ctx.userId,
            accountId: ctx.accountId,
          });
          const written = await prisma.podcastSegmentBriefing.findUnique({
            where: { runId: ctx.runId },
            select: { id: true },
          });
          briefingStatus = written ? "success" : "failed";
          if (!written) {
            briefingError =
              "updateSegmentBriefing returned without throwing but no row was persisted.";
          }
        } catch (briefErr) {
          briefingStatus = "failed";
          briefingError =
            briefErr instanceof Error ? briefErr.message : String(briefErr);
          console.error(
            `[tool] complete_run: segment briefing THREW for run=${ctx.runId}:`,
            briefingError,
          );
        }

        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "segment_run_complete",
              title: transcript
                ? `Segment ready: ${transcript.title}`
                : "Segment run complete (no transcript)",
              message: transcript
                ? `~${transcript.durationSec ?? "?"}s · ${
                    Array.isArray(transcript.citations)
                      ? (transcript.citations as unknown[]).length
                      : 0
                  } citations · briefing ${briefingStatus}`
                : "Run finished without writing a transcript.",
              payload: {
                transcriptId: transcript?.id ?? null,
                briefingStatus,
                ...(briefingError ? { briefingError } : {}),
              } as object,
            },
          });
        } catch (evtErr) {
          console.error(
            `[tool] complete_run podcast-event failed:`,
            evtErr instanceof Error ? evtErr.message : evtErr,
          );
        }
        return {
          summary: transcript
            ? `Segment complete: ${transcript.title}. Briefing ${briefingStatus}.`
            : "Segment run complete (no transcript saved).",
          data: {
            ok: true,
            podcastSegmentId: ctx.podcastSegmentId,
            transcriptId: transcript?.id ?? null,
            briefing: briefingStatus,
            briefingError,
            items: [
              {
                kind: "generic" as const,
                text: transcript
                  ? `Transcript ready · ~${transcript.durationSec ?? "?"}s · briefing ${briefingStatus}`
                  : "No transcript was written for this run.",
              },
            ],
          },
          sources: [],
        };
      }

      // ── Briefing block (UNTOUCHED from PR #132) ──────────────────────────
      console.log(`[tool] complete_run: ENTERING briefing block for run=${ctx.runId} analystId=${ctx.analystId ?? "MISSING"}`);
      let briefingStatus: "success" | "failed" | "skipped" = "skipped";
      let briefingError: string | null = null;
      if (ctx.analystId) {
        try {
          const briefStart = Date.now();
          await updateAnalystBriefing({ analystId: ctx.analystId, runId: ctx.runId, userId: ctx.userId, accountId: ctx.accountId });
          console.log(`[tool] complete_run: updateAnalystBriefing returned for run=${ctx.runId} in ${Date.now() - briefStart}ms`);
          const writtenBrief = await prisma.analystBriefing.findFirst({
            where: { runId: ctx.runId },
            select: { id: true },
          });
          if (writtenBrief) {
            briefingStatus = "success";
          } else {
            briefingStatus = "failed";
            briefingError = "updateAnalystBriefing returned without throwing but no AnalystBriefing row was persisted.";
            console.error(`[tool] complete_run: ❌ ${briefingError}`);
          }
        } catch (briefErr) {
          briefingStatus = "failed";
          briefingError = briefErr instanceof Error ? briefErr.message : String(briefErr);
          console.error(`[tool] complete_run: briefing generation THREW for run=${ctx.runId}:`, briefingError);
        }
      } else {
        briefingError = "No analyst linked to this run — briefing requires an analyst context.";
        console.warn(`[tool] complete_run: no analystId in context (runId=${ctx.runId}) — briefing skipped`);
      }
      console.log(`[tool] complete_run: EXITING briefing block for run=${ctx.runId} status=${briefingStatus}`);

      try {
        await prisma.runEvent.create({
          data: {
            runId: ctx.runId,
            type: "briefing_generated",
            title:
              briefingStatus === "success"
                ? "Portfolio briefing written"
                : briefingStatus === "failed"
                  ? "Portfolio briefing FAILED"
                  : "Portfolio briefing skipped",
            message:
              briefingStatus === "success"
                ? "GPT-4o reviewed the full session and wrote the standup brief for the next run."
                : briefingError ?? "Briefing generation did not run.",
            payload: {
              briefingStatus,
              ...(briefingError ? { error: briefingError } : {}),
            } as object,
          },
        });
      } catch (evtErr) {
        console.error(`[tool] complete_run: failed to write briefing_generated event:`, evtErr);
      }

      const briefingLine =
        briefingStatus === "success"
          ? "Briefing: written and verified"
          : briefingStatus === "failed"
            ? `Briefing: failed${briefingError ? ` — ${briefingError}` : ""}`
            : `Briefing: skipped${briefingError ? ` — ${briefingError}` : ""}`;
      return {
        summary: `Run complete. Briefing: ${briefingStatus}.`,
        data: {
          ok: true,
          briefing: briefingStatus,
          briefingError,
          items: [{ kind: "generic" as const, text: briefingLine }],
        },
        sources: [],
      };
    } catch (err) {
      console.error(`[tool] complete_run FAILED:`, err instanceof Error ? err.message : err);
      try {
        await prisma.researchRun.updateMany({
          where: { id: ctx.runId, status: "RUNNING" },
          data: { status: "COMPLETE", completedAt: new Date() },
        });
      } catch { /* already tried */ }
      return {
        summary: `complete_run failed: ${err instanceof Error ? err.message : "unknown error"}`,
        data: {
          ok: false,
          briefing: "skipped" as const,
          briefingError: err instanceof Error ? err.message : "complete_run failed",
          error: err instanceof Error ? err.message : "complete_run failed",
        },
        sources: [],
      };
    }
  },
});

// ─── Preflight (GAPS P0-7 + P0-9c) ──────────────────────────────────────────
// Layer-1 rejection that forces the agent to call record_run_summary and
// address triggered theses BEFORE the run is allowed to complete.

type PreflightFailure = {
  kind: "no_run_summary" | "run_already_failed" | "unaddressed_theses";
  shortReason: string;
  message: string;
};

async function runCompleteRunPreflight(
  runId: string,
  analystId: string,
  runMode?: string,
): Promise<PreflightFailure | null> {
  // 1) Did the agent call record_run_summary?
  //
  // Tactical runs are exempt: they're single-thesis, single-decision, and
  // record_run_summary is not in the INTRADAY_TACTICAL tool allowlist
  // (lib/agent/modes.ts). Before this exemption, every tactical run hit
  // the gate, retried complete_run (which the agent literally couldn't
  // satisfy), and only completed because tactical-run.ts's closeOut path
  // set status=COMPLETE based on update_thesis having fired. Net effect
  // was 2 wasted retries per tactical run (35 runs × 2 = 70 wasted steps
  // on 2026-05-18 alone) plus training the model to ignore gate refusals
  // — which then leaked into daily-run where the gates DO matter. The
  // unaddressed_theses gate below still applies to tactical.
  //
  // A6 from docs/plans/SYSTEM_AUDIT_2026_05_19.md.
  const skipSummaryGate = runMode === "INTRADAY_TACTICAL";
  if (!skipSummaryGate) {
    const summaryEvent = await prisma.runEvent.findFirst({
      where: { runId, type: "run_summary" },
      select: { id: true },
    });
    if (!summaryEvent) {
      return {
        kind: "no_run_summary",
        shortReason: "record_run_summary not called",
        message:
          "complete_run refused: you must call record_run_summary BEFORE complete_run. " +
          "Summarize this run's decisions (primary_decision, decision_rationale, ranked_picks) " +
          "and call complete_run again.",
      };
    }
  }

  // 2) Did an upstream gate (narration gate) already mark this run FAILED?
  //    Surface the failure reason in-conversation so the agent knows.
  const currentRun = await prisma.researchRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (currentRun?.status === "FAILED") {
    const failEvent = await prisma.runEvent.findFirst({
      where: { runId, type: "run_failed" },
      orderBy: { createdAt: "desc" },
      select: { title: true, message: true },
    });
    return {
      kind: "run_already_failed",
      shortReason: failEvent?.title ?? "run is FAILED",
      message:
        "complete_run refused: this run was marked FAILED by an earlier gate. " +
        `Reason: ${failEvent?.message ?? "(no failure event recorded)"} ` +
        "Address the issue (call the tool you narrated, or revise record_run_summary), then complete_run again.",
    };
  }

  // 3) Triggered/needsAction theses not addressed via update_thesis this run.
  //    Uses computeNeedsAction (cooldown-aware shouldFire) — same logic
  //    needs-action.ts uses for get_theses, so Layer 2 and Layer 1 ask the
  //    SAME question. Bug 1 fix: no more "needsAction said null but the
  //    gate says you missed it" inconsistency (GAPS P0-7).
  type ThesisRow = {
    id: string;
    ticker: string;
    direction: string;
    triggers: unknown;
    createdAt: Date;
    nextReviewAt: Date | null;
    updates: Array<{ type: string; triggerId: string | null; timestamp: Date }>;
  };
  const theses = (await prisma.thesis.findMany({
    where: {
      researchRun: { agentConfigId: analystId },
      status: { in: ["ACTIVE", "WATCHING"] },
      closedAt: null,
    },
    select: {
      id: true,
      ticker: true,
      direction: true,
      triggers: true,
      createdAt: true,
      nextReviewAt: true,
      updates: {
        orderBy: { timestamp: "desc" },
        take: 1,
        select: { type: true, triggerId: true, timestamp: true },
      },
    },
  })) as ThesisRow[];
  if (theses.length === 0) return null;

  const addressedThesisIds = new Set<string>(
    (
      await prisma.thesisUpdate.findMany({
        where: {
          runId,
          thesisId: { in: theses.map((t: ThesisRow) => t.id) },
          NOT: { type: "TRIGGER_FIRED" },
        },
        select: { thesisId: true },
      })
    ).map((u: { thesisId: string }) => u.thesisId),
  );

  const tickerSet = new Set<string>(theses.map((t: ThesisRow) => t.ticker));
  const quotes = new Map<string, { price: number; changePct: number }>();
  await Promise.all(
    Array.from(tickerSet).map(async (tk) => {
      try {
        const q = await getStockQuote(tk);
        if (q && Number.isFinite(q.c) && q.c > 0) {
          quotes.set(tk, { price: q.c, changePct: q.dp ?? 0 });
        }
      } catch {
        /* missing quote → skip; computeNeedsAction handles it */
      }
    }),
  );

  const now = new Date();
  const unaddressed: Array<{
    thesisId: string;
    ticker: string;
    direction: string;
    kind: string;
    detail: string;
  }> = [];
  for (const t of theses) {
    if (addressedThesisIds.has(t.id)) continue;
    const needsAction = computeNeedsAction({
      thesis: {
        id: t.id,
        triggers: (t.triggers as unknown as Trigger[]) ?? [],
        createdAt: t.createdAt,
        nextReviewAt: t.nextReviewAt,
      },
      latestUpdate: t.updates[0]
        ? {
            type: t.updates[0].type as string,
            triggerId: t.updates[0].triggerId ?? null,
            timestamp: t.updates[0].timestamp,
          }
        : null,
      latestQuote: quotes.get(t.ticker) ?? null,
      now,
    });
    if (needsAction == null) continue;
    let detail: string;
    if (needsAction.kind === "TRIGGER_FIRED") {
      detail = `trigger fired: ${needsAction.action} (${needsAction.summary})`;
    } else if (needsAction.kind === "TRIGGER_MATCHING_NOW") {
      detail = `predicate matching now: ${needsAction.action} (${needsAction.predicateSummary}${needsAction.livePrice != null ? ` @ $${needsAction.livePrice.toFixed(2)}` : ""})`;
    } else {
      detail = `review overdue by ${needsAction.daysOverdue}d`;
    }
    unaddressed.push({
      thesisId: t.id,
      ticker: t.ticker,
      direction: t.direction,
      kind: needsAction.kind,
      detail,
    });
  }

  if (unaddressed.length === 0) return null;

  const summary = unaddressed
    .map((u) => `${u.ticker} (${u.thesisId}): ${u.detail}`)
    .join("; ");
  return {
    kind: "unaddressed_theses",
    shortReason: `${unaddressed.length} thesis${unaddressed.length > 1 ? "es" : ""} need action`,
    message:
      `complete_run refused: ${unaddressed.length} active/watching thesis${unaddressed.length > 1 ? "es" : ""} ` +
      `${unaddressed.length > 1 ? "are" : "is"} flagged needsAction but no update_thesis was called for ` +
      `${unaddressed.length > 1 ? "them" : "it"} in this run. ` +
      `Resolve each by calling update_thesis (with action result, change_status="INVALIDATED" if no longer applicable, or rationale-only REVIEW). ` +
      `Then call complete_run again. Unaddressed: ${summary}`,
  };
}
