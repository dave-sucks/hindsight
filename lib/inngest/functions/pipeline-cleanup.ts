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
//   4. Disable dead-content monitors — analyst-owned SEARCH or DOMAIN
//      monitors that ARE being scheduled (lastRunAt within 14d) but produce
//      ZERO signals (paywalled domains via Sonar, query strings that match
//      nothing, etc.). The 2026-05-10 audit found Intraday Momentum
//      Scalper and Secular Theme Architect with 0/4 working DOMAIN
//      monitors each — all 4 targeting paywall sites (Bloomberg, Barrons,
//      Stratechery, The Information / Benzinga, Cheddar Flow, Finviz,
//      StockCharts) that Sonar's domain-filtered search can't extract
//      structured signals from. Step 3's lastRunAt gate misses these
//      because the cron DOES fire daily — the output is empty.
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
// Dead-content detection: "monitor is being scheduled but produces nothing."
// 14d gives us 10 weekday cron-fire opportunities — enough to be confident
// it's the monitor's fault (paywalled domain, dead query) and not just a
// quiet news week.
const DEAD_CONTENT_WINDOW_DAYS = 14

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

    // ── Step 4: disable dead-content monitors ───────────────────────────────
    // Catches a different failure mode from Step 3: the monitor IS being
    // scheduled (lastRunAt is recent — cron fires daily), but the producer
    // returns nothing usable. Common cause is paywalled domains via Sonar's
    // search_domain_filter — Bloomberg, Barrons, Cheddar Flow, etc. The
    // cron logs success, lastRunAt updates, SignalBatch reads signalCount: 0,
    // and the analyst silently goes weeks with zero discovery input.
    //
    // Gate is conservative:
    //   • Scoped to ANALYST monitors (firm/podcast monitors have their own
    //     lifecycle and may legitimately be quiet between events).
    //   • Skip builtIn (Portfolio/Watchlist ticker monitors fire per-ticker
    //     and have their own emptiness invariants).
    //   • Require lastRunAt within 14d — we KNOW the cron is reaching this
    //     monitor; an unseen monitor goes to Step 3.
    //   • Require 0 signals in the same 14d window — actual output, not
    //     scheduling status.
    //   • Require tradesSourced=0 — never produced anything that informed
    //     a closed trade. Triple-belt: even if a monitor produced 0 signals
    //     in the last 14d but earned a winning trade earlier, we keep it.
    const disabledDeadContent = await step.run(
      "disable-dead-content-monitors",
      async () => {
        const cutoff = new Date(
          Date.now() - DEAD_CONTENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        )

        // Pull all candidates first so we can attribute the disables and
        // include human-readable details in the cleanup return payload.
        const candidates = await prisma.monitor.findMany({
          where: {
            enabled: true,
            scope: "ANALYST",
            builtIn: false,
            type: { in: ["SEARCH", "DOMAIN"] },
            tradesSourced: 0,
            lastRunAt: { gte: cutoff },
          },
          select: {
            id: true,
            name: true,
            type: true,
            analystId: true,
            lastRunAt: true,
            createdAt: true,
            config: true,
          },
        })

        // For each candidate, count recent signals. Done as a single
        // groupBy to avoid N round-trips.
        const candidateIds = candidates.map((c) => c.id);
        const signalCounts = candidateIds.length === 0
          ? []
          : await prisma.signal.groupBy({
              by: ["monitorId"],
              where: {
                monitorId: { in: candidateIds },
                createdAt: { gte: cutoff },
              },
              _count: { _all: true },
            });
        const countByMonitor = new Map<string, number>(
          signalCounts
            .filter((c) => c.monitorId !== null)
            .map((c) => [c.monitorId as string, c._count._all]),
        );

        // Newly-created monitors haven't had time to produce yet — only
        // count "no signals" against monitors that have been alive for
        // at least one full cron window.
        const minAge = new Date(
          Date.now() - DEAD_CONTENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );

        const toDisable = candidates.filter(
          (m) =>
            (countByMonitor.get(m.id) ?? 0) === 0 && m.createdAt < minAge,
        );

        if (toDisable.length === 0) {
          return { disabled: 0, monitors: [] as Array<{ id: string; name: string; type: string; analystId: string | null }> };
        }

        await prisma.monitor.updateMany({
          where: { id: { in: toDisable.map((m) => m.id) } },
          data: { enabled: false },
        });

        for (const m of toDisable) {
          console.warn(
            `[pipeline-cleanup] disabling dead-content monitor ${m.id} ` +
              `(${m.type} "${m.name}", analyst=${m.analystId}) — ` +
              `0 signals produced in last ${DEAD_CONTENT_WINDOW_DAYS}d ` +
              `despite cron firing.`,
          );
        }

        return {
          disabled: toDisable.length,
          monitors: toDisable.map((m) => ({
            id: m.id,
            name: m.name,
            type: m.type,
            analystId: m.analystId,
          })),
        };
      },
    );

    return {
      success: true,
      routes: archivedRoutes,
      signals: softDeleted,
      monitors: disabledMonitors,
      deadContentMonitors: disabledDeadContent,
    }
  },
)
