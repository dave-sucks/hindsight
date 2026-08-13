/**
 * thesis-writer Inngest function — consumes `app/thesis.write.requested`
 * (emitted by dispatch_thesis_research / promote-analyst) and drives the
 * V2 single-agent thesis-writer pipeline for one ticker.
 *
 * THESIS_WRITER_V2: the pipeline runs as REAL Inngest steps — pull /
 * research / persist — instead of V1's single 333-760s step. That single
 * step was long enough for Inngest to abandon the HTTP request and
 * re-invoke the function, silently re-running the entire agent (double
 * Anthropic spend, spurious "timed out" errors stamped onto COMPLETE
 * runs — see the idempotency-guard note in run-thesis-writer.ts). With
 * step boundaries, a retry replays completed phases from memo and re-runs
 * only the phase that was in flight. Phases never throw — failures are
 * contained in the phase output so the persist step always runs and every
 * run leaves a replayable thread + events.
 *
 * Emits `app/thesis.written` on completion so waiters can
 * step.waitForEvent. See docs/plans/THESIS_WRITER_V2.md.
 */

import { inngest } from "@/lib/inngest/client";
import {
  writerIdempotencyCheck,
  writerPullPhase,
  writerResearchPhase,
  writerPersistPhase,
  type RunThesisWriterArgs,
  type RunThesisWriterResult,
  type WriterPullPhaseOutput,
  type WriterResearchPhaseOutput,
} from "@/lib/agent/run-thesis-writer";

interface ThesisWriteRequestedPayload {
  childRunId: string;
  ticker: string;
  analystId: string;
  mode: "mint" | "refresh";
  existingThesisId?: string | null;
  reason: string;
  parentRunId?: string | null;
  /**
   * Layer-1 clamp: when true, record_thesis downgrades any
   * LONG/SHORT/ACTIVE mint request to LONG/SHORT/WATCHING. Set by
   * dispatch_thesis_research for chat-dispatched mints so chat
   * exploration doesn't accidentally produce trade-eligible coverage.
   */
  forceWatchingMint?: boolean;
  /**
   * PAPER→LIVE promotion framing. Auto-populated by
   * dispatch_thesis_research when refreshing a PROMOTED thesis. Frames
   * the research prompt's decision block around RE-ENTER / DEFER / KILL.
   */
  promotionContext?: {
    paperTenureDays: number | null;
    paperRealizedPnl: number | null;
    paperReviewCount: number | null;
    promotedAt: string | null;
  } | null;
}

export const thesisWriter = inngest.createFunction(
  {
    id: "thesis-writer",
    name: "Thesis Writer (sub-agent)",
    // Cap fan-out. Discovery spawns ~5 per analyst; concurrency:5 keeps
    // FMP/Finnhub/SEC rate limits sane and the Anthropic per-org budget
    // bounded.
    concurrency: { limit: 5 },
    retries: 1,
  },
  { event: "app/thesis.write.requested" },
  async ({ event, step }) => {
    const payload = event.data as Partial<ThesisWriteRequestedPayload>;
    if (
      !payload.childRunId ||
      !payload.ticker ||
      !payload.analystId ||
      !payload.mode ||
      !payload.reason
    ) {
      return { skipped: "missing-payload", payload };
    }
    if (payload.mode === "refresh" && !payload.existingThesisId) {
      return { skipped: "refresh-without-thesis-id", payload };
    }

    const t0 = Date.now();
    const args: RunThesisWriterArgs = {
      childRunId: payload.childRunId,
      analystId: payload.analystId,
      ticker: payload.ticker,
      mode: payload.mode,
      existingThesisId: payload.existingThesisId ?? null,
      reason: payload.reason,
      parentRunId: payload.parentRunId ?? null,
      forceWatchingMint: payload.forceWatchingMint === true,
      promotionContext: payload.promotionContext ?? null,
    };

    // Cheap COMPLETE short-circuit for full-function retries (PR #383).
    const idempotent = await step.run("idempotency-check", () =>
      writerIdempotencyCheck(args),
    );

    const result: RunThesisWriterResult = idempotent
      ? (idempotent as RunThesisWriterResult)
      : await (async () => {
          const pullOutput = (await step.run("pull-data", () =>
            writerPullPhase(args),
          )) as WriterPullPhaseOutput;

          const research = (await step.run("research", () =>
            writerResearchPhase(args, pullOutput),
          )) as WriterResearchPhaseOutput;

          return (await step.run("persist-finalize", () =>
            writerPersistPhase(args, pullOutput, research, t0),
          )) as RunThesisWriterResult;
        })();

    // Emit completion event so waiters can step.waitForEvent on
    // (childRunId, parentRunId). Best-effort — result already lives
    // durably on the ResearchRun row + Thesis.
    await step.run("emit-thesis-written", async () => {
      await inngest.send({
        name: "app/thesis.written",
        data: {
          childRunId: args.childRunId,
          parentRunId: args.parentRunId ?? null,
          ticker: args.ticker,
          analystId: args.analystId,
          mode: args.mode,
          status: result.status,
          thesisId: result.thesisId,
          steps: result.steps,
          toolCalls: result.toolCalls,
          elapsedMs: result.elapsedMs,
          error: result.error ?? null,
        },
      });
    });

    return result;
  },
);
