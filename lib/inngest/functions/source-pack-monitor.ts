// ── Source Pack Monitor ──────────────────────────────────────────────────────
// Runs daily at 7:15 AM ET after portfolio monitor.
// For each enabled DOMAIN monitor, checks tracked domains for new content
// via domain-filtered Sonar searches.
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
    // ── Step 1: Load enabled DOMAIN monitors ─────────────────────────────

    const monitors = await step.run("load-domain-monitors", async () => {
      const now = new Date()
      return prisma.monitor.findMany({
        where: {
          type: "DOMAIN",
          enabled: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        orderBy: { createdAt: "asc" },
      })
    })

    if (monitors.length === 0) {
      return { ran: 0, reason: "no-domain-monitors" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("SOURCE_PACK")
    })

    // ── Step 3: Group domain monitors and process ─────────────────────────

    let totalSignals = 0
    let monitorsProcessed = 0
    let artifactsCreated = 0

    // Group monitors by scope+analystId so related domains are searched together
    const monitorGroups = new Map<string, typeof monitors>()
    for (const monitor of monitors) {
      const groupKey = monitor.analystId
        ? `analyst:${monitor.analystId}`
        : `firm:${monitor.scope}`
      const group = monitorGroups.get(groupKey) ?? []
      group.push(monitor)
      monitorGroups.set(groupKey, group)
    }

    for (const [groupKey, groupMonitors] of monitorGroups) {
      // Extract domains from monitor configs
      const monitorDomains: Array<{ monitor: typeof monitors[0]; domain: string; qualityScore: number; priority: number }> = []
      for (const monitor of groupMonitors) {
        const config = monitor.config as Record<string, unknown> | null
        const domain = (config?.domain as string) ?? ""
        const qualityScore = (config?.qualityScore as number) ?? 3
        const priority = (config?.priority as number) ?? 5
        if (domain) {
          monitorDomains.push({ monitor, domain, qualityScore, priority })
        }
      }

      if (monitorDomains.length === 0) continue

      const domains = monitorDomains.map((md) => md.domain)

      const result = await step.run(`search-group-${groupKey}`, async () => {
        try {
          // Search across all domains in the group
          const query = `latest news analysis developments today from financial markets investing`
          const sonarResponse = await searchDomain(query, domains, "day")

          // Average quality score from monitors in this group
          const avgQuality = Math.round(
            monitorDomains.reduce((sum, md) => sum + md.qualityScore, 0) /
              monitorDomains.length
          )

          // Use the first monitor's ID as the primary monitorId for these signals
          // (signals are grouped by domain search, individual monitor attribution
          // is tracked via searchContext)
          const primaryMonitorId = groupMonitors[0].id

          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            "NEWS",
            avgQuality,
            {
              searchTool: "PERPLEXITY_SONAR",
              searchQuery: query,
              searchContext: `domain_group:${groupKey}:${domains.join(",")}`,
              monitorId: primaryMonitorId,
            }
          )

          // Update lastRunAt for all monitors in this group
          const monitorIds = groupMonitors.map((m) => m.id)
          await prisma.monitor.updateMany({
            where: { id: { in: monitorIds } },
            data: { lastRunAt: new Date() },
          })

          return {
            success: true,
            signalCount: signalIds.length,
            monitorsProcessed: groupMonitors.length,
          }
        } catch (error) {
          console.error(
            `[source-pack] Domain group "${groupKey}" search failed:`,
            error instanceof Error ? error.message : error
          )
          return { success: false, signalCount: 0, monitorsProcessed: 0 }
        }
      })

      totalSignals += result.signalCount
      monitorsProcessed += result.monitorsProcessed

      // For high-priority monitors (priority 1), try to extract full pages
      const criticalMonitors = monitorDomains.filter((md) => md.priority === 1)
      if (criticalMonitors.length > 0) {
        const extractResult = await step.run(`extract-group-${groupKey}`, async () => {
          try {
            const criticalDomains = new Set(
              criticalMonitors.map((md) => md.domain)
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
      monitorsTotal: monitors.length,
      monitorsProcessed,
      signalsCreated: totalSignals,
      artifactsCreated,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
