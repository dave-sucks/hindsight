// ── Firm Market Intelligence Sweep ──────────────────────────────────────────
// Runs daily at 6:30 AM ET before analyst runs.
// Executes all firm-level IntelligenceQuery rows via Perplexity Sonar.
// Writes signals to the Signal table for downstream routing.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { searchSignals } from "@/lib/intelligence/sonar"
import {
  createSignalBatch,
  createSignalsFromSonar,
  completeSignalBatch,
  deduplicateSignals,
} from "@/lib/intelligence/signals"
import type { SignalType } from "@/lib/intelligence/types"

// Map query categories to signal types
const CATEGORY_TO_SIGNAL_TYPE: Record<string, SignalType> = {
  MARKET: "MACRO",
  SECTOR: "SECTOR",
  TICKER: "NEWS",
  THEMATIC: "NEWS",
  EVENT: "EARNINGS",
}

export const firmMarketSweep = inngest.createFunction(
  {
    id: "firm-market-sweep",
    name: "Firm Market Intelligence Sweep",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 30 6 * * 1-5" },
    { event: "intelligence/market-sweep" },
  ],
  async ({ step }) => {
    // ── Step 1: Load enabled firm-level queries ────────────────────────────

    const queries = await step.run("load-firm-queries", async () => {
      const now = new Date()
      return prisma.intelligenceQuery.findMany({
        where: {
          scope: "FIRM",
          enabled: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        orderBy: { createdAt: "asc" },
      })
    })

    if (queries.length === 0) {
      return { ran: 0, reason: "no-firm-queries" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("MARKET_SWEEP")
    })

    // ── Step 3: Execute queries via Sonar (sequential to respect rate limits)

    let totalSignals = 0
    let queriesRun = 0
    let queriesFailed = 0

    for (const query of queries) {
      const result = await step.run(`search-${query.id}`, async () => {
        try {
          const sonarResponse = await searchSignals(query.query, {
            recency: "day",
            model: "sonar",
          })

          const signalType = CATEGORY_TO_SIGNAL_TYPE[query.category] ?? "NEWS"
          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            signalType
          )

          return { success: true, signalCount: signalIds.length }
        } catch (error) {
          console.error(
            `[firm-sweep] Query "${query.query}" failed:`,
            error instanceof Error ? error.message : error
          )
          return { success: false, signalCount: 0 }
        }
      })

      if (result.success) {
        totalSignals += result.signalCount
        queriesRun++
      } else {
        queriesFailed++
      }
    }

    // ── Step 4: Deduplicate signals ────────────────────────────────────────

    const dupsRemoved = await step.run("deduplicate", async () => {
      return deduplicateSignals(batchId)
    })

    // ── Step 5: Complete batch ─────────────────────────────────────────────

    await step.run("complete-batch", async () => {
      await completeSignalBatch(batchId)
    })

    // ── Step 6: Expire old temporary queries ──────────────────────────────

    await step.run("expire-temp-queries", async () => {
      const now = new Date()
      const expired = await prisma.intelligenceQuery.updateMany({
        where: {
          expiresAt: { lte: now },
          enabled: true,
        },
        data: { enabled: false },
      })
      return expired.count
    })

    return {
      batchId,
      queriesTotal: queries.length,
      queriesRun,
      queriesFailed,
      signalsCreated: totalSignals,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
