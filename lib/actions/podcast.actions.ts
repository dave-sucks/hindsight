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

export interface SegmentMonitorView {
  id: string;
  name: string;
  query: string;
}

export interface SegmentSummary {
  id: string;
  name: string;
  description: string | null;
  segmentPrompt: string;
  targetSeconds: number;
  topics: string[];
  sources: string[];
  excludeTopics: string[];
  enabled: boolean;
  orderIndex: number;
  lastRunAt: Date | null;
  lastTranscriptTitle: string | null;
  transcriptCount: number;
  // Monitors are carried inline so the per-segment settings sheet can open
  // without a second round-trip. The sheet only needs id/name/query —
  // additional Monitor fields stay on the row but aren't surfaced here.
  monitors: SegmentMonitorView[];
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
            select: { id: true, name: true, config: true },
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

  const segments: SegmentSummary[] = podcast.segments.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    segmentPrompt: s.segmentPrompt,
    targetSeconds: s.targetSeconds,
    topics: s.topics,
    sources: s.sources,
    excludeTopics: s.excludeTopics,
    enabled: s.enabled,
    orderIndex: s.orderIndex,
    lastRunAt: s.runs[0]?.startedAt ?? null,
    lastTranscriptTitle: s.transcripts[0]?.title ?? null,
    transcriptCount: s.transcripts.length,
    monitors: s.monitors.map((m) => {
      const cfg = (m.config as { query?: string } | null) ?? {};
      return { id: m.id, name: m.name, query: cfg.query ?? "" };
    }),
  }));

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

    if (config.segments.length > 0) {
      await tx.podcastSegment.createMany({
        data: config.segments.map((s, i) => ({
          podcastId: created.id,
          userId: user.id,
          name: s.name,
          description: s.description ?? null,
          segmentPrompt: s.segmentPrompt,
          targetSeconds: s.targetSeconds,
          orderIndex: i,
          topics: s.topics,
          sources: s.sources,
          excludeTopics: s.excludeTopics,
        })),
      });
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
  sources?: string[];
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
// Reuses the Monitor table — Phase 1 supports search-style monitors via
// Sonar (the most useful for podcasts). Domain monitors and API monitors
// can be added in Phase 4 once the segment-aware signal-router lands.

export async function addSegmentMonitor(
  segmentId: string,
  input: { name: string; query: string },
) {
  const user = await requireUser();
  const seg = await prisma.podcastSegment.findFirst({
    where: { id: segmentId, userId: user.id },
    select: { id: true, podcastId: true },
  });
  if (!seg) throw new Error("Segment not found");

  await prisma.monitor.create({
    data: {
      name: input.name,
      type: "SEARCH",
      method: "perplexity_sonar",
      config: { query: input.query } as object,
      scope: "PODCAST_SEGMENT",
      podcastSegmentId: seg.id,
      origin: "USER",
      class: "UNIVERSE",
      category: "THEMATIC",
    },
  });
  revalidatePath(`/podcasts/${seg.podcastId}/segments/${seg.id}`);
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
  revalidatePath(`/podcasts/${monitor.segment.podcastId}/segments/${monitor.segment.id}`);
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
