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
import { prisma } from "@/lib/prisma";
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
    // ── onFailure handler — last-chance cleanup ─────────────────────────
    // Fires when Inngest has exhausted retries. The runThesisWriterAgent
    // inner try/catch covers synchronous errors, but production observed
    // a failure mode where the function returns to Inngest cleanly without
    // any of the agent's console.logs firing and without marking the
    // ResearchRun terminal — runs sit in RUNNING for hours until the
    // /runs/[id] stale-detect catches them. We can't catch THAT case in
    // the function body itself (the function "succeeded" from Inngest's
    // POV). But Inngest's onFailure DOES fire on real failures (thrown
    // errors propagating past step boundaries), so this closes the
    // synchronous-throw hole. The periodic sweep cron
    // (sweep-stuck-runs.ts) catches the rest.
    onFailure: async ({ event, error }) => {
      const data = (event as { data?: { event?: { data?: ThesisWriteRequestedPayload } } })
        .data?.event?.data;
      const childRunId = data?.childRunId;
      const ticker = data?.ticker ?? "?";
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[thesis-writer:onFailure] childRun=${childRunId} ticker=${ticker} error="${msg.slice(0, 200)}"`,
      );
      if (!childRunId) return;
      try {
        const fresh = await prisma.researchRun.findUnique({
          where: { id: childRunId },
          select: { parameters: true },
        });
        await prisma.researchRun.updateMany({
          where: { id: childRunId, status: "RUNNING" },
          data: { status: "FAILED", completedAt: new Date() },
        });
        await prisma.researchRun.update({
          where: { id: childRunId },
          data: {
            parameters: {
              ...((fresh?.parameters as object) ?? {}),
              error: `Inngest onFailure: ${msg.slice(0, 500)}`,
              failedAt: new Date().toISOString(),
              inngestOnFailure: true,
            } as object,
          },
        });
      } catch (cleanupErr) {
        console.error(
          `[thesis-writer:onFailure] cleanup failed for childRun=${childRunId}:`,
          cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
        );
      }
    },
  },
  { event: "app/thesis.write.requested" },
  async ({ event, step }) => {
    const t0 = Date.now();
    console.log(
      `[thesis-writer:inngest] EVENT received childRun=${(event.data as Partial<ThesisWriteRequestedPayload>).childRunId} ticker=${(event.data as Partial<ThesisWriteRequestedPayload>).ticker}`,
    );
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

    console.log(
      `[thesis-writer:inngest] DONE childRun=${args.childRunId} status=${result.status} thesisId=${result.thesisId ?? "null"} elapsedMs=${Date.now() - t0}`,
    );
    return result;
  },
);
