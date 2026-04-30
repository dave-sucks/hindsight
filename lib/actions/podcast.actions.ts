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
import type { TranscriptCardData } from "@/components/agent/sheets/TranscriptSheet";
import { inngest } from "@/lib/inngest/client";
import { estimateCost } from "@/lib/podcast/elevenlabs";

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
  /** Most-recent transcript carried inline so the segment card can open it
   *  without an extra fetch. Mirrors the analyst pattern of returning
   *  ThesisRowData inline on AgentConfig detail. Null when no runs yet. */
  latestTranscript: TranscriptCardData | null;
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
            select: {
              id: true,
              title: true,
              createdAt: true,
              plainText: true,
              citations: true,
              durationSec: true,
              audioUrl: true,
              status: true,
            },
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
    const t0 = s.transcripts[0];
    const latestTranscript: TranscriptCardData | null = t0
      ? {
          transcriptId: t0.id,
          title: t0.title,
          plainText: t0.plainText,
          citations: Array.isArray(t0.citations)
            ? (t0.citations as TranscriptCardData["citations"])
            : [],
          durationSec: t0.durationSec ?? null,
          audioUrl: t0.audioUrl ?? null,
          status: t0.status,
          segmentName: s.name,
          podcastName: podcast.name,
        }
      : null;
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
      lastTranscriptTitle: t0?.title ?? null,
      transcriptCount: s.transcripts.length,
      latestTranscript,
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
  patch: {
    name?: string;
    description?: string | null;
    hostStyle?: string | null;
    cadence?: string | null;
    voiceId?: string | null;
  },
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

export async function updatePodcastVoice(
  podcastId: string,
  voiceId: string | null,
) {
  return updatePodcastBasics(podcastId, { voiceId });
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

// ── Episodes (text-only assembly) ──────────────────────────────────────────

export interface EpisodeListItem {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "ASSEMBLING" | "READY" | "FAILED";
  durationSec: number | null;
  publishedAt: Date | null;
  transcriptCount: number;
  createdAt: Date;
}

export interface EpisodeTranscriptItem {
  id: string;
  title: string;
  segmentName: string;
  plainText: string;
  citations: Array<{
    claim: string;
    url: string;
    quote?: string;
    startChar: number;
    endChar: number;
  }>;
  durationSec: number | null;
}

export interface EpisodeDetail {
  id: string;
  podcastId: string;
  podcastName: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "ASSEMBLING" | "READY" | "FAILED";
  audioUrl: string | null;
  durationSec: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  transcripts: EpisodeTranscriptItem[];
}

export async function listEpisodesForPodcast(
  podcastId: string,
): Promise<EpisodeListItem[]> {
  const user = await requireUser();
  const podcast = await prisma.podcast.findFirst({
    where: { id: podcastId, userId: user.id },
    select: { id: true },
  });
  if (!podcast) return [];

  const episodes = await prisma.episode.findMany({
    where: { podcastId, userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      durationSec: true,
      publishedAt: true,
      transcriptIds: true,
      createdAt: true,
    },
  });
  return episodes.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status as EpisodeListItem["status"],
    durationSec: e.durationSec,
    publishedAt: e.publishedAt,
    transcriptCount: e.transcriptIds.length,
    createdAt: e.createdAt,
  }));
}

export async function getEpisode(episodeId: string): Promise<EpisodeDetail | null> {
  const user = await requireUser();
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId: user.id },
    include: { podcast: { select: { name: true } } },
  });
  if (!episode) return null;

  // The Episode stores transcript ids in publish order on `transcriptIds`.
  // Load them in one query, then re-sort to match that order.
  const ids = episode.transcriptIds;
  const rows =
    ids.length === 0
      ? []
      : await prisma.segmentTranscript.findMany({
          where: { id: { in: ids }, userId: user.id },
          select: {
            id: true,
            title: true,
            plainText: true,
            citations: true,
            durationSec: true,
            segment: { select: { name: true } },
          },
        });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: EpisodeTranscriptItem[] = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      id: r.id,
      title: r.title,
      segmentName: r.segment.name,
      plainText: r.plainText,
      citations: Array.isArray(r.citations)
        ? (r.citations as EpisodeTranscriptItem["citations"])
        : [],
      durationSec: r.durationSec,
    }));

  return {
    id: episode.id,
    podcastId: episode.podcastId,
    podcastName: episode.podcast.name,
    title: episode.title,
    description: episode.description,
    status: episode.status as EpisodeDetail["status"],
    audioUrl: episode.audioUrl,
    durationSec: episode.durationSec,
    publishedAt: episode.publishedAt,
    createdAt: episode.createdAt,
    transcripts: ordered,
  };
}

