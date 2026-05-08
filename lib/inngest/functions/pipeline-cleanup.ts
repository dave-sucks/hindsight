// ── Pipeline Cleanup ─────────────────────────────────────────────────────────
// Runs daily at 11 PM ET. Three jobs:
//   1. Archive AnalystSignalRoute rows older than 24 hours (status -> ARCHIVED)
//      so today's inbox stays uncluttered without losing the historical paper
//      trail. Routes are queried by status IN ("PENDING", "READ"), so flipping
//      to ARCHIVED is enough to remove them from active queries — no need to
//      delete the row.
//   2. Soft-delete Signal rows older than 30 days. We tombstone via deletedAt
//      rather than hard-delete because Theses retain sourceSignalIds for
//      historical attribution (a trade closed last quarter still references
//      the signals that informed it). Active read paths filter deletedAt IS
//      NULL; lookups by id still resolve.
//   3. Disable dead SEARCH monitors — `enabled: false` on SEARCH monitors
//      where lastRunAt > 30 days ago AND tradesSourced = 0. We keep the row
//      (Signals reference it via FK), but the firm-market-sweep cron skips
//      disabled monitors so the bloated stable goes quiet on its own. Hard
//      delete is unsafe — it would break the Monitor ROI tracer's chain
//      walk for any historical signal still cited by an open thesis.
//
// Scope rationale:
//   - 24h on routes: the morning brief and read_signals queries already scope
//     by tradingDay = today, so older routes are invisible. Archiving makes
//     that explicit and lets future operator dashboards distinguish
//     "routed to inbox today" from "historical routing record."
//   - 30d on signals: long enough that any open thesis citing them is still
//     within typical hold window; short enough that the Signal table doesn't
//     accumulate forever. Theses citing >30d signals can still resolve
//     against the soft-deleted row.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { etTradingDayDate } from "@/lib/market-hours"

const SIGNAL_SOFT_DELETE_AGE_DAYS = 30
const SEARCH_MONITOR_DEAD_AGE_DAYS = 30

export const pipelineCleanup = inngest.createFunction(
  {
    id: "pipeline-cleanup",
    name: "Pipeline Cleanup (archive routes, soft-delete signals)",
    concurrency: { limit: 1 },
    retries: 2,
  },
  [
    // 11 PM ET daily — after the trading day is closed and EOD jobs (Phase 4)
    // would have run, before tomorrow's 6:30 AM intelligence sweep.
    { cron: "TZ=America/New_York 0 23 * * *" },
    // Manual trigger for backfills / debug.
    { event: "app/pipeline.cleanup.manual" },
  ],
  async ({ step }) => {
    // ── Step 1: archive stale routes ─────────────────────────────────────────
    // Match the invariant the rest of the pipeline holds: today's brief and
    // read_signals scope by tradingDay = today. Archive everything whose
    // tradingDay is strictly before today (or null + routedAt before today,
    // for legacy rows that predate Phase 1's tradingDay field).
    const archivedRoutes = await step.run("archive-stale-routes", async () => {
      const today = etTradingDayDate()
      const result = await prisma.analystSignalRoute.updateMany({
        where: {
          status: { in: ["PENDING", "READ"] },
          OR: [
            { tradingDay: { lt: today } },
            { tradingDay: null, routedAt: { lt: today } },
          ],
        },
        data: { status: "ARCHIVED" },
      })
      return { archived: result.count, cutoffTradingDay: today.toISOString() }
    })

    // ── Step 2: soft-delete aged signals ─────────────────────────────────────
    const softDeleted = await step.run("soft-delete-aged-signals", async () => {
      const cutoff = new Date(
        Date.now() - SIGNAL_SOFT_DELETE_AGE_DAYS * 24 * 60 * 60 * 1000,
      )
      const result = await prisma.signal.updateMany({
        where: {
          createdAt: { lt: cutoff },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      })
      return { softDeleted: result.count, cutoffIso: cutoff.toISOString() }
    })

    // ── Step 3: disable dead SEARCH monitors ─────────────────────────────────
    // Bounded scope: SEARCH only (the only monitor type with user-defined
    // queries that go stale when an analyst is edited). API monitors are
    // built-in and shouldn't be auto-disabled. Domain/email monitors have
    // their own lifecycle. Skip already-disabled rows so the count reflects
    // net new disables this run.
    const disabledMonitors = await step.run("disable-dead-search-monitors", async () => {
      const cutoff = new Date(
        Date.now() - SEARCH_MONITOR_DEAD_AGE_DAYS * 24 * 60 * 60 * 1000,
      )
      const result = await prisma.monitor.updateMany({
        where: {
          type: "SEARCH",
          enabled: true,
          tradesSourced: 0,
          OR: [
            { lastRunAt: null },
            { lastRunAt: { lt: cutoff } },
          ],
        },
        data: { enabled: false },
      })
      return { disabled: result.count, cutoffIso: cutoff.toISOString() }
    })

    return {
      success: true,
      routes: archivedRoutes,
      signals: softDeleted,
      monitors: disabledMonitors,
    }
  },
)
