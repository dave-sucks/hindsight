"use server";

/**
 * Podcast feature — server actions for Podcast / PodcastSegment /
 * SegmentTranscript / Episode CRUD plus run-kicking.
 *
 * Mirrors the shape of lib/actions/analyst.actions.ts. Tagged
 * PODCAST-NEW in docs/PODCAST_FILES.md. See docs/PODCAST_PLAN.md.
 */

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { SuggestedPodcastConfig } from "@/lib/agent/tools/suggest-podcast-config";

// ── Shared types ────────────────────────────────────────────────────────────

export interface PodcastListItem {
  id: string;
  name: string;
  description: string | null;
  hostStyle: string | null;
  cadence: string | null;
  enabled: boolean;
  segmentCount: number;
  episodeCount: number;
  lastRunAt: Date | null;
  createdAt: Date;
}

// Domain + search monitor row shapes — mirror what AnalystConfigForm reads
// off `domainMonitors` and `searchMonitors` from getAnalystDetail. Same Monitor
// table, just split by Monitor.type for the UI.
export interface SegmentDomainMonitorView {
  id: string;
  name: string;
  domain: string;
  category: string;
  qualityScore: number;
}

export interface SegmentSearchMonitorView {
  id: string;
  name: string;
  query: string;
  category: string;
}

export interface SegmentSummary {
  id: string;
  name: string;
  description: string | null;
  segmentPrompt: string;
  targetSeconds: number;
  topics: string[];
  excludeTopics: string[];
  enabled: boolean;
  orderIndex: number;
  lastRunAt: Date | null;
  lastTranscriptTitle: string | null;
  transcriptCount: number;
  // Monitors split by type, mirror analyst (domainMonitors / searchMonitors).
  // Both are Monitor rows scoped to this segment via podcastSegmentId.
  domainMonitors: SegmentDomainMonitorView[];
  searchMonitors: SegmentSearchMonitorView[];
}

export interface PodcastDetail {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  hostStyle: string | null;
  voiceId: string | null;
  cadence: string | null;
  coverArtUrl: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  segments: SegmentSummary[];
}

export interface SegmentRunRow {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  transcriptId: string | null;
  transcriptTitle: string | null;
  durationSec: number | null;
  citationCount: number;
}

// Removed: SegmentDetail / getSegmentDetail.
// Segments don't have a dedicated page — they live as rows on the podcast
// detail page. The SegmentConfigSheet operates on SegmentSummary (carried
// inline by getPodcastDetail) so editing is zero-fetch.

// ── Helpers ─────────────────────────────────────────────────────────────────

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function getPodcastList(): Promise<PodcastListItem[]> {
  const user = await requireUser();
  const podcasts = await prisma.podcast.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      segments: { select: { id: true } },
      episodes: { select: { id: true } },
    },
  });
  if (podcasts.length === 0) return [];

  // One round trip for the most recent run per podcast (via segment).
  const segmentIds = podcasts.flatMap((p) => p.segments.map((s) => s.id));
  const lastRuns = segmentIds.length
    ? await prisma.researchRun.findMany({
        where: { podcastSegmentId: { in: segmentIds } },
        orderBy: { startedAt: "desc" },
        select: { podcastSegmentId: true, startedAt: true },
      })
    : [];
  const podcastIdBySegment = new Map<string, string>();
  for (const p of podcasts) {
    for (const s of p.segments) podcastIdBySegment.set(s.id, p.id);
  }
  const latestByPodcast = new Map<string, Date>();
  for (const r of lastRuns) {
    const pid = r.podcastSegmentId ? podcastIdBySegment.get(r.podcastSegmentId) : null;
    if (!pid) continue;
    if (!latestByPodcast.has(pid)) latestByPodcast.set(pid, r.startedAt);
  }

  return podcasts.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    hostStyle: p.hostStyle,
    cadence: p.cadence,
    enabled: p.enabled,
    segmentCount: p.segments.length,
    episodeCount: p.episodes.length,
    lastRunAt: latestByPodcast.get(p.id) ?? null,
    createdAt: p.createdAt,
  }));
}

