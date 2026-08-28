"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getAccountId } from "@/lib/auth/account";
import { getOrCreateManualRun } from "@/lib/agent/manual-run-anchor";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { reviewCadenceTrigger } from "@/lib/agent/triggers/defaults";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

// Watchlist collapse — Thesis is the single store. AnalystWatchlistItem is
// gone. The "watchlist" is now the query:
//   Thesis WHERE researchRun.agentConfigId = X AND status = 'WATCHING'
// Includes null-direction seeds (awaiting first research), LONG WATCHING
// (entry pending), SHORT WATCHING (entry pending). See
// docs/WATCHLIST_COLLAPSE_PLAN.md.

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * What the analyst page renders for each watchlist row. Sourced from a
 * `status='WATCHING'` Thesis. `direction` is `LONG|SHORT|null` (null = an
 * unresearched seed; legacy 'PENDING' during the B4 dual-read window); PASS
 * theses never appear here (they're PASSED/ARCHIVED, off the watchlist).
 *
 * `id` is now the underlying Thesis id (was AnalystWatchlistItem.id pre-collapse).
 */
export interface WatchlistItemView {
  id: string;
  symbol: string;
  /** The underlying Thesis row id — used to open ThesisSheet on row click. Absent on optimistic temp rows. */
  thesisId?: string;
  reason: string;
  notes: string | null;
  addedBy: string;
  priority: string;
  status: string;
  thesisDirection: string | null;
  targetPrice: number | null;
  stopPrice: number | null;
  conviction: number | null;
  catalyst: string | null;
  lastReviewedAt: Date | null;
  createdAt: Date;
  thesisCount: number;
  latestThesis: {
    direction: string | null;
    confidenceScore: number;
    createdAt: Date;
  } | null;
}

// ── Legacy compat (used by old user-level watchlist on supabase) ─────────────

export async function getWatchlistSymbolsByEmail(
  email: string,
): Promise<string[]> {
  if (!email) return [];
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { watchlist: { select: { symbol: true } } },
    });
    return user?.watchlist.map((w) => w.symbol) ?? [];
  } catch (err) {
    console.error("getWatchlistSymbolsByEmail error:", err);
    return [];
  }
}

// ── Stock page: analyst watchlist status ─────────────────────────────────────

export interface AnalystWatchlistStatus {
  id: string;
  name: string;
  isWatched: boolean;
}

