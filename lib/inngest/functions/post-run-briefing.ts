import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";

/**
 * Post-run briefing agent — runs as an independent Inngest function.
 *
 * Listens to "research/run.completed" events fired by:
 * - complete_run tool (agent marks run COMPLETE)
 * - morning-research cron (belt-and-suspenders COMPLETE marking)
 * - agent route onFinish (streaming runs)
 *
 * This ensures the briefing always runs in its own execution context
 * with its own timeout and retries, regardless of how the research
 * agent finished (normally, timed out, or crashed).
 */
export const postRunBriefing = inngest.createFunction(
  {
    id: "post-run-briefing",
    name: "Post-Run Briefing Agent",
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: "research/run.completed" },
  async ({ event, step }) => {
    const { runId, analystId, userId } = event.data as {
      runId: string;
      analystId: string;
      userId: string;
    };

    // Step 1: Verify run is COMPLETE and no briefing exists yet
    const shouldRun = await step.run("verify-run", async () => {
      const [run, existingBriefing] = await Promise.all([
        prisma.researchRun.findUnique({
          where: { id: runId },
          select: { status: true },
        }),
        prisma.analystBriefing.findFirst({
          where: { runId },
          select: { id: true },
        }),
      ]);

      if (run?.status !== "COMPLETE") {
        console.warn(`[post-run-briefing] Run ${runId} is not COMPLETE (status=${run?.status}), skipping`);
        return false;
      }

      if (existingBriefing) {
        console.log(`[post-run-briefing] Briefing already exists for run ${runId}, skipping`);
        return false;
      }

      return true;
    });

    if (!shouldRun) {
      return { runId, skipped: true };
    }

    // Step 2: Generate briefing (retryable independently)
    await step.run("generate-briefing", async () => {
      console.log(`[post-run-briefing] Generating briefing for run ${runId} analyst=${analystId}`);
      await updateAnalystBriefing({ analystId, runId, userId });
      console.log(`[post-run-briefing] ✅ Briefing written for run ${runId}`);
    });

    return { runId, analystId, success: true };
  }
);