export async function getPodcastDetail(id: string): Promise<PodcastDetail | null> {
  const user = await requireUser();
  const podcast = await prisma.podcast.findFirst({
    where: { id, userId: user.id },
    include: {
      segments: {
        orderBy: { orderIndex: "asc" },
        include: {
          monitors: {
            select: { id: true, name: true, type: true, config: true, category: true },
            orderBy: { createdAt: "asc" },
          },
          transcripts: {
            orderBy: { createdAt: "desc" },
            select: { id: true, title: true, createdAt: true },
          },
          runs: {
            orderBy: { startedAt: "desc" },
            take: 1,
            select: { id: true, startedAt: true, status: true },
          },
        },
      },
    },
  });
  if (!podcast) return null;

  const segments: SegmentSummary[] = podcast.segments.map((s) => {
    // Split Monitor rows by type — same shape AnalystConfigForm consumes
    // off getAnalystDetail.{domainMonitors,searchMonitors}.
    const domainMonitors: SegmentDomainMonitorView[] = [];
    const searchMonitors: SegmentSearchMonitorView[] = [];
    for (const m of s.monitors) {
      const cfg = (m.config as Record<string, unknown> | null) ?? {};
      if (m.type === "DOMAIN") {
        domainMonitors.push({
          id: m.id,
          name: m.name,
          domain: typeof cfg.domain === "string" ? cfg.domain : "",
          category: m.category,
          qualityScore: typeof cfg.qualityScore === "number" ? cfg.qualityScore : 3,
        });
      } else if (m.type === "SEARCH") {
        searchMonitors.push({
          id: m.id,
          name: m.name,
          query: typeof cfg.query === "string" ? cfg.query : "",
          category: m.category,
        });
      }
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      segmentPrompt: s.segmentPrompt,
      targetSeconds: s.targetSeconds,
      topics: s.topics,
      excludeTopics: s.excludeTopics,
      enabled: s.enabled,
      orderIndex: s.orderIndex,
      lastRunAt: s.runs[0]?.startedAt ?? null,
      lastTranscriptTitle: s.transcripts[0]?.title ?? null,
      transcriptCount: s.transcripts.length,
      domainMonitors,
      searchMonitors,
    };
  });

  return {
    id: podcast.id,
    userId: podcast.userId,
    name: podcast.name,
    description: podcast.description,
    hostStyle: podcast.hostStyle,
    voiceId: podcast.voiceId,
    cadence: podcast.cadence,
    coverArtUrl: podcast.coverArtUrl,
    enabled: podcast.enabled,
    createdAt: podcast.createdAt,
    updatedAt: podcast.updatedAt,
    segments,
  };
}

