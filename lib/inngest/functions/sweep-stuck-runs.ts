/**
 * sweep-stuck-runs — every 5 minutes, mark any ResearchRun that's been
 * stuck in RUNNING longer than its mode's expected duration as FAILED.
 *
 * Why this exists: 2026-05-19 production incident — a thesis-writer run
 * (cmpctyf5m) returned to Inngest cleanly without firing any of the
 * agent's console.logs and without marking the row terminal. Sat in
 * RUNNING for 3h+ until the /runs/[id] page-level stale-detect caught
 * it. Whatever caused that silent return (cold start? edge timeout?
 * Inngest step memoization quirk?), the row needed an out-of-band
 * cleanup.
 *
 * morning-research has an in-function sweep step that handles its own
 * cron's stale rows, but every OTHER mode — INTRADAY_TACTICAL,
 * DISCOVERY, THESIS_WRITER, PRINCIPAL_CHAT — only gets cleaned when a
 * user navigates to the run-detail page. That's a UX hole.
 *
 * Per-mode thresholds (max-duration + buffer):
 *   THESIS_WRITER      — 360s (5 min cap + 60s buffer)
 *   INTRADAY_TACTICAL  — 300s (240s cap + 60s buffer)
 *   DISCOVERY          — 330s (270s cap + 60s buffer)
 *   PRINCIPAL_CHAT     — 24h (chat sessions stay RUNNING by design; only
 *                              sweep genuinely-abandoned ones)
 *   MORNING_PLAN       — 860s (800s cap + 60s buffer) — backstop for the
 *                              in-function sweep
 *
 * Runs every 5 minutes. Cheap query (indexed on status). No-op when
 * nothing's stuck.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";

interface ModeThreshold {
  mode: string;
  thresholdMs: number;
  reason: string;
}

const THRESHOLDS: ModeThreshold[] = [
  {
    mode: "THESIS_WRITER",
    thresholdMs: 6 * 60 * 1000, // 6 min (300s cap + buffer)
    reason: "Thesis-writer run exceeded 6-minute ceiling — likely silent function-kill (Anthropic rate limit, Vercel timeout, or Inngest step memoization). See lib/inngest/functions/sweep-stuck-runs.ts.",
  },
  {
    mode: "INTRADAY_TACTICAL",
    thresholdMs: 5 * 60 * 1000, // 5 min (240s cap + buffer)
    reason: "Tactical run exceeded 5-minute ceiling — silent function-kill.",
  },
  {
    mode: "DISCOVERY",
    thresholdMs: 5.5 * 60 * 1000, // 5m 30s (270s cap + buffer)
    reason: "Discovery run exceeded 5.5-minute ceiling — silent function-kill.",
  },
  {
    mode: "MORNING_PLAN",
    thresholdMs: 14.5 * 60 * 1000, // 14m 30s (800s cap + buffer). morning-research has its own sweep too; this is the backstop.
    reason: "Morning run exceeded 14.5-minute ceiling — silent function-kill (backstop to morning-research's own sweep).",
  },
  {
    mode: "PRINCIPAL_CHAT",
    thresholdMs: 24 * 60 * 60 * 1000, // 24h — chat sessions stay RUNNING by design; only sweep abandoned ones
    reason: "Principal Chat session abandoned (>24h in RUNNING).",
  },
];

export const sweepStuckRuns = inngest.createFunction(
  {
    id: "sweep-stuck-runs",
    name: "Sweep stuck RUNNING runs (safety net)",
    retries: 0,
  },
  // Every 5 minutes, all day. Cheap query.
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const swept = await step.run("sweep", async () => {
      const results: Array<{ mode: string; count: number; ids: string[] }> = [];

      for (const { mode, thresholdMs, reason } of THRESHOLDS) {
        const cutoff = new Date(Date.now() - thresholdMs);

        // Find stuck rows first so we can log the IDs + write `error` on
        // parameters. updateMany alone wouldn't let us enrich parameters.
        const stuckIds = (
          await prisma.researchRun.findMany({
            where: {
              mode,
              status: "RUNNING",
              startedAt: { lt: cutoff },
            },
            select: { id: true },
            take: 50, // Cap per-mode per-tick. If >50 are stuck, something's badly wrong; the next tick will pick up more.
          })
        ).map((r) => r.id);

        if (stuckIds.length === 0) {
          results.push({ mode, count: 0, ids: [] });
          continue;
        }

        // Enrich parameters with the sweep reason, then flip status. The
        // .updateMany on status guards against races where some other code
        // path raced us to mark the run terminal.
        for (const id of stuckIds) {
          try {
            const fresh = await prisma.researchRun.findUnique({
              where: { id },
              select: { parameters: true, status: true, startedAt: true },
            });
            if (!fresh || fresh.status !== "RUNNING") continue;
            const ageSec = Math.round(
              (Date.now() - fresh.startedAt.getTime()) / 1000,
            );
            await prisma.researchRun.updateMany({
              where: { id, status: "RUNNING" },
              data: { status: "FAILED", completedAt: new Date() },
            });
            await prisma.researchRun.update({
              where: { id },
              data: {
                parameters: {
                  ...((fresh.parameters as object) ?? {}),
                  error: `${reason} (age ${ageSec}s)`,
                  failedAt: new Date().toISOString(),
                  sweptByCron: true,
                } as object,
              },
            });
          } catch (err) {
            console.error(
              `[sweep-stuck-runs] failed to sweep ${id} (mode=${mode}):`,
              err instanceof Error ? err.message : err,
            );
          }
        }

        results.push({ mode, count: stuckIds.length, ids: stuckIds });
        if (stuckIds.length > 0) {
          console.warn(
            `[sweep-stuck-runs] mode=${mode} swept ${stuckIds.length} stuck run(s): ${stuckIds.join(", ")}`,
          );
        }
      }

      return results;
    });

    const totalSwept = swept.reduce((sum, r) => sum + r.count, 0);
    if (totalSwept > 0) {
      console.log(
        `[sweep-stuck-runs] tick complete — ${totalSwept} run(s) swept across ${swept.filter((r) => r.count > 0).length} mode(s)`,
      );
    }
    return { totalSwept, byMode: swept };
  },
);
