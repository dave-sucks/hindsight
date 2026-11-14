/**
 * complete_run — migrated to defineTool().
 *
 * STAGE 6 — final tool call. Marks the run COMPLETE and writes the
 * briefing_generated RunEvent. The per-analyst AnalystBriefing write is
 * DEPRECATED (docs/plans/PORTFOLIO_DIGEST.md); continuity now comes from
 * the account-level PortfolioDigest. briefingStatus stays "skipped".
 */

import { z } from "zod";
import { isProtectiveLine, shapeOf } from "@/lib/agent/triggers/condition";
import { loadStockFacts, type FactsContext } from "@/lib/agent/stock-facts";
import { listsTheStock, situationsFor, SITUATIONS } from "@/lib/agent/situations";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { updateSegmentBriefing } from "@/lib/podcast/update-segment-briefing";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import {
  CREDITED_RUN_EVENT_TYPES,
  findUnbackedActions,
  unbackedActionMessage,
  type ToolCallEvent,
} from "@/lib/agent/summary-action-check";

export const completeRun = defineTool({
  description:
    "Mark the run complete. This is your final tool call. No arguments needed.",
  schema: z.object({}),
  ui: "tool-ui" as const,
  gateLog: "complete_run",

  progressLabel: () => "Wrapping up the run",

  execute: async (_args, ctx) => {
    // DAV-332. The catch below used to mark the run COMPLETE whatever went
    // wrong — including a throw inside the preflight, which meant every
    // obligation it was about to check (unaddressed work, the declared-
    // action check, the ladder warn-gate) was skipped in silence and the
    // run was recorded as clean. The gate with the largest blast radius in
    // the system failed OPEN. This flag is how the catch tells "the checks
    // ran and passed" from "the checks did not run".
    let preflightFinished = false;
    try {
      // ── Preflight gates (GAPS P0-7 + P0-9c) ──────────────────────────
      // Layer-1 rejection: force the agent to address triggered theses and
      // call record_run_summary before the run is allowed to complete.
      // These run BEFORE the RUNNING→COMPLETE transition so the agent sees
      // rejections in-conversation and can recover without the run going
      // terminal. Skip for podcast segments and unscoped runs.
      if (ctx.runId && ctx.analystId && !ctx.podcastSegmentId) {
        const preflightFailure = await runCompleteRunPreflight(ctx.runId, ctx.analystId, ctx.runMode, {
          userId: ctx.userId,
          runEnvironment: ctx.runEnvironment,
          alpacaCreds: ctx.alpacaCreds,
          accountId: ctx.accountId,
          maxOpenPositions: ctx.maxOpenPositions,
        });
        preflightFinished = true;
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
      } else {
        // A podcast segment or an unscoped run owes no checks, so none were
        // skipped: a later throw here completes the run as it always did.
        preflightFinished = true;
      }

      // Atomic: only transition RUNNING → COMPLETE. Was previously
      // `status: { not: "COMPLETE" }`, which clobbered FAILED status set
      // by an upstream gate (or any other
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
            const hasProtectiveExit = ladder.some((t) => {
              const w = shapeOf(t.predicate);
              return t.action === "EXIT" && w != null && isProtectiveLine(w);
            });
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
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error(`[tool] complete_run FAILED:`, msg);
      // Only a run whose checks actually ran may be marked complete here. A
      // throw before that leaves it RUNNING, so the obligations are still
      // owed and the agent can try again in-conversation — the same shape
      // as a preflight refusal, which is what this effectively is.
      if (preflightFinished) {
        try {
          await prisma.researchRun.updateMany({
            where: { id: ctx.runId, status: "RUNNING" },
            data: { status: "COMPLETE", completedAt: new Date() },
          });
        } catch { /* already tried */ }
      } else {
        // Say it on the run, not just in a log line nobody reads.
        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "complete_run_preflight_failed",
              title: "End-of-run checks did not run",
              message: `complete_run threw before its preflight finished, so nothing was checked: ${msg}`,
              payload: { error: msg } as object,
            },
          });
        } catch { /* best effort */ }
      }
      return {
        summary: preflightFinished
          ? `complete_run failed: ${msg}`
          : `complete_run refused: the end-of-run checks could not run (${msg}). The run is still open — try again.`,
        data: {
          ok: false,
          briefing: "skipped" as const,
          briefingError: msg,
          error: msg,
          preflightRan: preflightFinished,
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
    | "declared_action_unbacked"
    | "unaddressed_theses";
  shortReason: string;
  message: string;
};

async function runCompleteRunPreflight(
  runId: string,
  analystId: string,
  runMode?: string,
  /** The run's own scope, the same get_theses reads the book with (stock-facts.ts). */
  work?: Pick<FactsContext, "userId" | "runEnvironment" | "alpacaCreds" | "accountId" | "maxOpenPositions">,
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

  // 2) Did an upstream gate already mark this run FAILED?
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

  // 3) Declared actions with no trade behind them (DAV-309; the check moved
  //    here from record_run_summary in P0-12
  //    on 2026-05-23). Look at the MOST RECENT run_summary event's
  //    ranked picks. A stock we HOLD that the run marked EXIT / REDUCE / ADD
  //    with no matching close, trim or proposal this run refuses, and the
  //    agent is told to make the call or correct the action word.
  //    It reads the one-word action, never the prose — reading English for
  //    it blocked eleven runs that had done the work (DAV-309).
  //    Self-corrected runs (tool called before or after the summary) pass.
  //    Tactical exempt — record_run_summary isn't in its allowlist, so no
  //    run_summary event exists to scan against; the unaddressed_theses
  //    check below is the real backstop for tactical.
  if (!skipSummaryGate) {
    const actionFailure = await checkDeclaredActions(runId, analystId);
    if (actionFailure) return actionFailure;
  }

  // 4) A run owes an answer on exactly the stocks its read listed as work:
  //    get_theses' facts (loadStockFacts) and rule (listsTheStock), nothing of its own.
  // A trigger or writer run is about one stock, so only that stock is in scope.
  const single = runMode === "INTRADAY_TACTICAL" || runMode === "THESIS_WRITER";
  let scopeId: string | null = null;
  if (single) {
    const run = await prisma.researchRun.findUnique({
      where: { id: runId },
      select: { parameters: true },
    });
    scopeId = (run?.parameters as { thesisId?: string } | null)?.thesisId ?? null;
    // A sub-agent run with no thesis named has nothing of its own to answer.
    if (!scopeId) return null;
  }
  // Status is the truth: a stock sold and put back on watch keeps its old closedAt.
  const theses = await prisma.thesis.findMany({
    where: {
      ...(scopeId ? { id: scopeId } : {}),
      researchRun: { agentConfigId: analystId },
      status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
    },
    select: {
      id: true,
      ticker: true,
      status: true,
      direction: true,
      targetPrice: true,
      triggers: true,
      catalystDate: true,
      createdAt: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (theses.length === 0) return null;

  // Any audit row this run except TRIGGER_FIRED answers a stock, a note-only
  // REVIEW included: the analyst's call stands, a declined sale's too.
  const runUpdates = await prisma.thesisUpdate.findMany({
    where: {
      runId,
      thesisId: { in: theses.map((t) => t.id) },
      NOT: { type: "TRIGGER_FIRED" },
    },
    select: { thesisId: true },
  });
  const answered = new Set<string>(runUpdates.map((u: { thesisId: string }) => u.thesisId));

  // One stock counts its analyst's slots from positions, as a read by ticker does.
  const facts = await loadStockFacts(theses, {
    ...work,
    analystId,
    slots: single ? "positions" : "rows",
  });
  // A read that could not see the activity is a failed check, not "nothing fired".
  if (facts.load.activityFailed) throw new Error("complete_run preflight: the activity read failed, so the open fires could not be checked");

  const owed = theses.flatMap((t) => {
    const sources = facts.sources.get(t.id);
    if (!sources || !listsTheStock(sources) || answered.has(t.id)) return [];
    const names = situationsFor(sources).map((c) => SITUATIONS[c].name);
    return [{ id: t.id, ticker: t.ticker, status: t.status, names: names.length > 0 ? names.join(", ") : "on your work list" }];
  });
  if (owed.length === 0) return null;

  const n = owed.length;
  const promoted = owed.some((o) => o.status === "PROMOTED");
  return {
    kind: "unaddressed_theses",
    shortReason: `${n} listed stock${n > 1 ? "s" : ""} unanswered`,
    message:
      `complete_run refused: your read listed ${n === 1 ? "this stock" : `these ${n} stocks`} as work and this run has not answered ${n === 1 ? "it" : "them"}. ` +
      owed.map((o) => `${o.ticker} (${o.id}): ${o.names}`).join("; ") +
      `. Answer each with update_thesis (a note-only review counts)` +
      (promoted ? `; a promoted stock is re-entered with place_trade or deferred with change_status "WATCHING"` : "") +
      `, then call complete_run again.`,
  };
}

// ─── Declared actions vs what the run did (DAV-309, end-of-run) ────────────
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

async function checkDeclaredActions(
  runId: string,
  analystId: string,
): Promise<PreflightFailure | null> {
  try {
    // The MOST RECENT run_summary — the agent may have called
    // record_run_summary more than once and only the latest is its intent.
    const summaryEvent = await prisma.runEvent.findFirst({
      where: { runId, type: "run_summary" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    if (!summaryEvent?.payload) return null;
    const payload = summaryEvent.payload as { ranked_picks?: unknown };

    // Only a stock we hold can be exited, trimmed or added to.
    const held = await prisma.position.findMany({
      where: { analystId, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
      select: { symbol: true },
    });

    // What actually happened, from the ORDER — the durable record. Run events
    // are not one: `position_closed` has not been written since 2026-08-01
    // (105 close orders in that window, zero events), which is why the old
    // prose gate refused runs that really had sold (SRRK 2026-09-14).
    // AWAITING_APPROVAL counts — a LIVE sale is a proposal Dave approves.
    const run = await prisma.researchRun.findUnique({
      where: { id: runId },
      select: { startedAt: true },
    });
    const orders = await prisma.order.findMany({
      where: {
        intent: { in: ["CLOSE", "PARTIAL_CLOSE", "ADD"] },
        status: { notIn: ["REJECTED", "CANCELLED", "EXPIRED"] },
        ...(run?.startedAt ? { createdAt: { gte: run.startedAt } } : {}),
        position: { analystId },
      },
      select: { symbol: true, intent: true },
    });

    // Run events too, where they were written — the proposal path does, and
    // reading both costs nothing. A call made AFTER the summary still counts
    // (the 2026-05-22 self-correction case).
    const events = await prisma.runEvent.findMany({
      where: { runId, type: { in: CREDITED_RUN_EVENT_TYPES } },
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

    const gaps = findUnbackedActions({
      picks: payload.ranked_picks,
      heldTickers: held.map((h) => h.symbol),
      orders,
      events: toolEvents,
    });
    if (gaps.length === 0) return null;

    return {
      kind: "declared_action_unbacked",
      shortReason: `${gaps.length} declared action${gaps.length > 1 ? "s" : ""} with no trade behind ${gaps.length > 1 ? "them" : "it"}`,
      message: `complete_run refused: ${unbackedActionMessage(gaps)}`,
    };
  } catch (err) {
    // Gate failure must never break complete_run. Fall through to the next
    // preflight (or to the happy-path COMPLETE transition).
    console.warn(
      `[tool] complete_run declared-action check error (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// Re-export for tests that exercise the preflight directly without
// standing up a full run.
export const __test__ = { runCompleteRunPreflight };
