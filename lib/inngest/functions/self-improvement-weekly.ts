/**
 * Weekly self-improvement pass.
 *
 * Runs Sundays 11 AM ET. For each enabled analyst:
 *   1. Load last 30d of briefings + runs + closed trades + current config
 *      + recent theses + SEARCH monitors the user/builder already set up.
 *   2. Load suppression hints (what the user has been dismissing lately).
 *   3. GPT-4o generates a batch of Suggestion proposals against a strict
 *      Zod schema — see lib/suggestions/types.ts.
 *   4. Dedupe against existing PENDING suggestions (same dedupeKey).
 *   5. Dedupe against suppression hints (user-dismissed within 60d).
 *   6. Write new PENDING rows with expiresAt = now + 14d.
 *   7. Expire any PENDING older than 14d by flipping status to EXPIRED.
 *
 * Non-goals (documented in SELF_IMPROVEMENT_HANDOFF.md):
 * - Auto-apply. Every Suggestion is PENDING until the user clicks Approve.
 * - Cross-analyst suggestions — one analyst's learnings don't leak into
 *   another's queue.
 * - Per-run reactions — weekly cadence, pattern requires ≥ 3 runs or
 *   ≥ 3 closed trades.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  suggestionBatchSchema,
  buildDedupeKey,
  type SuggestionProposal,
} from "@/lib/suggestions/types";
import { loadSuppressionHints } from "@/lib/suggestions/suppression";

const LOOKBACK_DAYS = 30;
const PROPOSAL_TTL_DAYS = 14;
const MIN_SIGNAL_THRESHOLD = 3; // ≥ 3 runs OR ≥ 3 closed trades

// ─── Input loading ───────────────────────────────────────────────────────────

async function loadAnalystContext(analystId: string) {
  const windowStart = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const [config, briefings, runs, closedPositions, openPositions, recentTheses, userMonitors] =
    await Promise.all([
      prisma.agentConfig.findUniqueOrThrow({ where: { id: analystId } }),

      prisma.analystBriefing.findMany({
        where: { analystId, createdAt: { gte: windowStart } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          narrative: true,
          strategyNotes: true,
          marketPosture: true,
          watchTomorrow: true,
          unresolvedItems: true,
          selfCorrections: true,
        },
      }),

      prisma.researchRun.findMany({
        where: {
          agentConfigId: analystId,
          startedAt: { gte: windowStart },
          status: "COMPLETE",
        },
        orderBy: { startedAt: "desc" },
        take: 30,
        select: {
          id: true,
          startedAt: true,
          _count: { select: { theses: true, decisions: true } },
        },
      }),

      prisma.position.findMany({
        where: {
          analystId,
          status: "CLOSED",
          closedAt: { gte: windowStart },
        },
        orderBy: { closedAt: "desc" },
        take: 50,
        select: {
          id: true,
          symbol: true,
          direction: true,
          avgCost: true,
          closePrice: true,
          quantity: true,
          realizedPnl: true,
          outcome: true,
          closeReason: true,
          openedAt: true,
          closedAt: true,
        },
      }),

      prisma.position.findMany({
        where: { analystId, status: "OPEN" },
        select: { symbol: true, direction: true, avgCost: true, quantity: true },
      }),

      prisma.thesis.findMany({
        where: {
          researchRun: { agentConfigId: analystId },
          createdAt: { gte: windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          ticker: true,
          direction: true,
          confidenceScore: true,
          signalTypes: true,
          createdAt: true,
        },
      }),

      // USER + BUILDER SEARCH monitors — the things the user can approve
      // removing via INTELLIGENCE_QUERY_REMOVE. We never propose touching
      // BRIEFING_AGENT-origin rows (they're deprecated) or builtIn ones.
      prisma.monitor.findMany({
        where: {
          analystId,
          type: "SEARCH",
          origin: { in: ["USER", "BUILDER"] },
          builtIn: false,
        },
        select: {
          id: true,
          name: true,
          category: true,
          config: true,
          enabled: true,
          createdAt: true,
        },
      }),
    ]);

  return {
    config,
    briefings,
    runs,
    closedPositions,
    openPositions,
    recentTheses,
    userMonitors,
  };
}

// ─── Prompt assembly ─────────────────────────────────────────────────────────

interface AnalystContext {
  config: { name: string; analystPrompt: string | null; sectors: string[]; industries: string[]; themes: string[]; watchlist: string[]; exclusionList: string[] };
  briefings: Array<{
    id: string;
    createdAt: Date;
    narrative: string;
    strategyNotes: string | null;
    marketPosture: string | null;
    watchTomorrow: unknown;
    unresolvedItems: unknown;
    selfCorrections: unknown;
  }>;
  runs: Array<{ id: string; startedAt: Date; _count: { theses: number; decisions: number } }>;
  closedPositions: Array<{
    id: string;
    symbol: string;
    direction: string;
    avgCost: number;
    closePrice: number | null;
    quantity: number;
    realizedPnl: number | null;
    outcome: string | null;
    closeReason: string | null;
    openedAt: Date;
    closedAt: Date | null;
  }>;
  openPositions: Array<{ symbol: string; direction: string; avgCost: number; quantity: number }>;
  recentTheses: Array<{ ticker: string; direction: string; confidenceScore: number; signalTypes: string[]; createdAt: Date }>;
  userMonitors: Array<{ id: string; name: string; category: string; config: unknown; enabled: boolean; createdAt: Date }>;
}

function buildPrompt(
  ctx: AnalystContext,
  suppression: Awaited<ReturnType<typeof loadSuppressionHints>>,
): string {
  const { config, briefings, runs, closedPositions, openPositions, recentTheses, userMonitors } = ctx;

  const wins = closedPositions.filter((p) => p.outcome === "WIN").length;
  const losses = closedPositions.filter((p) => p.outcome === "LOSS").length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;
  const totalPnl = closedPositions.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);

  // Per-ticker aggregates: repeated losers are strong EXCLUSION_ADD signal;
  // repeated misses in theses without trades are WATCHLIST_ADD material.
  const tickerStats = new Map<
    string,
    { wins: number; losses: number; pnl: number; thesisCount: number }
  >();
  for (const p of closedPositions) {
    const entry = tickerStats.get(p.symbol) ?? { wins: 0, losses: 0, pnl: 0, thesisCount: 0 };
    if (p.outcome === "WIN") entry.wins += 1;
    else if (p.outcome === "LOSS") entry.losses += 1;
    entry.pnl += p.realizedPnl ?? 0;
    tickerStats.set(p.symbol, entry);
  }
  for (const t of recentTheses) {
    const entry = tickerStats.get(t.ticker) ?? { wins: 0, losses: 0, pnl: 0, thesisCount: 0 };
    entry.thesisCount += 1;
    tickerStats.set(t.ticker, entry);
  }

  const tickerStatsText = Array.from(tickerStats.entries())
    .map(
      ([ticker, s]) =>
        `  ${ticker}: ${s.wins}W / ${s.losses}L, ${s.pnl >= 0 ? "+" : ""}$${s.pnl.toFixed(0)} realized, ${s.thesisCount} theses`,
    )
    .join("\n");

  const briefingsText = briefings
    .slice(0, 8)
    .map((b) => {
      const date = b.createdAt.toISOString().slice(0, 10);
      const wt = Array.isArray(b.watchTomorrow) ? `watch: ${JSON.stringify(b.watchTomorrow).slice(0, 200)}` : "";
      const ur = Array.isArray(b.unresolvedItems) ? `unresolved: ${JSON.stringify(b.unresolvedItems).slice(0, 200)}` : "";
      const sc = Array.isArray(b.selfCorrections) ? `self-corrections: ${JSON.stringify(b.selfCorrections).slice(0, 200)}` : "";
      return `## Briefing ${date} (id=${b.id})\nposture: ${b.marketPosture ?? "—"}\nstrategy: ${b.strategyNotes?.slice(0, 300) ?? "—"}\n${wt}\n${ur}\n${sc}\nnarrative: ${b.narrative.slice(0, 500)}`;
    })
    .join("\n\n");

  const closedPositionsText = closedPositions
    .slice(0, 30)
    .map((p) => {
      const pnl = p.realizedPnl ?? 0;
      return `  ${p.outcome ?? "?"} ${p.symbol} ${p.direction} @ $${p.avgCost.toFixed(2)} → $${(p.closePrice ?? 0).toFixed(2)} (${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}, ${p.closeReason ?? "?"}) id=${p.id}`;
    })
    .join("\n");

  const monitorsText =
    userMonitors.length > 0
      ? userMonitors
          .map((m) => {
            const q = (m.config as { query?: string } | null)?.query ?? m.name;
            return `  id=${m.id} cat=${m.category} ${m.enabled ? "[on]" : "[off]"} "${q}"`;
          })
          .join("\n")
      : "  (none)";

  const suppressionText =
    suppression.dismissalSummary.length > 0
      ? suppression.dismissalSummary
          .map(
            (d) =>
              `  ${d.kind}: ${d.count} dismissed (${Object.entries(d.reasons)
                .map(([k, v]) => `${k}:${v}`)
                .join(", ")}); examples: ${d.examples
                .map((e) => `"${e.title.slice(0, 80)}" [${e.reason ?? "—"}${e.note ? ` — ${e.note.slice(0, 60)}` : ""}]`)
                .join(" | ")}`,
          )
          .join("\n")
      : "  (none)";

  return `You are the self-improvement reviewer for AI analyst "${config.name}". Your job is to propose specific, evidence-backed edits the user can approve in UI. Every proposal must cite a concrete pattern across ≥ 3 runs, ≥ 3 trades, or ≥ 3 briefings.

## Ground rules (non-negotiable)

1. NO per-ticker SEARCH queries. The portfolio-watchlist monitor already runs per-ticker Sonar for every held + watchlist ticker. INTELLIGENCE_QUERY_ADD proposals must be THEMATIC, SECTOR-wide, EVENT-scoped, or MARKET-wide — never "news about \$NVDA".
2. NO market-level sweep duplicates. firm-market-sweep already runs daily macro queries. INTELLIGENCE_QUERY_ADD must fill a GAP the briefings explicitly flag as unmet (e.g. "Fed rate decision reaction" surfaced 3x in unresolvedItems with no monitor catching it).
3. Single-run reactions are noise. If a pattern only shows up once, do not propose.
4. You MAY return 0 suggestions. Do not pad with weak proposals.
5. Hard cap: 6 proposals per run. Pick the highest-signal.
6. Dismissal history below shows the user's recent rejections. If they've dismissed 3+ WATCHLIST_ADD in a row, raise the bar for a new one — cite stronger evidence or skip.

## Current analyst config

- Prompt: ${config.analystPrompt?.slice(0, 1200) ?? "(none)"}
- Sectors: ${config.sectors.join(", ") || "—"}
- Industries: ${config.industries.join(", ") || "—"}
- Themes: ${config.themes.join(", ") || "—"}
- Watchlist: ${config.watchlist.join(", ") || "—"}
- Exclusions: ${config.exclusionList.join(", ") || "—"}

## Run summary (last ${LOOKBACK_DAYS}d)

- Completed runs: ${runs.length}
- Closed positions: ${closedPositions.length} (${wins}W / ${losses}L, win rate ${winRate == null ? "N/A" : `${winRate.toFixed(0)}%`}, total P&L ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)})
- Open positions: ${openPositions.map((p) => `${p.symbol}`).join(", ") || "—"}

## Per-ticker stats (closed + theses)
${tickerStatsText || "  (no ticker activity)"}

## Closed positions
${closedPositionsText || "  (none closed in window)"}

## Recent briefings (most recent first)
${briefingsText || "(no briefings in window)"}

## User / builder intelligence queries on file
${monitorsText}

## User's recent dismissals (last 60d — do not re-propose these)
${suppressionText}

## Output

Return a batch of suggestions. For each:
- kind must match proposedDiff.kind exactly
- title: one-line card header (no markdown, no code fences)
- rationale: 2-3 sentences, MUST name specific tickers / P&L numbers / dates from the data above
- evidence.patternSummary: 1 sentence — the pattern you're reacting to
- evidence.runIds / tradeIds / briefingIds: the source IDs from the data above
- evidence.dataPoints: 2-5 short chips the UI shows (e.g. "\$XYZ LOSS -$180")
- sourceRunId: single most relevant run ID, or empty string if not run-derived
- proposedDiff: the structured change

Schema validation is strict. marketCapMin / price filters etc. do NOT belong here — those are Builder/Editor territory.`;
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

async function persistSuggestions(
  analystId: string,
  userId: string,
  proposals: SuggestionProposal[],
  suppression: Awaited<ReturnType<typeof loadSuppressionHints>>,
): Promise<{ written: number; skippedDuplicate: number; skippedSuppressed: number }> {
  if (proposals.length === 0) {
    return { written: 0, skippedDuplicate: 0, skippedSuppressed: 0 };
  }

  // Fetch existing PENDING dedupe keys for this analyst so we only block
  // against currently-open proposals (EXPIRED / APPROVED / DISMISSED are
  // handled separately — expired = OK to re-propose, approved = already
  // applied, dismissed = suppression logic above handles it).
  const openRows = await prisma.suggestion.findMany({
    where: { analystId, status: { in: ["PENDING", "SNOOZED"] } },
    select: { dedupeKey: true },
  });
  const openKeys = new Set(openRows.map((r) => r.dedupeKey));

  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_DAYS * 86_400_000);

  let written = 0;
  let skippedDuplicate = 0;
  let skippedSuppressed = 0;

  for (const proposal of proposals) {
    const dedupeKey = buildDedupeKey(proposal.proposedDiff.kind, proposal.proposedDiff);

    if (openKeys.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    if (suppression.blockedDedupeKeys.has(dedupeKey)) {
      skippedSuppressed += 1;
      continue;
    }

    await prisma.suggestion.create({
      data: {
        analystId,
        userId,
        kind: proposal.proposedDiff.kind,
        dedupeKey,
        title: proposal.title,
        rationale: proposal.rationale,
        evidence: proposal.evidence as object,
        proposedDiff: proposal.proposedDiff as object,
        sourceRunId: proposal.sourceRunId ? proposal.sourceRunId : null,
        expiresAt,
        status: "PENDING",
      },
    });
    written += 1;
    openKeys.add(dedupeKey);
  }

  return { written, skippedDuplicate, skippedSuppressed };
}

async function expireStale(): Promise<number> {
  const now = new Date();
  const { count } = await prisma.suggestion.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED", resolvedAt: now },
  });
  return count;
}

// ─── Inngest function ────────────────────────────────────────────────────────

export const selfImprovementWeekly = inngest.createFunction(
  {
    id: "self-improvement-weekly",
    name: "Weekly Self-Improvement Pass",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 0 11 * * 0" }, // Sunday 11:00 AM ET
    { event: "analyst/self-improvement.run" },
  ],
  async ({ step, event }) => {
    // ── Step 0: expire stale PENDING rows first so counters are clean ──────
    const expiredCount = await step.run("expire-stale", expireStale);

    // ── Step 1: pick analysts ──────────────────────────────────────────────
    // Event payload { analystId } allows a single-analyst manual trigger for
    // testing; cron hits all enabled analysts.
    const targetAnalystId = (event?.data as { analystId?: string } | undefined)?.analystId;

    const analysts = await step.run("load-analysts", async () => {
      return prisma.agentConfig.findMany({
        where: targetAnalystId ? { id: targetAnalystId } : { enabled: true },
        select: { id: true, name: true, userId: true },
      });
    });

    if (analysts.length === 0) {
      return { expiredCount, analysts: 0, reason: "no-enabled-analysts" };
    }

    const perAnalyst: Array<{
      analystId: string;
      name: string;
      status: "ok" | "skipped" | "failed";
      written?: number;
      skippedDuplicate?: number;
      skippedSuppressed?: number;
      reason?: string;
    }> = [];

    for (const analyst of analysts) {
      const result = await step.run(`generate-${analyst.id}`, async () => {
        try {
          const ctx = await loadAnalystContext(analyst.id);

          // Gate: ≥ 3 runs OR ≥ 3 closed trades in window. A brand-new
          // analyst with 1 run and no trades won't have enough signal to
          // propose against — defer until next week.
          if (ctx.runs.length < MIN_SIGNAL_THRESHOLD && ctx.closedPositions.length < MIN_SIGNAL_THRESHOLD) {
            return {
              analystId: analyst.id,
              name: analyst.name,
              status: "skipped" as const,
              reason: "insufficient-signal",
            };
          }

          const suppression = await loadSuppressionHints(analyst.id);
          const prompt = buildPrompt(ctx as AnalystContext, suppression);

          const { object } = await generateObject({
            model: openai("gpt-4o"),
            schema: suggestionBatchSchema,
            prompt,
          });

          const { written, skippedDuplicate, skippedSuppressed } = await persistSuggestions(
            analyst.id,
            analyst.userId,
            object.suggestions,
            suppression,
          );

          return {
            analystId: analyst.id,
            name: analyst.name,
            status: "ok" as const,
            written,
            skippedDuplicate,
            skippedSuppressed,
          };
        } catch (err) {
          console.error(
            `[self-improvement] failed for analyst ${analyst.id} (${analyst.name}):`,
            err instanceof Error ? err.message : err,
          );
          return {
            analystId: analyst.id,
            name: analyst.name,
            status: "failed" as const,
            reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
          };
        }
      });

      perAnalyst.push(result);
    }

    const totalWritten = perAnalyst.reduce((s, r) => s + (r.written ?? 0), 0);

    return {
      expiredCount,
      analystsProcessed: analysts.length,
      totalWritten,
      perAnalyst,
    };
  },
);
