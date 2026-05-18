/**
 * thesis-writer Inngest function — consumes `app/thesis.write.requested`
 * (emitted by dispatch_thesis_research) and drives one focused sub-agent
 * that produces a deep-research thesis on one ticker.
 *
 * Pattern mirrors lib/inngest/functions/tactical-run.ts: thin Inngest
 * wrapper, the actual agent loop lives in lib/agent/run-thesis-writer.ts.
 * Emits `app/thesis.written` on completion so waiters (Phase 3 daily run
 * promote-to-active) can step.waitForEvent.
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §6.
 */

import { inngest } from "@/lib/inngest/client";
import { runThesisWriterAgent } from "@/lib/agent/run-thesis-writer";

interface ThesisWriteRequestedPayload {
  childRunId: string;
  ticker: string;
  analystId: string;
  mode: "mint" | "refresh";
  existingThesisId?: string | null;
  reason: string;
  parentRunId?: string | null;
}

export const thesisWriter = inngest.createFunction(
  {
    id: "thesis-writer",
    name: "Thesis Writer (sub-agent)",
    // Cap fan-out. Discovery (Phase 2) will spawn ~5 per analyst; with
    // 6 analysts that's 30 dispatches every Sunday. concurrency:5 keeps
    // FMP/Finnhub/SEC rate limits sane and the Anthropic per-org budget
    // bounded. Tune up after the Phase-2 rollout shows the real shape.
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
    const args = payload as ThesisWriteRequestedPayload;

    const result = await step.run("run-thesis-writer", () =>
      runThesisWriterAgent({
        childRunId: args.childRunId,
        analystId: args.analystId,
        ticker: args.ticker,
        mode: args.mode,
        existingThesisId: args.existingThesisId ?? null,
        reason: args.reason,
        parentRunId: args.parentRunId ?? null,
      }),
    );

    // Emit completion event so waiters (Phase 3 daily-run staleness gate)
    // can step.waitForEvent on (childRunId, parentRunId). Best-effort —
    // result already lives durably on the ResearchRun row + Thesis.
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