export async function getSegmentTranscript(transcriptId: string) {
  const user = await requireUser();
  return prisma.segmentTranscript.findFirst({
    where: { id: transcriptId, userId: user.id },
  });
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createPodcastFromBuilder(
  config: SuggestedPodcastConfig,
  builderPrompt?: string,
): Promise<{ id: string }> {
  const user = await requireUser();

  const podcast = await prisma.$transaction(async (tx) => {
    const created = await tx.podcast.create({
      data: {
        userId: user.id,
        name: config.podcast.name,
        description: config.podcast.description,
        hostStyle: config.podcast.hostStyle ?? null,
        cadence: config.podcast.cadence ?? null,
        builderPrompt: builderPrompt ?? null,
      },
    });

    // Create segments one-by-one so we can attach monitor rows by segment
    // id. createMany doesn't return the inserted ids in Postgres without
    // an extra round-trip, so the loop pays for itself.
    for (let i = 0; i < config.segments.length; i++) {
      const s = config.segments[i];
      const segment = await tx.podcastSegment.create({
        data: {
          podcastId: created.id,
          userId: user.id,
          name: s.name,
          description: s.description ?? null,
          segmentPrompt: s.segmentPrompt,
          targetSeconds: s.targetSeconds,
          orderIndex: i,
          topics: s.topics,
          excludeTopics: s.excludeTopics,
          // `sources` column on PodcastSegment is dormant — domain hints
          // belong on Monitor rows of type=DOMAIN. Empty array stays in DB
          // for legacy column compatibility until a follow-up migration
          // drops it.
          sources: [],
        },
      });

      // Domain monitors — Monitor rows of type=DOMAIN, mirror of
      // createAnalystFromBuilder's domain-monitor block.
      for (const m of s.domainMonitors) {
        const domain = m.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        await tx.monitor.create({
          data: {
            name: m.name,
            type: "DOMAIN",
            method: "perplexity_sonar",
            config: {
              domain,
              url: `https://${domain}`,
              qualityScore: 3,
              reason: m.reason,
            } as object,
            scope: "PODCAST_SEGMENT",
            podcastSegmentId: segment.id,
            enabled: true,
            builtIn: false,
            origin: "BUILDER",
            class: "UNIVERSE",
            category: "THEMATIC",
          },
        });
      }

      // Search-query monitors — Monitor rows of type=SEARCH, mirror of
      // createAnalystFromBuilder's intelligenceQueries block.
      for (const q of s.searchQueries) {
        await tx.monitor.create({
          data: {
            name: q.query,
            type: "SEARCH",
            method: "perplexity_sonar",
            config: { query: q.query, reason: q.reason } as object,
            scope: "PODCAST_SEGMENT",
            podcastSegmentId: segment.id,
            enabled: true,
            builtIn: false,
            origin: "BUILDER",
            class: "UNIVERSE",
            category: "THEMATIC",
          },
        });
      }
    }

    return created;
  });

  revalidatePath("/podcasts");
  return { id: podcast.id };
}

// ── Update ──────────────────────────────────────────────────────────────────

export interface SegmentPatch {
  name?: string;
  description?: string | null;
  segmentPrompt?: string;
  targetSeconds?: number;
  topics?: string[];
  excludeTopics?: string[];
  enabled?: boolean;
  orderIndex?: number;
}

export async function updateSegment(segmentId: string, patch: SegmentPatch) {
  const user = await requireUser();
  const seg = await prisma.podcastSegment.findFirst({
    where: { id: segmentId, userId: user.id },
    select: { id: true, podcastId: true },
  });
  if (!seg) throw new Error("Segment not found");

  await prisma.podcastSegment.update({
    where: { id: seg.id },
    data: patch,
  });
  revalidatePath(`/podcasts/${seg.podcastId}`);
  revalidatePath(`/podcasts/${seg.podcastId}/segments/${seg.id}`);
}

export async function updatePodcastBasics(
  podcastId: string,
  patch: { name?: string; description?: string | null; hostStyle?: string | null; cadence?: string | null },
) {
  const user = await requireUser();
  const p = await prisma.podcast.findFirst({
    where: { id: podcastId, userId: user.id },
    select: { id: true },
  });
  if (!p) throw new Error("Podcast not found");
  await prisma.podcast.update({ where: { id: p.id }, data: patch });
  revalidatePath(`/podcasts/${podcastId}`);
}

// ── Monitors on a segment ──────────────────────────────────────────────────
// Reuses the Monitor table — same shape as analyst monitors. Two types:
//   • DOMAIN: a website crawled by Sonar+Firecrawl (config.domain, qualityScore)
//   • SEARCH: a Sonar query (config.query)
// Mirrors createAnalystFromBuilder's monitor-row shape exactly so downstream
// jobs (domain-monitor, search-query crons, signal-router) treat segment
// monitors the same as analyst monitors once segment routing lands.

type AddMonitorInput =
  | { type: "DOMAIN"; name: string; domain: string; qualityScore?: number; reason?: string }
  | { type: "SEARCH"; name?: string; query: string; reason?: string };

export async function addSegmentMonitor(
  segmentId: string,
  input: AddMonitorInput,
) {
  const user = await requireUser();
  const seg = await prisma.podcastSegment.findFirst({
    where: { id: segmentId, userId: user.id },
    select: { id: true, podcastId: true },
  });
  if (!seg) throw new Error("Segment not found");

  if (input.type === "DOMAIN") {
    const domain = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    await prisma.monitor.create({
      data: {
        name: input.name || domain,
        type: "DOMAIN",
        method: "perplexity_sonar",
        config: {
          domain,
          url: `https://${domain}`,
          qualityScore: Math.min(5, Math.max(1, Math.round(input.qualityScore ?? 3))),
          ...(input.reason ? { reason: input.reason } : {}),
        } as object,
        scope: "PODCAST_SEGMENT",
        podcastSegmentId: seg.id,
        origin: "USER",
        class: "UNIVERSE",
        category: "THEMATIC",
      },
    });
  } else {
    await prisma.monitor.create({
      data: {
        name: input.name?.trim() || input.query,
        type: "SEARCH",
        method: "perplexity_sonar",
        config: {
          query: input.query,
          ...(input.reason ? { reason: input.reason } : {}),
        } as object,
        scope: "PODCAST_SEGMENT",
        podcastSegmentId: seg.id,
        origin: "USER",
        class: "UNIVERSE",
        category: "THEMATIC",
      },
    });
  }
  revalidatePath(`/podcasts/${seg.podcastId}`);
}

export async function removeSegmentMonitor(monitorId: string) {
  const user = await requireUser();
  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId },
    include: { segment: { select: { id: true, podcastId: true, userId: true } } },
  });
  if (!monitor || !monitor.segment || monitor.segment.userId !== user.id) {
    throw new Error("Monitor not found");
  }
  await prisma.monitor.delete({ where: { id: monitorId } });
  revalidatePath(`/podcasts/${monitor.segment.podcastId}`);
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deletePodcast(podcastId: string) {
  const user = await requireUser();
  const p = await prisma.podcast.findFirst({
    where: { id: podcastId, userId: user.id },
    select: { id: true },
  });
  if (!p) throw new Error("Podcast not found");
  await prisma.podcast.delete({ where: { id: p.id } });
  revalidatePath("/podcasts");
}

// ── Run kick ────────────────────────────────────────────────────────────────

export async function runSegment(segmentId: string): Promise<{ runId: string }> {
  const user = await requireUser();
  const seg = await prisma.podcastSegment.findFirst({
    where: { id: segmentId, userId: user.id },
    select: { id: true, podcastId: true },
  });
  if (!seg) throw new Error("Segment not found");

  // Per-segment concurrent-run guard, mirrors the analyst guard in
  // /api/research/agent-run.
  const existing = await prisma.researchRun.findFirst({
    where: { podcastSegmentId: seg.id, status: "RUNNING" },
    select: { id: true },
  });
  if (existing) {
    throw new Error("This segment already has a run in progress.");
  }

  const run = await prisma.researchRun.create({
    data: {
      userId: user.id,
      source: "MANUAL",
      status: "RUNNING",
      // Mark the run with a podcast-flavored mode value so historical
      // queries can filter by it. Consumer code keys off podcastSegmentId
      // primarily; this mode string is for display/filter convenience.
      mode: "PODCAST_SEGMENT",
      parameters: { agentMode: true } as object,
      podcastSegmentId: seg.id,
    },
  });
  return { runId: run.id };
}