export async function createEpisodeFromTranscripts(
  podcastId: string,
  transcriptIds: string[],
  title?: string,
): Promise<{ id: string }> {
  const user = await requireUser();
  if (transcriptIds.length === 0) {
    throw new Error("Pick at least one transcript to assemble.");
  }

  // Ownership + scope check: every transcript must belong to a segment of
  // this podcast and to this user. Anything else is a 403 path.
  const podcast = await prisma.podcast.findFirst({
    where: { id: podcastId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!podcast) throw new Error("Podcast not found");

  const transcripts = await prisma.segmentTranscript.findMany({
    where: {
      id: { in: transcriptIds },
      userId: user.id,
      segment: { podcastId },
    },
    select: { id: true, durationSec: true, status: true },
  });
  if (transcripts.length !== transcriptIds.length) {
    throw new Error(
      "Some transcripts couldn't be assembled (missing, wrong podcast, or not owned).",
    );
  }

  // Sum durations; null fields contribute nothing rather than NaN-poisoning
  // the total.
  const totalDuration = transcripts.reduce(
    (acc, t) => acc + (t.durationSec ?? 0),
    0,
  );

  const derivedTitle =
    title?.trim() ||
    `${podcast.name} — ${new Date().toISOString().slice(0, 10)}`;

  const episode = await prisma.episode.create({
    data: {
      podcastId,
      userId: user.id,
      title: derivedTitle,
      transcriptIds,
      durationSec: totalDuration > 0 ? totalDuration : null,
      // Text-only assembly is "READY" — it's directly viewable. The audio
      // path uses ASSEMBLING during ffmpeg concat (Phase 2/3).
      status: "READY",
    },
    select: { id: true },
  });

  revalidatePath(`/podcasts/${podcastId}`);
  return { id: episode.id };
}

// ── Editor: apply suggest_podcast_config to existing podcast ───────────────

/**
 * updatePodcastFromEditor — applies a SuggestedPodcastConfig to an existing
 * Podcast. Mirror of updateAnalystFromBuilder for analysts.
 *
 * Contract: the proposal represents the FULL desired state. Segments are
 * matched by name (case-insensitive); existing-name segments get updated,
 * new-name segments get created, and existing segments missing from the
 * proposal get deleted (cascade-removes their monitors + transcripts).
 *
 * The editor system prompt enforces "preserve segments not asked to be
 * removed" so renames-with-content-moves should be rare. If the user
 * really wants to rename, they can do it via the segment settings sheet
 * which keeps the row id stable.
 */
export async function updatePodcastFromEditor(
  podcastId: string,
  config: SuggestedPodcastConfig,
): Promise<void> {
  const user = await requireUser();

  const existing = await prisma.podcast.findFirst({
    where: { id: podcastId, userId: user.id },
    include: {
      segments: {
        select: {
          id: true,
          name: true,
          orderIndex: true,
          monitors: { select: { id: true, origin: true } },
        },
      },
    },
  });
  if (!existing) throw new Error("Podcast not found");

  await prisma.$transaction(async (tx) => {
    // ── 1. Update podcast metadata ──────────────────────────────────────
    await tx.podcast.update({
      where: { id: existing.id },
      data: {
        name: config.podcast.name,
        description: config.podcast.description,
        hostStyle: config.podcast.hostStyle ?? null,
        cadence: config.podcast.cadence ?? null,
      },
    });

    // ── 2. Reconcile segments by name (case-insensitive) ───────────────
    const norm = (s: string) => s.trim().toLowerCase();
    const proposedNames = new Set(config.segments.map((s) => norm(s.name)));
    const existingByName = new Map(existing.segments.map((s) => [norm(s.name), s]));

    // Delete segments present in current but missing from proposal.
    // Cascade removes their Monitor rows and SegmentTranscript rows
    // via the FK onDelete behavior.
    const toDelete = existing.segments.filter((s) => !proposedNames.has(norm(s.name)));
    if (toDelete.length > 0) {
      await tx.podcastSegment.deleteMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
      });
    }

    // Update or create per proposal segment, in proposal order.
    for (let i = 0; i < config.segments.length; i++) {
      const s = config.segments[i];
      const match = existingByName.get(norm(s.name));

      let segmentId: string;
      if (match) {
        // Update existing — preserve orderIndex from proposal order, update
        // fields, then wipe + rebuild BUILDER-origin monitors. USER-origin
        // monitors (added manually via the segment settings sheet) are
        // preserved across editor passes.
        await tx.podcastSegment.update({
          where: { id: match.id },
          data: {
            name: s.name,
            description: s.description ?? null,
            segmentPrompt: s.segmentPrompt,
            targetSeconds: s.targetSeconds,
            topics: s.topics,
            excludeTopics: s.excludeTopics,
            orderIndex: i,
          },
        });
        segmentId = match.id;
        await tx.monitor.deleteMany({
          where: {
            podcastSegmentId: segmentId,
            origin: "BUILDER",
          },
        });
      } else {
        // Create new segment.
        const created = await tx.podcastSegment.create({
          data: {
            podcastId: existing.id,
            userId: user.id,
            name: s.name,
            description: s.description ?? null,
            segmentPrompt: s.segmentPrompt,
            targetSeconds: s.targetSeconds,
            orderIndex: i,
            topics: s.topics,
            excludeTopics: s.excludeTopics,
            sources: [],
          },
        });
        segmentId = created.id;
      }

      // Recreate domain + search monitors as BUILDER-origin rows. Mirror of
      // createPodcastFromBuilder's monitor block. USER-origin monitors live
      // alongside, untouched.
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
            podcastSegmentId: segmentId,
            enabled: true,
            builtIn: false,
            origin: "BUILDER",
            class: "UNIVERSE",
            category: "THEMATIC",
          },
        });
      }
      for (const q of s.searchQueries) {
        await tx.monitor.create({
          data: {
            name: q.query,
            type: "SEARCH",
            method: "perplexity_sonar",
            config: { query: q.query, reason: q.reason } as object,
            scope: "PODCAST_SEGMENT",
            podcastSegmentId: segmentId,
            enabled: true,
            builtIn: false,
            origin: "BUILDER",
            class: "UNIVERSE",
            category: "THEMATIC",
          },
        });
      }
    }
  });

  revalidatePath(`/podcasts/${podcastId}`);
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

