// ── Source Pack Monitor ──────────────────────────────────────────────────────
// Runs daily at 7:15 AM ET after portfolio monitor.
// For each active source pack (firm + analyst), checks tracked domains for
// new content via domain-filtered Sonar searches.
// High-value pages get full extraction via Firecrawl.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { searchDomain } from "@/lib/intelligence/sonar"
import { extractPage } from "@/lib/intelligence/firecrawl"
import {
  createSignalBatch,
  createSignalsFromSonar,
  completeSignalBatch,
  deduplicateSignals,
  computeContentHash,
} from "@/lib/intelligence/signals"

export const sourcePackMonitor = inngest.createFunction(
  {
    id: "source-pack-monitor",
    name: "Source Pack Monitor",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 15 7 * * 1-5" },
    { event: "intelligence/source-pack-monitor" },
  ],
  async ({ step }) => {
    // ── Step 1: Load all active source packs with their sources ───────────

    const packs = await step.run("load-source-packs", async () => {
      return prisma.sourcePack.findMany({
        include: {
          sources: {
            include: { source: true },
            orderBy: { priority: "asc" },
          },
        },
      })
    })

    if (packs.length === 0) {
      return { ran: 0, reason: "no-source-packs" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("SOURCE_PACK")
    })

    // ── Step 3: Process each pack ──────────────────────────────────────────

    let totalSignals = 0
    let sourcesChecked = 0
    let artifactsCreated = 0

    for (const pack of packs) {
      // Group sources by domain for batch searching
      const enabledSources = pack.sources
        .filter((sps) => sps.source.enabled && sps.source.domain)

      if (enabledSources.length === 0) continue

      // Search all domains in this pack together
      const domains = enabledSources.map((sps) => sps.source.domain!).filter(Boolean)

      const result = await step.run(`search-pack-${pack.id}`, async () => {
        try {
          // Search across all domains in the pack
          const query = `latest news analysis developments today from financial markets investing`
          const sonarResponse = await searchDomain(query, domains, "day")

          // Average quality score from pack sources
          const avgQuality = Math.round(
            enabledSources.reduce((sum, s) => sum + s.source.qualityScore, 0) /
              enabledSources.length
          )

          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            "NEWS",
            avgQuality
          )

          // Update lastCheckedAt for all sources in this pack
          const sourceIds = enabledSources.map((s) => s.source.id)
          await prisma.source.updateMany({
            where: { id: { in: sourceIds } },
            data: { lastCheckedAt: new Date() },
          })

          return {
            success: true,
            signalCount: signalIds.length,
            sourcesChecked: enabledSources.length,
          }
        } catch (error) {
          console.error(
            `[source-pack] Pack "${pack.name}" search failed:`,
            error instanceof Error ? error.message : error
          )
          return { success: false, signalCount: 0, sourcesChecked: 0 }
        }
      })

      totalSignals += result.signalCount
      sourcesChecked += result.sourcesChecked

      // For high-priority sources (priority 1), try to extract full pages
      // from the signals we just found
      const criticalSources = enabledSources.filter((s) => s.priority === 1)
      if (criticalSources.length > 0) {
        const extractResult = await step.run(`extract-pack-${pack.id}`, async () => {
          try {
            // Get signals we just created that have source URLs from critical domains
            const criticalDomains = new Set(
              criticalSources.map((s) => s.source.domain!).filter(Boolean)
            )

            const recentSignals = await prisma.signal.findMany({
              where: { batchId },
              select: { sourceUrls: true },
            })

            // Collect URLs from critical domains
            const urlsToExtract: string[] = []
            for (const signal of recentSignals) {
              for (const url of signal.sourceUrls) {
                try {
                  const domain = new URL(url).hostname.replace(/^www\./, "")
                  if (criticalDomains.has(domain) && urlsToExtract.length < 5) {
                    urlsToExtract.push(url)
                  }
                } catch {
                  // Invalid URL, skip
                }
              }
            }

            // Extract and create artifacts
            let created = 0
            for (const url of urlsToExtract) {
              try {
                const page = await extractPage(url)
                const contentHash = computeContentHash(page.title, page.markdown.slice(0, 500))

                // Check if artifact already exists
                const existing = await prisma.artifact.findFirst({
                  where: { contentHash },
                })
                if (existing) continue

                await prisma.artifact.create({
                  data: {
                    url: page.url,
                    title: page.title,
                    contentMarkdown: page.markdown,
                    contentSummary: page.markdown.slice(0, 300),
                    contentHash,
                    publishedAt: page.publishedAt ? new Date(page.publishedAt) : null,
                  },
                })
                created++
              } catch (error) {
                console.warn(
                  `[source-pack] Extract failed for ${url}:`,
                  error instanceof Error ? error.message : error
                )
              }
            }

            return { artifactsCreated: created }
          } catch {
            return { artifactsCreated: 0 }
          }
        })

        artifactsCreated += extractResult.artifactsCreated
      }
    }

    // ── Step 4: Deduplicate ────────────────────────────────────────────────

    const dupsRemoved = await step.run("deduplicate", async () => {
      return deduplicateSignals(batchId)
    })

    // ── Step 5: Complete batch ─────────────────────────────────────────────

    await step.run("complete-batch", async () => {
      await completeSignalBatch(batchId)
    })

    return {
      batchId,
      packsProcessed: packs.length,
      sourcesChecked,
      signalsCreated: totalSignals,
      artifactsCreated,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
