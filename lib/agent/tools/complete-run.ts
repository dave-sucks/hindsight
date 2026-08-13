/**
 * complete_run — migrated to defineTool().
 *
 * STAGE 6 — final tool call. Marks the run COMPLETE and writes the
 * briefing_generated RunEvent. The per-analyst AnalystBriefing write is
 * DEPRECATED (docs/plans/PORTFOLIO_DIGEST.md); continuity now comes from
 * the account-level PortfolioDigest. briefingStatus stays "skipped".
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { updateSegmentBriefing } from "@/lib/podcast/update-segment-briefing";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import { getPendingEntryTickers } from "@/lib/proposals/pending-entry";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import type { Trigger } from "@/lib/agent/triggers/types";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import {
  detectNarrationHits,
  findGaps,
  type NarrationHit,
  type ToolCallEvent,
} from "@/lib/agent/narration-gate";

export const completeRun = defineTool({
  description:
    "STAGE 6. Mark the run complete. This is your absolute final tool call. No arguments needed.",
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

      // ── Briefing block — DEPRECATED ──────────────────────────────────────
      // The per-analyst AnalystBriefing is no longer written on run
      // completion (docs/plans/PORTFOLIO_DIGEST.md). Cross-run continuity now
      // comes from the account-level PortfolioDigest, generated by the digest
      // backend and read by buildRunInput. updateAnalystBriefing is no longer
      // called here. The return shape below is kept intact — briefingStatus
      // stays "skipped" so existing consumers degrade cleanly.
      // Per-analyst briefing is fully deprecated — there is no success/failed
      // path anymore; cross-run continuity comes from the account-level
      // PortfolioDigest. We still write the briefing_generated RunEvent (so the
      // run timeline + any existing consumers stay stable) with a skipped state.
      console.log(`[tool] complete_run: per-analyst briefing deprecated — skipped for run=${ctx.runId}`);

      try {
        await prisma.runEvent.create({
          data: {
            runId: ctx.runId,
            type: "briefing_generated",
            title: "Portfolio briefing skipped",
            message:
              "Per-analyst briefing is deprecated — cross-run continuity now comes from the account-level portfolio digest.",
            payload: { briefingStatus: "skipped" } as object,
          },
        });
      } catch (evtErr) {
        console.error(`[tool] complete_run: failed to write briefing_generated event:`, evtErr);
      }

      // ── Ladder warn-gate (Game Plan PR-C — WARN-MODE, never blocks) ──────
      // Structural invariant from docs/plans/THESIS_GAME_PLAN.md §4: no
      // HOLDING should leave a run without a forward ladder — at minimum a
      // protective EXIT rung (fixed floor or trail). This is deliberately
      // warn-only for the first live cycle; the price-dependent
      // UNPROTECTED_GAIN check runs every morning via get_theses/needsAction
      // (which has live quotes), so this close-out gate only checks the
      // quote-free structural failures. Escalate to a hard refusal once a
      // week of warn telemetry shows no false positives.
      const ladderWarnings: string[] = [];
      if (ctx.analystId) {
        try {
          const holdings = await prisma.thesis.findMany({
            where: {
              researchRun: { agentConfigId: ctx.analystId },
              status: "HOLDING",
            },
            select: {
              ticker: true,
              triggers: true,
              // Cascade inputs — this gate must judge the RESOLVED ladder.
              // Reading the stored column alone reports a holding whose
              // floor is inherited as having "no floor, no trail", so the
              // warn-gate would nag every run about a ladder that is
              // already correct — and the agent would "fix" it by
              // materializing a duplicate.
              triggerState: true,
              horizon: true,
              status: true,
            },
          });
          const levelSources = ctx.analystId
            ? (await loadLevelSources([ctx.analystId])).get(ctx.analystId)
            : undefined;
          for (const h of holdings) {
            const ladder = resolveThesisLadder(h, levelSources, `ticker=${h.ticker}`);
            if (ladder.length === 0) {
              ladderWarnings.push(
                `$${h.ticker}: HOLDING with zero triggers — no ladder at all`,
              );
              continue;
            }
            const hasProtectiveExit = ladder.some(
              (t) =>
                t.action === "EXIT" &&
                ["PRICE_BELOW", "PRICE_ABOVE", "TRAILING_FROM_HIGH", "GAIN_FROM_ENTRY"].includes(
                  t.predicate.kind,
                ),
            );
            if (!hasProtectiveExit) {
              ladderWarnings.push(
                `$${h.ticker}: HOLDING with no protective EXIT rung (no floor, no trail)`,
              );
            }
          }
          if (ladderWarnings.length > 0) {
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: "ladder_warning",
                title: `Ladder warn-gate: ${ladderWarnings.length} unprotected holding(s)`,
                message: ladderWarnings.join("; "),
                payload: { warnings: ladderWarnings, mode: "warn" } as object,
              },
            });
            console.warn(
              `[tool] complete_run ladder warn-gate (run=${ctx.runId}):`,
              ladderWarnings.join("; "),
            );
          }
        } catch (warnErr) {
          // Warn-gate must never break run completion.
          console.error(
            `[tool] complete_run ladder warn-gate errored (non-fatal):`,
            warnErr instanceof Error ? warnErr.message : warnErr,
          );
        }
      }

      return {
        summary:
          ladderWarnings.length > 0
            ? `Run complete. ⚠ ${ladderWarnings.length} holding(s) left without a protective ladder — see ladder_warning event.`
            : "Run complete. Briefing: skipped (deprecated).",
        data: {
          ok: true,
          briefing: "skipped" as const,
          briefingError: null,
          items: [
            {
              kind: "generic" as const,
              text: "Briefing: skipped — continuity now via the account portfolio digest",
            },
            ...ladderWarnings.map((w) => ({
              kind: "generic" as const,
              text: `⚠ Ladder warning: ${w}`,
            })),
          ],
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
  kind:
    | "no_run_summary"
    | "run_already_failed"
    | "narration_execution_gap"
    | "unaddressed_theses";
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
  //
  // THESIS_WRITER added 2026-05-24 — same shape as INTRADAY_TACTICAL.
  // Thesis-writer child runs dispatched by Discovery are single-thesis,
  // single-decision; record_run_summary is NOT in the thesis-writer
  // allowlist (lib/agent/modes.ts); run-thesis-writer.ts manually marks
  // status=COMPLETE in its fallback based on whether a thesis was
  // recorded. Before this exemption the HPQ E2E run (2026-05-24) burned
  // 2 of its 8-step budget on failed complete_run retries — same
  // wasteful pattern A6 documented for tactical. See
  // docs/discovery-reviews/2026-05-24-HPQ.md follow-up #4.
  const skipSummaryGate =
    runMode === "INTRADAY_TACTICAL" || runMode === "THESIS_WRITER";
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

  // 3) Narration→execution gap (P0-12, moved here from record_run_summary
  //    on 2026-05-23). Look at the MOST RECENT run_summary event's
  //    rationale + ranked_picks reasoning. If any narrated close/exit/trim
  //    verb references a ticker that never got a position_closed or
  //    position_modified event THIS run, refuse complete_run with a message
  //    asking the agent to call the missing tool. Self-corrected runs
  //    (agent narrated then called the tool, in either order) pass.
  //    Tactical exempt — record_run_summary isn't in its allowlist, so no
  //    run_summary event exists to scan against; the unaddressed_theses
  //    check below is the real backstop for tactical.
  if (!skipSummaryGate) {
    const narrationFailure = await checkNarrationExecutionGap(runId);
    if (narrationFailure) return narrationFailure;
  }

  // 4) Triggered/needsAction theses not addressed via update_thesis this run.
  //    Uses computeNeedsAction (cooldown-aware shouldFire) — same logic
  //    needs-action.ts uses for get_theses, so Layer 2 and Layer 1 ask the
  //    SAME question. Bug 1 fix: no more "needsAction said null but the
  //    gate says you missed it" inconsistency (GAPS P0-7).
  //
  // SCOPE BY MODE: daily-run is portfolio-walking, so all ACTIVE/WATCHING
  // theses on the analyst are in scope. Tactical is single-thesis,
  // single-decision — only the triggered thesis is in scope. Without this
  // scoping, PR #290's `no_run_summary` skip exposed the gate to tactical
  // runs for the first time and the agent started addressing every overdue
  // thesis on the book to get past the gate. Observed 2026-05-20: WDAY
  // (and other stale-review theses) updated as a side effect of every
  // Tech Momentum tactical run, regardless of the actual trigger ticker.
  type ThesisRow = {
    id: string;
    ticker: string;
    direction: string;
    status: string;
    triggers: unknown;
    createdAt: Date;
    nextReviewAt: Date | null;
    paperTenureDays: number | null;
    // Prisma Decimal — typed as unknown to avoid the runtime-library import;
    // coerced via Number() at the computeNeedsAction call site below.
    paperRealizedPnl: unknown;
    paperReviewCount: number | null;
    promotedAt: Date | null;
    updates: Array<{ type: string; triggerId: string | null; timestamp: Date }>;
  };
  // Determine the in-scope thesis set based on mode. PROMOTED is included
  // alongside ACTIVE+WATCHING because PROMOTED rows ALWAYS need resolution
  // this run — the user explicitly graduated the analyst to live money and
  // the paper position was force-closed; the agent must either re-enter
  // (place_trade) or defer (update_thesis change_status: WATCHING).
  // Without PROMOTED in scope, the first live morning run can complete
  // without acting on any promoted rows (production-confirmed failure
  // mode on 2026-05-26 — see GAPS.md P0-1).
  let thesisWhereScope: object;
  if (runMode === "INTRADAY_TACTICAL" || runMode === "THESIS_WRITER") {
    // Single-thesis sub-agents: only the in-scope thesis.
    //   • INTRADAY_TACTICAL — the triggered thesis (parameters.thesisId)
    //   • THESIS_WRITER     — the thesis just minted/refreshed (also
    //                         persisted as parameters.thesisId by
    //                         run-thesis-writer.ts on success)
    // Scoping to the analyst's whole book would gate the sub-agent on
    // unrelated needsAction work that's the daily-run's responsibility,
    // not this sub-agent's. THESIS_WRITER added 2026-05-24 alongside the
    // record_run_summary carve-out above. See docs/discovery-reviews/
    // 2026-05-24-HPQ.md follow-up #4.
    const run = await prisma.researchRun.findUnique({
      where: { id: runId },
      select: { parameters: true },
    });
    const triggeredThesisId =
      (run?.parameters as { thesisId?: string } | null)?.thesisId ?? null;
    if (!triggeredThesisId) {
      // Defensive: a sub-agent run without parameters.thesisId is either
      // malformed (tactical) or a thesis-writer mint that hasn't recorded
      // its thesis yet (separate FAILED-no-output path catches that).
      // Fall through to "no theses to check" rather than gate the whole
      // book.
      return null;
    }
    thesisWhereScope = {
      id: triggeredThesisId,
      researchRun: { agentConfigId: analystId },
      status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
      closedAt: null,
    };
  } else {
    // Daily-run, principal-chat, etc.: full analyst book.
    thesisWhereScope = {
      researchRun: { agentConfigId: analystId },
      status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
      closedAt: null,
    };
  }
  const theses = (await prisma.thesis.findMany({
    where: thesisWhereScope,
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      triggers: true,
      createdAt: true,
      nextReviewAt: true,
      paperTenureDays: true,
      paperRealizedPnl: true,
      paperReviewCount: true,
      promotedAt: true,
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

  // P1-14: anchor TIME_ELAPSED to the paired open position's openedAt for
  // ACTIVE rows, so the gate doesn't flag a 0-day-old position's "max hold"
  // trigger as unaddressed work just because the thesis row is old.
  const activeOpenedAtTickers = Array.from(
    new Set(
      theses
        .filter((t) => t.status === "HOLDING")
        .map((t) => t.ticker),
    ),
  );
  const positionOpenedAtByTicker = new Map<string, Date>();
  if (activeOpenedAtTickers.length > 0) {
    try {
      const openPositions = await prisma.position.findMany({
        where: {
          analystId,
          symbol: { in: activeOpenedAtTickers },
          status: "OPEN",
        },
        select: { symbol: true, openedAt: true },
        orderBy: { openedAt: "desc" },
      });
      for (const p of openPositions) {
        if (!positionOpenedAtByTicker.has(p.symbol)) {
          positionOpenedAtByTicker.set(p.symbol, p.openedAt);
        }
      }
    } catch (err) {
      console.warn(
        "[complete_run] open-position openedAt lookup failed; TIME_ELAPSED falls back to createdAt:",
        err,
      );
    }
  }

  const pendingEntryTickers = await getPendingEntryTickers(analystId);
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
        direction: t.direction,
        status: t.status,
        triggers: (t.triggers as unknown as Trigger[]) ?? [],
        createdAt: t.createdAt,
        nextReviewAt: t.nextReviewAt,
        positionOpenedAt:
          t.status === "HOLDING"
            ? positionOpenedAtByTicker.get(t.ticker) ?? null
            : null,
        paperTenureDays: t.paperTenureDays ?? null,
        paperRealizedPnl:
          t.paperRealizedPnl != null ? Number(t.paperRealizedPnl) : null,
        paperReviewCount: t.paperReviewCount ?? null,
        promotedAt: t.promotedAt ?? null,
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
      hasPendingEntryProposal: pendingEntryTickers.has(t.ticker),
    });
    if (needsAction == null) continue;
    let detail: string;
    if (needsAction.kind === "PROMOTED_AWAITING_RESOLUTION") {
      const ctxBits: string[] = [];
      if (needsAction.paperTenureDays != null) {
        ctxBits.push(`held ${needsAction.paperTenureDays}d in paper`);
      }
      if (needsAction.paperRealizedPnl != null) {
        ctxBits.push(
          `${needsAction.paperRealizedPnl >= 0 ? "+" : ""}$${needsAction.paperRealizedPnl.toFixed(2)} paper P&L`,
        );
      }
      if (needsAction.paperReviewCount != null) {
        ctxBits.push(`${needsAction.paperReviewCount} reviews`);
      }
      const ctx = ctxBits.length > 0 ? ` (${ctxBits.join(", ")})` : "";
      detail = `PROMOTED — must resolve today${ctx}: call place_trade to re-enter live OR update_thesis(change_status: "WATCHING") to defer`;
    } else if (needsAction.kind === "TRIGGER_FIRED") {
      detail = `trigger fired: ${needsAction.action} (${needsAction.summary})`;
    } else if (needsAction.kind === "TRIGGER_MATCHING_NOW") {
      detail = `predicate matching now: ${needsAction.action} (${needsAction.predicateSummary}${needsAction.livePrice != null ? ` @ $${needsAction.livePrice.toFixed(2)}` : ""})`;
    } else if (needsAction.kind === "RUNNING_WINNER") {
      // Defensive branch. This preflight intentionally does NOT feed
      // avgCost/targetPrice into computeNeedsAction, so RUNNING_WINNER does
      // not fire here at runtime — it's a get_theses attention nudge, not a
      // complete_run hard gate in this PR (SCALE_INTO_WINNERS.md PR3;
      // enforcement is a deliberate follow-up). Handled for type-completeness.
      const prog = needsAction.pastTarget
        ? "past target"
        : `${Math.round(needsAction.progressToTarget * 100)}% to target`;
      detail = `running winner (+${needsAction.unrealizedGainPct.toFixed(1)}%, ${prog}): press / hold / take`;
    } else if (needsAction.kind === "UNPROTECTED_GAIN") {
      // Defensive branch, same contract as RUNNING_WINNER above: this
      // preflight does NOT feed avgCost/peakPrice into computeNeedsAction,
      // so UNPROTECTED_GAIN cannot fire here at runtime — it's a get_theses
      // attention flag; enforcement as a run-close gate is PR-C (warn-mode
      // first, per THESIS_GAME_PLAN.md). Handled for type-completeness.
      const floorTxt =
        needsAction.flooredGainPct != null
          ? `${needsAction.flooredGainPct >= 0 ? "+" : ""}${needsAction.flooredGainPct.toFixed(1)}%`
          : "nothing";
      detail = `unprotected gain (+${needsAction.unrealizedGainPct.toFixed(1)}% but floor locks ${floorTxt}): raise the floor`;
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
  // Distinguish PROMOTED-only refusals — they're the most common
  // first-live-day case and the agent benefits from a clearer hint.
  const promotedCount = unaddressed.filter(
    (u) => u.kind === "PROMOTED_AWAITING_RESOLUTION",
  ).length;
  const totalCount = unaddressed.length;
  const headline =
    promotedCount === totalCount
      ? `${totalCount} PROMOTED thesis${totalCount > 1 ? "es" : ""} need a status-changing decision`
      : `${totalCount} thesis${totalCount > 1 ? "es" : ""} need action`;
  return {
    kind: "unaddressed_theses",
    shortReason: headline,
    message:
      `complete_run refused: ${totalCount} live thesis${totalCount > 1 ? "es" : ""} ` +
      `${totalCount > 1 ? "are" : "is"} flagged needsAction but no status-changing tool call was made for ` +
      `${totalCount > 1 ? "them" : "it"} in this run. ` +
      `For PROMOTED rows: call place_trade to re-enter live, or update_thesis(change_status: "WATCHING") to defer. ` +
      `For HOLDING/WATCHING rows: call update_thesis with the action result (or change_status="INVALIDATED" if no longer applicable, or rationale-only REVIEW). ` +
      `Then call complete_run again. Unaddressed: ${summary}`,
  };
}

// ─── Narration → execution gate (P0-12, end-of-run) ─────────────────────────
// Layer-1 soft refusal. Previously fired inside record_run_summary and marked
// the run FAILED on the first record_run_summary call. That punished agents
// that self-corrected — production 2026-05-22 Secular Theme narrated "EXIT
// SMTC" in the rationale, gate marked the run FAILED, then the agent actually
// called close_position 90 seconds later and closed SMTC for +$108.10. Run
// stayed FAILED forever despite a real successful close.
//
// Moving the check to complete_run preflight means: agent calls
// record_run_summary (no gate), gets reminded to call missing tool via
// complete_run's refusal, calls it, complete_run preflight passes the second
// attempt because the position_closed event now exists. Self-correction is
// the default path, not a permanent FAIL.

type RankedPickReasoning = { ticker?: unknown; reasoning?: unknown };
type RunSummaryPayload = {
  decision_rationale?: unknown;
  ranked_picks?: unknown;
};

async function checkNarrationExecutionGap(
  runId: string,
): Promise<PreflightFailure | null> {
  try {
    // Use the MOST RECENT run_summary event — the agent may have called
    // record_run_summary multiple times during the run and only the latest
    // reflects current intent.
    const summaryEvent = await prisma.runEvent.findFirst({
      where: { runId, type: "run_summary" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    if (!summaryEvent?.payload) return null;
    const payload = summaryEvent.payload as RunSummaryPayload;
    const decisionRationale =
      typeof payload.decision_rationale === "string"
        ? payload.decision_rationale
        : "";
    const rankedPicks: RankedPickReasoning[] = Array.isArray(payload.ranked_picks)
      ? (payload.ranked_picks as RankedPickReasoning[])
      : [];

    const knownTickers = new Set<string>();
    for (const p of rankedPicks) {
      if (typeof p.ticker === "string" && p.ticker.length > 0) {
        knownTickers.add(p.ticker.toUpperCase());
      }
    }
    if (knownTickers.size === 0 && !decisionRationale) return null;

    const hits: NarrationHit[] = [];
    if (decisionRationale) {
      hits.push(
        ...detectNarrationHits(
          decisionRationale,
          "rationale",
          undefined,
          knownTickers,
        ),
      );
    }
    for (const p of rankedPicks) {
      if (typeof p.reasoning !== "string" || !p.reasoning) continue;
      const ticker = typeof p.ticker === "string" ? p.ticker : undefined;
      hits.push(
        ...detectNarrationHits(p.reasoning, "pick_reasoning", ticker, knownTickers),
      );
    }
    if (hits.length === 0) return null;

    // Tool-call events for the entire run — gives credit for post-narration
    // close_position / manage_position calls (the production 5/22 case).
    const events = await prisma.runEvent.findMany({
      where: {
        runId,
        type: { in: ["position_closed", "position_modified"] },
      },
      select: { type: true, payload: true },
    });
    const toolEvents: ToolCallEvent[] = [];
    for (const e of events) {
      const p =
        e.payload && typeof e.payload === "object"
          ? (e.payload as Record<string, unknown>)
          : {};
      const symbol = String(p.symbol ?? p.ticker ?? "").toUpperCase();
      if (symbol) toolEvents.push({ type: e.type, symbol });
    }
    const gaps = findGaps(hits, toolEvents);
    if (gaps.length === 0) return null;

    const gapList = gaps
      .map(
        (g) =>
          `${g.ticker} narrated ${g.expectedTool} ("${g.verb}") with no tool call`,
      )
      .join("; ");
    return {
      kind: "narration_execution_gap",
      shortReason: `${gaps.length} narrated action${gaps.length > 1 ? "s" : ""} missing tool call`,
      message:
        `complete_run refused: ${gaps.length} ticker${gaps.length > 1 ? "s" : ""} narrated an action in record_run_summary without firing the matching tool (${gapList}). ` +
        `Call the missing tool now (close_position / manage_position), then call complete_run again. ` +
        `If the prose was wrong (you didn't actually intend to take that action), revise record_run_summary with corrected rationale and reasoning, then complete_run again.`,
    };
  } catch (err) {
    // Gate failure must never break complete_run. Fall through to the next
    // preflight (or to the happy-path COMPLETE transition).
    console.warn(
      `[tool] complete_run narration gap check error (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
