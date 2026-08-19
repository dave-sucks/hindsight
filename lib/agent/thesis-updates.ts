/**
 * Thesis activity log helper — single chokepoint for writing ThesisUpdate
 * rows. Every state change on a Thesis must go through this so the
 * timeline stays the source of truth (no scattered RunEvent.payload
 * shenanigans).
 *
 * Capture pattern:
 *   1. Caller knows what changed (a diff) and why (summary + rationale).
 *   2. This helper resolves CONTEXT AT THE TIME — current price + position
 *      state — without forcing every caller to fetch them. If we can't
 *      resolve, we leave them null rather than blocking the write.
 *   3. Single write to ThesisUpdate. Failures here are non-fatal — the
 *      thesis state change still landed; we just lost the log row.
 *      That's the right tradeoff: never lose a thesis transition because
 *      the activity log had a hiccup.
 *
 * The helper INTENTIONALLY does not update Thesis itself. That's the
 * caller's job. This keeps the data flow obvious: caller mutates Thesis,
 * then logs the mutation.
 */

import { prisma } from "@/lib/prisma";

export type ThesisUpdateType =
  | "CREATED"
  | "UPDATED"
  | "TRIGGER_FIRED"
  | "REVIEWED"
  | "ACTED"
  | "INVALIDATED"
  | "CLOSED"
  | "SUPERSEDED"
  | "STATUS_CHANGED"
  // Trade-as-Proposal — durable audit of the human-approval lifecycle
  // on agent-initiated buys/sells. The agent reads these on its next run
  // via get_theses(include_history: true) and adapts (does not re-propose
  // recently-rejected setups unless the stated reason has materially
  // changed). See docs/plans/TRADE_AS_PROPOSAL.md.
  | "PROPOSAL_APPROVED"
  | "PROPOSAL_REJECTED"
  | "PROPOSAL_EXPIRED";

/**
 * Diff payload shape for `fieldChanges`. Each key is a Thesis column name;
 * each value is { from, to }. Columns can hold any JSON-safe shape, hence
 * unknown.
 */
export type ThesisFieldChanges = Record<
  string,
  { from: unknown; to: unknown }
>;

export interface PositionSnapshot {
  qty: number;
  avgCost: number;
  unrealizedPnL: number | null;
}

interface WriteThesisUpdateInput {
  thesisId: string;
  type: ThesisUpdateType;
  summary: string;
  fieldChanges?: ThesisFieldChanges;
  rationale?: string;
  triggerId?: string;
  signalIds?: string[];
  runId?: string | null;
  tradeId?: string;
  /**
   * Current price for this ticker. If omitted, the helper attempts to
   * resolve via the ticker on the Thesis row → Position.lastPrice (cheap)
   * → null. Pass explicitly when you already have a fresh quote.
   */
  priceAtTime?: number | null;
  /**
   * Position state snapshot. If omitted, helper resolves via the analyst's
   * open Position for this ticker, if any. null = explicitly no position.
   */
  positionAtTime?: PositionSnapshot | null;
}

/**
 * Write a single ThesisUpdate row. Returns the created row's id, or null
 * on failure (logged but never thrown — see header comment).
 */