/** Get all analysts for the current user with whether each is watching this symbol. */
export async function getWatchlistStatusForSymbol(
  symbol: string,
): Promise<AnalystWatchlistStatus[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const accountId = await getAccountId(userId);
  if (!accountId) return [];

  const upper = symbol.toUpperCase();

  const analysts = await prisma.agentConfig.findMany({
    where: { accountId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (analysts.length === 0) return [];

  // One query: every WATCHING thesis for the user's analysts on this symbol.
  const watchingTheses = await prisma.thesis.findMany({
    where: {
      ticker: upper,
      status: "WATCHING",
      researchRun: { agentConfigId: { in: analysts.map((a) => a.id) } },
    },
    select: { researchRun: { select: { agentConfigId: true } } },
  });
  const watchingByAnalyst = new Set(
    watchingTheses
      .map((t) => t.researchRun.agentConfigId)
      .filter((id): id is string => id !== null),
  );

  return analysts.map((a) => ({
    id: a.id,
    name: a.name,
    isWatched: watchingByAnalyst.has(a.id),
  }));
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get all watchlist items for an analyst. The "watchlist" is `Thesis WHERE
 * status='WATCHING'` — includes PENDING (awaiting research), LONG WATCHING,
 * and SHORT WATCHING. PASS theses live at status='ARCHIVED' and are not on
 * the watchlist.
 */
export async function getWatchlistItems(
  analystId: string,
): Promise<WatchlistItemView[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  const theses = await prisma.thesis.findMany({
    where: {
      accountId,
      status: "WATCHING",
      researchRun: { agentConfigId: analystId },
    },
    select: {
      id: true,
      ticker: true,
      direction: true,
      targetPrice: true,
      stopLoss: true,
      scoring: true,
      snapshot: true,
      sourceKind: true,
      sourceRationale: true,
      catalystDate: true,
      createdAt: true,
      lastReviewedAt: true,
    },
    orderBy: [{ direction: "asc" }, { createdAt: "desc" }],
  });

  if (theses.length === 0) return [];

  // Count of historical theses per ticker for this analyst (any status,
  // any time). Surfaces "this is the 3rd time the analyst has looked at NVDA"
  // in the UI.
  const tickers = Array.from(new Set(theses.map((t) => t.ticker)));
  const allTheses = await prisma.thesis.findMany({
    where: {
      accountId,
      ticker: { in: tickers },
      researchRun: { agentConfigId: analystId },
    },
    select: { ticker: true, direction: true, scoring: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const histBySymbol = new Map<
    string,
    { count: number; latest: (typeof allTheses)[0] | null }
  >();
  for (const t of allTheses) {
    const existing = histBySymbol.get(t.ticker);
    if (existing) existing.count++;
    else histBySymbol.set(t.ticker, { count: 1, latest: t });
  }

  return theses.map((t) => {
    const hist = histBySymbol.get(t.ticker);
    // Map source_kind → "addedBy" display string the UI expects.
    const addedBy =
      t.sourceKind === "BUILDER_SEED"
        ? "BUILDER"
        : t.sourceKind === "USER_ADDED"
          ? "USER"
          : t.sourceKind === "EDITOR_SEED"
            ? "BUILDER"
            : "AGENT";
    // PR-9: legacy 0-100 conviction → composite × 10.
    const composite = getThesisComposite(t);
    const histComposite = hist?.latest ? getThesisComposite(hist.latest) : null;
    return {
      id: t.id,
      thesisId: t.id,
      symbol: t.ticker,
      reason: getThesisSnapshotText(t),
      notes: null,
      addedBy,
      priority: "NORMAL",
      status: "WATCHING", // legacy contract — UI ignores
      // P1-24 B4 dual-read: an unresearched seed is direction=null (new) or
      // 'PENDING' (legacy, pre-backfill). Normalize both to null so the row
      // renders "Awaiting review".
      thesisDirection: t.direction === "PENDING" ? null : t.direction,
      targetPrice: t.targetPrice,
      stopPrice: t.stopLoss,
      conviction: composite != null ? composite * 10 : 0,
      catalyst: t.catalystDate ? t.catalystDate.toISOString() : null,
      lastReviewedAt: t.lastReviewedAt,
      createdAt: t.createdAt,
      thesisCount: hist?.count ?? 1,
      latestThesis: hist?.latest
        ? {
            direction: hist.latest.direction,
            confidenceScore: histComposite != null ? histComposite * 10 : 0,
            createdAt: hist.latest.createdAt,
          }
        : null,
    };
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Add a stock to an analyst's watchlist. Mints a `Thesis(direction:null,
 * status:'WATCHING', sourceKind:'USER_ADDED')` anchored to the analyst's
 * synthetic MANUAL ResearchRun. The 7-day cadence trigger stamped below
 * surfaces it as REVIEW_DUE (counted from createdAt — never reviewed).
 *
 * Idempotent: if any ACTIVE/WATCHING thesis already exists on (analyst,
 * ticker), returns the existing view.
 */
export async function addWatchlistItem(
  analystId: string,
  symbol: string,
  reason: string = "Added manually",
  addedBy: string = "USER",
  _priority: string = "NORMAL",
): Promise<WatchlistItemView> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  // Verify analyst ownership
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
    select: { id: true },
  });
  if (!analyst) throw new Error("Analyst not found");

  const upper = symbol.toUpperCase();

  // Idempotent — existing non-terminal thesis short-circuits.
  const existing = await prisma.thesis.findFirst({
    where: {
      ticker: upper,
      status: { in: ["HOLDING", "WATCHING"] },
      researchRun: { agentConfigId: analystId },
    },
    select: {
      id: true,
      ticker: true,
      direction: true,
      targetPrice: true,
      stopLoss: true,
      scoring: true,
      snapshot: true,
      sourceKind: true,
      createdAt: true,
      lastReviewedAt: true,
    },
  });
  if (existing) {
    const addedByDisplay =
      existing.sourceKind === "BUILDER_SEED"
        ? "BUILDER"
        : existing.sourceKind === "USER_ADDED"
          ? "USER"
          : "AGENT";
    const existingComposite = getThesisComposite(existing);
    return {
      id: existing.id,
      thesisId: existing.id,
      symbol: existing.ticker,
      reason: getThesisSnapshotText(existing),
      notes: null,
      addedBy: addedByDisplay,
      priority: "NORMAL",
      status: "WATCHING",
      // P1-24 B4 dual-read: null (new seed) or legacy 'PENDING' → null.
      thesisDirection: existing.direction === "PENDING" ? null : existing.direction,
      targetPrice: existing.targetPrice,
      stopPrice: existing.stopLoss,
      conviction: existingComposite != null ? existingComposite * 10 : 0,
      catalyst: null,
      lastReviewedAt: existing.lastReviewedAt,
      createdAt: existing.createdAt,
      thesisCount: 1,
      latestThesis: null,
    };
  }

  const sourceKind =
    addedBy === "BUILDER"
      ? "BUILDER_SEED"
      : addedBy === "AGENT"
        ? "WATCHLIST_REVIEW"
        : "USER_ADDED";

  const runId = await getOrCreateManualRun({ analystId, userId, accountId });

  const thesis = await prisma.thesis.create({
    data: {
      researchRunId: runId,
      userId,
      accountId,
      ticker: upper,
      source: "MANUAL",
      // P1-24 B4: watchlist-seed sentinel is now direction=null ("on the
      // watchlist, not yet researched"). status stays WATCHING. The agent
      // promotes null → LONG/SHORT on first review via update_thesis.
      direction: null,
      status: "WATCHING",
      holdDuration: "SWING",
      // PR-9 flat schema: legacy plain-string narrative columns replaced
      // by JSONB snapshot/bullCase/bearCase. confidenceScore / signalTypes
      // / sourcesUsed dropped — composite lives in scoring (null until
      // first research).
      snapshot: {
        text: reason || "Added manually — awaiting first research",
        citations: [],
      },
      modelUsed: "manual",
      sourceKind,
      sourceRationale: reason || "Manual watchlist add",
      // The seed's clock (W1, DAV-216): WATCHING no longer inherits the
      // account review cadence, so a seed with no trigger of its own
      // would be invisible forever. days=7 matches the account floor the
      // seed rode before the change — first research lands within ~a
      // week, not next morning. Restoring next-morning surfacing is a W3
      // (dispositions) item, not a trigger value.
      triggers: [
        { ...reviewCadenceTrigger(7), source: "DEFAULT" },
      ] as object[],
    },
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "CREATED",
    summary: `Added ${upper} to watchlist (awaiting first research)`,
    rationale: reason,
    runId,
  });

  revalidatePath(`/analysts/${analystId}`);
  // PR-9: legacy 0-100 conviction → composite × 10; we just minted the
  // thesis with no scoring yet, so conviction is null/0.
  const mintedComposite = getThesisComposite(thesis);
  return {
    id: thesis.id,
    symbol: thesis.ticker,
    reason: getThesisSnapshotText(thesis),
    notes: null,
    addedBy,
    priority: "NORMAL",
    status: "WATCHING",
    thesisDirection: null,
    targetPrice: null,
    stopPrice: null,
    conviction: mintedComposite != null ? mintedComposite * 10 : 0,
    catalyst: null,
    lastReviewedAt: null, // just minted — never reviewed
    createdAt: thesis.createdAt,
    thesisCount: 1,
    latestThesis: null,
  };
}

/**
 * Remove a stock from an analyst's watchlist. Sets the underlying Thesis
 * to `status='ARCHIVED'` (not INVALIDATED — INVALIDATED implies the view
 * was disproven by evidence; agent/user walk-away is ARCHIVED).
 */
export async function removeWatchlistItem(
  analystId: string,
  symbol: string,
  removeReason: string = "Removed manually",
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  const upper = symbol.toUpperCase();

  const target = await prisma.thesis.findFirst({
    where: {
      ticker: upper,
      status: "WATCHING",
      accountId,
      researchRun: { agentConfigId: analystId },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, direction: true },
  });
  if (!target) return;

  await prisma.thesis.update({
    where: { id: target.id },
    data: {
      // P1-24 B3: walk-away removal retires with reason DROPPED.
      status: "RETIRED",
      retiredReason: "DROPPED",
      closedAt: new Date(),
      closeReason: removeReason,
    },
  });

  await writeThesisUpdate({
    thesisId: target.id,
    type: "STATUS_CHANGED",
    summary: `Removed ${upper} from watchlist`,
    rationale: removeReason,
    fieldChanges: {
      status: { from: target.status, to: "RETIRED" },
      retiredReason: { from: null, to: "DROPPED" },
    },
  });

  revalidatePath(`/analysts/${analystId}`);
}

/**
 * Update display fields on a watchlist item. Under the unified model, the
 * "item" is a Thesis row; the only updateable field via this path is
 * `reasoningSummary` (the user's note). Priority and notes are not stored
 * on the Thesis row — they were UI metadata on the legacy table that nothing
 * actually consumed. Callers that need the old behavior should call
 * `update_thesis` directly.
 */
export async function updateWatchlistItem(
  itemId: string,
  data: { priority?: string; notes?: string; reason?: string },
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  const owned = await prisma.thesis.findFirst({
    where: { id: itemId, accountId },
    select: { id: true },
  });
  if (!owned) throw new Error("Watchlist item not found");

  if (data.reason !== undefined) {
    // PR-9: legacy reasoningSummary (String) replaced by snapshot
    // (JSONB { text, citations }). Wrap the user's note in the new shape.
    await prisma.thesis.update({
      where: { id: itemId },
      data: { snapshot: { text: data.reason, citations: [] } },
    });
  }
  // priority + notes are no-ops under the unified model.
}

// markWatchlistReviewed was deleted with the cached review-date column
// (DAV-221) — it had no callers, and "reviewed" is the lastReviewedAt
// stamp update_thesis writes.
