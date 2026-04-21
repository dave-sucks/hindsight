"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { applyProposedDiff } from "@/lib/suggestions/apply";
import {
  proposedDiffSchema,
  evidenceSchema,
  DISMISS_REASONS,
  type DismissReason,
  type Evidence,
  type ProposedDiff,
  type SuggestionKind,
  type SuggestionStatus,
} from "@/lib/suggestions/types";

// ── Public view model ─────────────────────────────────────────────────────────

export interface SuggestionView {
  id: string;
  analystId: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  title: string;
  rationale: string;
  evidence: Evidence;
  proposedDiff: ProposedDiff;
  sourceRunId: string | null;
  dismissReason: DismissReason | null;
  dismissNote: string | null;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface SuggestionBucket {
  pending: SuggestionView[];
  snoozed: SuggestionView[];
  resolved: SuggestionView[]; // approved | dismissed | expired
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

async function requireSuggestionForUser(id: string, userId: string) {
  const row = await prisma.suggestion.findFirst({
    where: { id, userId },
  });
  if (!row) throw new Error("Suggestion not found");
  return row;
}

function toView(row: {
  id: string;
  analystId: string;
  kind: string;
  status: string;
  title: string;
  rationale: string;
  evidence: unknown;
  proposedDiff: unknown;
  sourceRunId: string | null;
  dismissReason: string | null;
  dismissNote: string | null;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}): SuggestionView | null {
  // Re-parse evidence + proposedDiff. If the data was somehow corrupted
  // (schema drift between pass and render) drop the row rather than render
  // garbage — the caller filters nulls.
  const evidence = evidenceSchema.safeParse(row.evidence);
  const diff = proposedDiffSchema.safeParse(row.proposedDiff);
  if (!evidence.success || !diff.success) {
    console.warn(
      `[suggestion] row ${row.id} failed schema parse — skipping render. evidence=${evidence.success} diff=${diff.success}`,
    );
    return null;
  }

  return {
    id: row.id,
    analystId: row.analystId,
    kind: row.kind as SuggestionKind,
    status: row.status as SuggestionStatus,
    title: row.title,
    rationale: row.rationale,
    evidence: evidence.data,
    proposedDiff: diff.data,
    sourceRunId: row.sourceRunId,
    dismissReason: row.dismissReason as DismissReason | null,
    dismissNote: row.dismissNote,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
  };
}

// ── Listing ───────────────────────────────────────────────────────────────────

export async function listSuggestionsForAnalyst(
  analystId: string,
): Promise<SuggestionBucket> {
  const userId = await requireUserId();

  // Verify the analyst belongs to the current user. Otherwise a stray
  // analystId in the URL could expose another user's suggestions.
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
    select: { id: true },
  });
  if (!analyst) return { pending: [], snoozed: [], resolved: [] };

  const rows = await prisma.suggestion.findMany({
    where: { analystId, userId },
    // Order by createdAt only — we bucket by status in JS below. Sorting by
    // status alphabetically buried PENDING under APPROVED/DISMISSED, which
    // is safe given the 200-row cap but dangerous if anyone tightens that
    // limit later (PENDING rows could get truncated out of the page).
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const pending: SuggestionView[] = [];
  const snoozed: SuggestionView[] = [];
  const resolved: SuggestionView[] = [];

  for (const row of rows) {
    const view = toView(row);
    if (!view) continue;
    if (view.status === "PENDING") pending.push(view);
    else if (view.status === "SNOOZED") snoozed.push(view);
    else resolved.push(view);
  }

  return { pending, snoozed, resolved };
}

export async function countPendingSuggestionsForAnalyst(
  analystId: string,
): Promise<number> {
  const userId = await requireUserId();
  return prisma.suggestion.count({
    where: { analystId, userId, status: "PENDING" },
  });
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveSuggestion(id: string): Promise<void> {
  const userId = await requireUserId();
  const row = await requireSuggestionForUser(id, userId);

  if (row.status !== "PENDING" && row.status !== "SNOOZED") {
    throw new Error(`Suggestion ${id} is ${row.status} — cannot approve`);
  }

  const diffParse = proposedDiffSchema.safeParse(row.proposedDiff);
  if (!diffParse.success) {
    throw new Error(`Suggestion ${id} has malformed proposedDiff — cannot apply`);
  }

  // 1. Apply the change through the canonical write surfaces.
  await applyProposedDiff(diffParse.data, {
    analystId: row.analystId,
    userId,
  });

  // 2. Mark the row APPROVED with audit metadata.
  await prisma.suggestion.update({
    where: { id },
    data: {
      status: "APPROVED",
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
  });

  revalidatePath(`/analysts/${row.analystId}/suggestions`);
  revalidatePath(`/analysts/${row.analystId}`);
  revalidatePath("/analysts");
}

// ── Dismiss ───────────────────────────────────────────────────────────────────

export async function dismissSuggestion(
  id: string,
  reason: DismissReason,
  note?: string,
): Promise<void> {
  if (!DISMISS_REASONS.includes(reason)) {
    throw new Error(`Invalid dismiss reason: ${reason}`);
  }
  const userId = await requireUserId();
  const row = await requireSuggestionForUser(id, userId);

  if (row.status !== "PENDING" && row.status !== "SNOOZED") {
    throw new Error(`Suggestion ${id} is ${row.status} — cannot dismiss`);
  }

  const trimmedNote = note?.trim();
  await prisma.suggestion.update({
    where: { id },
    data: {
      status: "DISMISSED",
      dismissReason: reason,
      dismissNote: trimmedNote && trimmedNote.length > 0 ? trimmedNote.slice(0, 500) : null,
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
  });

  revalidatePath(`/analysts/${row.analystId}/suggestions`);
}

// ── Snooze ────────────────────────────────────────────────────────────────────

const SNOOZE_DAYS = 7;

export async function snoozeSuggestion(id: string): Promise<void> {
  const userId = await requireUserId();
  const row = await requireSuggestionForUser(id, userId);

  if (row.status !== "PENDING") {
    throw new Error(`Suggestion ${id} is ${row.status} — only PENDING can be snoozed`);
  }

  // Snooze extends expiresAt by 7 days from now and flips status. A snoozed
  // proposal still counts for dedup (so the next pass won't re-propose it)
  // but drops out of the main PENDING list. The user can come back to it
  // from the Resolved / Snoozed tab.
  const newExpiresAt = new Date(
    Math.max(row.expiresAt.getTime(), Date.now() + SNOOZE_DAYS * 86_400_000),
  );

  await prisma.suggestion.update({
    where: { id },
    data: {
      status: "SNOOZED",
      expiresAt: newExpiresAt,
    },
  });

  revalidatePath(`/analysts/${row.analystId}/suggestions`);
}

// ── Unsnooze (bring back into PENDING) ────────────────────────────────────────

export async function unsnoozeSuggestion(id: string): Promise<void> {
  const userId = await requireUserId();
  const row = await requireSuggestionForUser(id, userId);

  if (row.status !== "SNOOZED") {
    throw new Error(`Suggestion ${id} is ${row.status} — only SNOOZED can be unsnoozed`);
  }

  await prisma.suggestion.update({
    where: { id },
    data: { status: "PENDING" },
  });

  revalidatePath(`/analysts/${row.analystId}/suggestions`);
}