// ── Audio generation trigger ────────────────────────────────────────────────

export interface TriggerAudioResult {
  ok: true;
  charCount: number;
  estimatedCostUsd: number;
}

/**
 * Queue ElevenLabs TTS generation for an episode.
 *
 * Validates ownership, checks the podcast has a voiceId, computes char count
 * for cost display, transitions status to ASSEMBLING, and dispatches the
 * `podcast/episode.tts.requested` Inngest event. The Inngest job does the
 * actual TTS work so this action returns fast.
 *
 * Called from the GenerateAudioButton on the episode page. Idempotent guard:
 * returns an error if the episode is already ASSEMBLING.
 */
export async function triggerEpisodeAudio(
  episodeId: string,
): Promise<TriggerAudioResult | { ok: false; error: string }> {
  const user = await requireUser();

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId: user.id },
    include: {
      podcast: { select: { voiceId: true } },
    },
  });
  if (!episode) return { ok: false, error: "Episode not found" };
  if (episode.status === "ASSEMBLING") {
    return { ok: false, error: "Audio generation is already in progress" };
  }
  if (!episode.podcast.voiceId) {
    return {
      ok: false,
      error: "Pick a voice for this podcast before generating audio",
    };
  }

  // Load transcripts in publish order to compute character count
  const ids = episode.transcriptIds;
  const rows =
    ids.length === 0
      ? []
      : await prisma.segmentTranscript.findMany({
          where: { id: { in: ids }, userId: user.id },
          select: { id: true, plainText: true },
        });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fullText = ids
    .map((id) => byId.get(id)?.plainText ?? "")
    .join("\n\n");

  const charCount = fullText.length;
  if (charCount === 0) {
    return { ok: false, error: "Episode has no transcript text to synthesize" };
  }

  // Transition to ASSEMBLING before dispatching so the UI can reflect it
  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: "ASSEMBLING" },
  });
  revalidatePath(`/podcasts/${episode.podcastId}/episodes/${episodeId}`);

  await inngest.send({
    name: "podcast/episode.tts.requested",
    data: {
      episodeId,
      userId: user.id,
      podcastId: episode.podcastId,
      voiceId: episode.podcast.voiceId,
    },
  });

  return {
    ok: true,
    charCount,
    estimatedCostUsd: estimateCost(charCount),
  };
}
