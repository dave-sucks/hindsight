// ── Housekeeping: Overdue Thesis Reviews ─────────────────────────────────
// Runs hourly during US market hours. Surfaces every ACTIVE / WATCHING
// thesis whose `nextReviewAt` is in the past so the next morning Daily
// Run picks it up as a priority review.
//
// Why this exists: the trigger-evaluator's cron path already evaluates
// REVIEW_DATE_HIT predicates, BUT only if the thesis carries one in its
// triggers[] array. New WATCHING theses get one for free via the
// horizon-aware watching templates, and held templates (TARGET / TRADE
// / CATALYST / COMPOUNDER) carry TIME_ELAPSED hygiene predicates keyed
// off `thesis.createdAt` rather than the agent-managed `nextReviewAt`.
// Result: an ACTIVE thesis whose agent updated `nextReviewAt` to a
// custom cadence, or a legacy thesis that pre-dates the REVIEW_DATE_HIT
// templating, can sit overdue forever with nothing checking on it.
//
// This cron is the safety net. It writes one ThesisUpdate(TRIGGER_FIRED)
// per overdue thesis with a stable synthetic triggerId, which surfaces
// in `triggersFiredSinceLastRun` on the next Daily Run for the analyst
// — guaranteed to land in the prompt's "Triggers Fired Since Your Last
// Run" priority block.
//
// We deliberately do NOT emit `app/thesis.trigger.fired` here. Spawning
// a tactical-run for every overdue compounder/target on every hourly
// tick would be expensive AND tactical-run can't look up a synthetic
// triggerId in the thesis's triggers[] JSON. The morning daily-run is
// the right cadence for an overdue scheduled review; intraday triggers
// keep handling intraday reactivity.
//
// Cooldown: per-thesis, 24h. We check for an existing TRIGGER_FIRED row
// with our synthetic triggerId in the last 24h and skip if present.
// Without this, every hourly tick would re-write the same row for the
// same overdue thesis until the agent finally got to it.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

/** Stable synthetic triggerId. Used to detect prior firings for cooldown. */
export const OVERDUE_REVIEW_TRIGGER_ID = "__OVERDUE_REVIEW__";

const COOLDOWN_HOURS = 24;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

export const housekeepingOverdueTheses = inngest.createFunction(
  {
    id: "housekeeping-overdue-theses",
    name: "Housekeeping — Overdue Thesis Reviews",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    // Hourly, US market hours, weekdays. Cheaper than the trigger
    // evaluator's 5-min cadence; an overdue review by definition is
    // something that wasn't caught the moment its date arrived, so a
    // few hours of latency on the safety net is acceptable.
    { cron: "TZ=America/New_York 0 9-16 * * 1-5" },
    // Manual trigger for ops / debug.
    { event: "app/housekeeping.overdue.manual" },
  ],
  async ({ step }) => {
    const result = await step.run("scan-and-fire", async () => {
      const now = new Date();
      const cooldownCutoff = new Date(now.getTime() - COOLDOWN_MS);

      // Pull every overdue ACTIVE/WATCHING thesis owned by an analyst.
      // status filter is critical — terminal theses (INVALIDATED/CLOSED/
      // SUPERSEDED) shouldn't fire reviews.
      const overdueTheses = await prisma.thesis.findMany({
        where: {
          status: { in: ["ACTIVE", "WATCHING"] },
          closedAt: null,
          nextReviewAt: { lt: now, not: null },
          // The thesis must belong to an analyst (we can't surface a
          // review for an orphan thesis; nothing reads it).
          researchRun: { agentConfigId: { not: null } },
        },
        select: {
          id: true,
          ticker: true,
          status: true,
          nextReviewAt: true,
          targetPrice: true,
          researchRun: { select: { agentConfigId: true } },
        },
      });

      if (overdueTheses.length === 0) {
        return { scanned: 0, fired: 0, cooldownSkipped: 0 };
      }

      // Cooldown check — pull every recent TRIGGER_FIRED with our
      // synthetic id for these theses in one query, then bucket.
      const thesisIds = overdueTheses.map(
        (t: { id: string }) => t.id,
      );
      const recentFirings = await prisma.thesisUpdate.findMany({
        where: {
          thesisId: { in: thesisIds },
          type: "TRIGGER_FIRED",
          triggerId: OVERDUE_REVIEW_TRIGGER_ID,
          timestamp: { gte: cooldownCutoff },
        },
        select: { thesisId: true },
      });
      const onCooldown = new Set(
        recentFirings.map((r: { thesisId: string }) => r.thesisId),
      );

      let fired = 0;
      let cooldownSkipped = 0;

      for (const thesis of overdueTheses) {
        if (onCooldown.has(thesis.id)) {
          cooldownSkipped++;
          continue;
        }

        const overdueDays = thesis.nextReviewAt
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() - thesis.nextReviewAt.getTime()) /
                  86_400_000,
              ),
            )
          : 0;

        const summary =
          overdueDays > 0
            ? `Scheduled review overdue by ${overdueDays}d on ${thesis.ticker} (${thesis.status})`
            : `Scheduled review due on ${thesis.ticker} (${thesis.status})`;

        const rationale = `Housekeeping: nextReviewAt was ${thesis.nextReviewAt?.toISOString() ?? "(null)"}, ${overdueDays}d ago. ${
          thesis.status === "WATCHING"
            ? "Walk the watching thesis: re-check the entry trigger, refresh target/stop against today's tape, or remove from watch."
            : "Walk the held thesis: re-evaluate conviction, exit policy, and trigger health against today's data."
        }`;

        const writeResult = await writeThesisUpdate({
          thesisId: thesis.id,
          type: "TRIGGER_FIRED",
          summary,
          rationale,
          triggerId: OVERDUE_REVIEW_TRIGGER_ID,
          // No runId — this fires from a cron, not inside a research run.
          // The next Daily Run for this analyst is what consumes the row
          // via run-input.ts triggersFiredSinceLastRun.
          runId: null,
          priceAtTime: null,
        });

        if (writeResult != null) {
          fired++;
        }
      }

      return {
        scanned: overdueTheses.length,
        fired,
        cooldownSkipped,
      };
    });

    return {
      success: true,
      ...result,
    };
  },
);