export async function writeThesisUpdate(
  input: WriteThesisUpdateInput,
): Promise<string | null> {
  try {
    // Resolve context if not supplied. Caller must pass priceAtTime
    // explicitly when they have one — Position rows don't carry a
    // live last-price in this schema, and we don't want this helper
    // hitting the quote API on every write.
    const priceAtTime = input.priceAtTime ?? null;
    let positionAtTime = input.positionAtTime;

    if (positionAtTime === undefined) {
      const thesis = await prisma.thesis
        .findUnique({
          where: { id: input.thesisId },
          select: { ticker: true, userId: true },
        })
        .catch(() => null);

      if (thesis) {
        const position = await prisma.position
          .findFirst({
            where: {
              userId: thesis.userId,
              symbol: thesis.ticker,
              status: "OPEN",
            },
            select: { quantity: true, avgCost: true, peakPrice: true },
            orderBy: { createdAt: "desc" },
          })
          .catch(() => null);

        positionAtTime = position
          ? {
              qty: position.quantity,
              avgCost: position.avgCost,
              // Without a live quote we can't compute true unrealized P&L
              // here; leave null. Callers that DO have a fresh price should
              // pass positionAtTime explicitly with unrealizedPnL filled in.
              unrealizedPnL: null,
            }
          : null;
      }
    }

    const row = await prisma.thesisUpdate.create({
      data: {
        thesisId: input.thesisId,
        type: input.type,
        fieldChanges: (input.fieldChanges ?? {}) as object,
        priceAtTime: priceAtTime ?? null,
        positionAtTime: positionAtTime
          ? (positionAtTime as unknown as object)
          : positionAtTime === null
            ? undefined // store as DB null via undefined
            : undefined,
        summary: input.summary,
        rationale: input.rationale ?? null,
        triggerId: input.triggerId ?? null,
        signalIds: input.signalIds ?? [],
        runId: input.runId ?? null,
        tradeId: input.tradeId ?? null,
      },
      select: { id: true },
    });

    return row.id;
  } catch (err) {
    // Don't throw — the calling thesis transition already happened. Log
    // loudly because every dropped update row is a hole in the timeline.
    console.error(
      `[thesis-updates] writeThesisUpdate FAILED for thesis=${input.thesisId} type=${input.type}:`,
      err,
    );
    return null;
  }
}

/**
 * Compute a fieldChanges diff between two snapshots of the same Thesis.
 * Only fields that actually changed appear in the result. Use for
 * UPDATED rows; CREATED rows pass {} (no prior state).
 */
export function diffThesisFields(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: string[],
): ThesisFieldChanges {
  const out: ThesisFieldChanges = {};
  for (const f of fields) {
    const a = prev[f];
    const b = next[f];
    // Coarse equality — JSON.stringify handles arrays/objects/null.
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[f] = { from: a ?? null, to: b ?? null };
    }
  }
  return out;
}

/**
 * Compact one diff value to a short preview for storage in `fieldChanges`.
 * The V2 research/narrative JSONB sections can be several KB each — storing
 * two full copies per UPDATED row would bloat ThesisUpdate without serving
 * any consumer (the timeline renders "section refreshed", not a research
 * diff). Values that already fit pass through untouched; only oversized
 * ones are reduced to a preview string.
 */
export function compactDiffValue(v: unknown, maxLen = 160): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    return v.length > maxLen ? `${v.slice(0, maxLen)}…` : v;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // { text, citations } narrative shape (snapshot).
    if (typeof o.text === "string") return compactDiffValue(o.text, maxLen);
    // { bullets: [{ text }...] } shape (bullCase / bearCase / sections).
    if (Array.isArray(o.bullets)) {
      const first = o.bullets[0] as { text?: unknown } | undefined;
      const firstText =
        typeof first?.text === "string"
          ? String(compactDiffValue(first.text, 100))
          : "";
      const n = o.bullets.length;
      return `${n} bullet${n === 1 ? "" : "s"}${firstText ? ` — ${firstText}` : ""}`;
    }
  }
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : v;
}

/**
 * Apply compactDiffValue to the from/to of the named keys, leaving every
 * other entry untouched. Used by update_thesis on the bulky research and
 * narrative section keys — scalars (targetPrice, stopLoss, …) and the
 * trigger arrays keep exact values, because the timeline renders those
 * from/to numbers directly ("floor 64 → 71").
 */
export function compactFieldChanges(
  fc: ThesisFieldChanges,
  bulkyKeys: readonly string[],
): ThesisFieldChanges {
  const out: ThesisFieldChanges = { ...fc };
  for (const k of bulkyKeys) {
    const entry = out[k];
    if (entry) {
      out[k] = {
        from: compactDiffValue(entry.from),
        to: compactDiffValue(entry.to),
      };
    }
  }
  return out;
}
