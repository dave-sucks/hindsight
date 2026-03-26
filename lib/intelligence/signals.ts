// ── Signal Creation & Dedup Utilities ─────────────────────────────────────────
// Used by intelligence jobs to create signals, batch them, and deduplicate.

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type {
  BatchJobType,
  BatchStatus,
  CreateSignalInput,
  SignalFreshness,
  SignalType,
  SonarSignalResponse,
} from "@/lib/intelligence/types";

// ── Batch Management ─────────────────────────────────────────────────────────

/**
 * Create a new SignalBatch in RUNNING status.
 * Returns the batch ID.
 */
export async function createSignalBatch(
  jobType: BatchJobType
): Promise<string> {
  const batch = await prisma.signalBatch.create({
    data: {
      jobType,
      status: "RUNNING",
      signalCount: 0,
    },
  });
  return batch.id;
}

/**
 * Mark a SignalBatch as complete (or failed).
 * Updates signalCount from the actual number of signals in the batch.
 */
export async function completeSignalBatch(
  batchId: string,
  status: BatchStatus = "COMPLETE"
): Promise<void> {
  const signalCount = await prisma.signal.count({
    where: { batchId },
  });

  await prisma.signalBatch.update({
    where: { id: batchId },
    data: {
      status,
      signalCount,
      completedAt: new Date(),
    },
  });
}

// ── Signal Creation ──────────────────────────────────────────────────────────

/**
 * Create a single Signal row from structured input.
 * Computes contentHash from headline + summary for dedup.
 * Returns the signal ID.
 */
export async function createSignal(input: CreateSignalInput): Promise<string> {
  const contentHash = computeContentHash(input.headline, input.summary);

  const signal = await prisma.signal.create({
    data: {
      batchId: input.batchId,
      artifactId: input.artifactId,
      type: input.type,
      headline: input.headline,
      summary: input.summary,
      evidence: input.evidence,
      tickers: input.tickers,
      themes: input.themes,
      sectors: input.sectors,
      sentiment: input.sentiment,
      noveltyScore: input.noveltyScore ?? 50,
      urgency: input.urgency,
      sourceQuality: input.sourceQuality ?? 3,
      freshness: input.freshness,
      sourceUrls: input.sourceUrls,
      sourceNames: input.sourceNames,
      searchTool: input.searchTool,
      searchQuery: input.searchQuery,
      searchContext: input.searchContext,
      expiresAt: input.expiresAt,
    },
  });

  return signal.id;
}

/**
 * Create Signal rows from a raw Sonar structured response.
 * Maps SonarSignalOutput fields to CreateSignalInput.
 * Returns array of created signal IDs.
 */
export async function createSignalsFromSonar(
  batchId: string,
  sonarResponse: SonarSignalResponse,
  signalType: SignalType,
  sourceQuality: number = 3,
  provenance?: { searchTool?: string; searchQuery?: string; searchContext?: string }
): Promise<string[]> {
  const ids: string[] = [];

  for (const item of sonarResponse.signals) {
    try {
      const id = await createSignal({
        batchId,
        type: signalType,
        headline: item.headline,
        summary: item.summary,
        tickers: item.tickers,
        themes: item.themes,
        sectors: item.sectors,
        sentiment: item.sentiment,
        urgency: item.urgency,
        sourceQuality,
        freshness: "TODAY",
        sourceUrls: item.sourceUrls,
        sourceNames: item.sourceNames,
        searchTool: provenance?.searchTool,
        searchQuery: provenance?.searchQuery,
        searchContext: provenance?.searchContext,
      });
      ids.push(id);
    } catch (error) {
      console.warn(
        `[signals] Failed to create signal "${item.headline}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return ids;
}

// ── Deduplication ────────────────────────────────────────────────────────────

/**
 * Remove duplicate signals from a batch.
 * A signal is a duplicate if another signal with the same contentHash
 * (headline + summary) exists from the last 24 hours in a different batch.
 * Returns the number of deleted duplicates.
 */
export async function deduplicateSignals(batchId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get all signals in this batch
  const batchSignals = await prisma.signal.findMany({
    where: { batchId },
    select: { id: true, headline: true, summary: true },
  });

  // Get all signals from other batches in the last 24 hours
  const recentSignals = await prisma.signal.findMany({
    where: {
      batchId: { not: batchId },
      createdAt: { gte: cutoff },
    },
    select: { headline: true, summary: true },
  });

  // Build a set of existing content hashes
  const existingHashes = new Set(
    recentSignals.map((s) => computeContentHash(s.headline, s.summary))
  );

  // Find duplicates in this batch
  const duplicateIds = batchSignals
    .filter((s) => existingHashes.has(computeContentHash(s.headline, s.summary)))
    .map((s) => s.id);

  if (duplicateIds.length === 0) return 0;

  // Delete duplicates
  await prisma.signal.deleteMany({
    where: { id: { in: duplicateIds } },
  });

  return duplicateIds.length;
}

// ── Hash & Freshness Utilities ───────────────────────────────────────────────

/**
 * Compute a SHA256 hash of normalized headline + summary for dedup.
 * Normalizes by lowercasing and trimming whitespace.
 */
export function computeContentHash(headline: string, summary: string): string {
  const normalized = `${headline.toLowerCase().trim()}|${summary.toLowerCase().trim()}`;
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Compute signal freshness based on published date.
 * BREAKING: less than 1 hour old
 * TODAY: less than 24 hours old
 * THIS_WEEK: less than 7 days old
 * OLDER: everything else
 */
export function computeFreshness(publishedAt?: Date): SignalFreshness {
  if (!publishedAt) return "TODAY";

  const ageMs = Date.now() - publishedAt.getTime();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  const ONE_WEEK = 7 * ONE_DAY;

  if (ageMs < ONE_HOUR) return "BREAKING";
  if (ageMs < ONE_DAY) return "TODAY";
  if (ageMs < ONE_WEEK) return "THIS_WEEK";
  return "OLDER";
}
