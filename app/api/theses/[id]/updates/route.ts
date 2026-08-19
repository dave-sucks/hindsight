/**
 * GET /api/theses/:id/updates
 *
 * Returns the activity log for one thesis, newest-first. Powers the
 * Activity tab inside ThesisSheet. Scoped to the requesting user —
 * never returns another user's thesis history.
 *
 * Two sources, merged into one timeline (P1-33):
 *
 *  1. ThesisUpdate rows — trigger fires, reviews, edits, status changes.
 *  2. Proposal outcomes synthesized from the ORDER table — the source of
 *     truth for approve / reject (+ note) / expire. The ThesisUpdate copies
 *     of these were dropped ~78% of the time by the fire-and-forget bug
 *     (fixed in the same PR that added this merge), and rows written before
 *     the fix are incomplete forever — so the tab never trusts them. Any
 *     PROPOSAL_* ThesisUpdate row whose orderId matches a synthesized event
 *     is deduped out in favor of the Order-derived one.
 *
 * Order → thesis resolution: `Order.thesisId` when populated (rows created
 * after 2026-08-18), else the (analyst, ticker) fallback bounded to the
 * thesis's lifetime — the bound keeps a re-minted ticker (XENE-style) from
 * inheriting its predecessor's proposal history.
 *
 * Query: ?limit=N (default 50, max 200).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

interface TimelineEvent {
  id: string;
  timestamp: Date | string;
  type: string;
  summary: string;
  rationale: string | null;
  fieldChanges: unknown;
  priceAtTime: number | null;
  positionAtTime: unknown;
  triggerId: string | null;
  signalIds: string[];
  runId: string | null;
  tradeId: string | null;
}

/** Pull every orderId mentioned in a PROPOSAL_* row's fieldChanges. */
function proposalOrderId(fieldChanges: unknown): string | null {
  const fc = fieldChanges as
    | { proposal?: { from?: { orderId?: unknown }; to?: { orderId?: unknown } } }
    | null;
  const oid = fc?.proposal?.to?.orderId ?? fc?.proposal?.from?.orderId;
  return typeof oid === "string" ? oid : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  // Verify ownership via Thesis.accountId before exposing updates. We don't
  // index ThesisUpdate by accountId — the join through Thesis is the only
  // scope check.
  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      ticker: true,
      createdAt: true,
      closedAt: true,
      invalidatedAt: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );

  const updates = await prisma.thesisUpdate.findMany({
    where: { thesisId: id },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      id: true,
      timestamp: true,
      type: true,
      summary: true,
      rationale: true,
      fieldChanges: true,
      priceAtTime: true,
      positionAtTime: true,
      triggerId: true,
      signalIds: true,
      runId: true,
      tradeId: true,
    },
  });

  // ── Proposal outcomes from the Order table (source of truth) ─────────────
  // `expiresAt != null` marks an order that went through the approval seam
  // (maybeAwaitApproval stamps it at staging) — plain non-gated fills never
  // carry it and already surface as STATUS_CHANGED / CLOSED thesis rows.
  const analystId = thesis.researchRun?.agentConfigId ?? null;
  const terminalAt = thesis.closedAt ?? thesis.invalidatedAt ?? null;
  // Close-side paperwork (expiry timestamps, approval confirms) can land
  // shortly after the thesis retires — the CLOSE approval itself is what
  // retires it. Give ONLY close intents a 3-day post-terminal grace; an
  // OPEN/ADD created after this thesis died belongs to its successor
  // (verified on XENE: the 07-17 re-mint's buy sat 21h inside a blanket
  // grace window and would have shown on the retired thesis too).
  const graceEnd = terminalAt
    ? new Date(terminalAt.getTime() + 3 * 86_400_000)
    : null;
  const fallbackBase = analystId
    ? {
        thesisId: null,
        symbol: thesis.ticker,
        position: { analystId },
      }
    : null;
  const proposalOrders = await prisma.order.findMany({
    where: {
      expiresAt: { not: null },
      OR: [
        { thesisId: id },
        ...(fallbackBase
          ? [
              {
                ...fallbackBase,
                createdAt: {
                  gte: thesis.createdAt,
                  ...(terminalAt ? { lte: terminalAt } : {}),
                },
              },
            ]
          : []),
        ...(fallbackBase && terminalAt && graceEnd
          ? [
              {
                ...fallbackBase,
                intent: { in: ["CLOSE", "PARTIAL_CLOSE"] },
                createdAt: { gt: terminalAt, lte: graceEnd },
              },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      intent: true,
      side: true,
      quantity: true,
      symbol: true,
      rationale: true,
      rejectionMessage: true,
      expiresAt: true,
      alpacaConfirmedAt: true,
      createdAt: true,
      updatedAt: true,
      positionId: true,
    },
  });

  const synthesized: TimelineEvent[] = [];
  const coveredOrderIds = new Set<string>();
  for (const o of proposalOrders) {
    const intent = o.intent ?? "OPEN";
    const qty = ` — ${o.side === "BUY" ? "buy" : "sell"} ${o.quantity} sh`;
    const base = {
      rationale: o.rationale,
      fieldChanges: {
        proposal: {
          from: { orderId: o.id, status: "AWAITING_APPROVAL" },
          to: {
            orderId: o.id,
            status: o.status,
            intent,
            quantity: o.quantity,
            userMessage: o.rejectionMessage,
          },
        },
      },
      priceAtTime: null,
      positionAtTime: null,
      triggerId: null,
      signalIds: [] as string[],
      runId: null,
      tradeId: o.positionId,
    };
    coveredOrderIds.add(o.id);
    if (o.status === "AWAITING_APPROVAL") {
      synthesized.push({
        ...base,
        id: `order:${o.id}:pending`,
        timestamp: o.createdAt,
        type: "PROPOSAL_PENDING",
        summary: `Proposed ${intent} on ${o.symbol}${qty} — awaiting review`,
      });
    } else if (o.status === "REJECTED") {
      synthesized.push({
        ...base,
        rationale: o.rejectionMessage ?? o.rationale,
        id: `order:${o.id}:rejected`,
        timestamp: o.alpacaConfirmedAt ?? o.updatedAt,
        type: "PROPOSAL_REJECTED",
        summary: `Rejected ${intent} proposal on ${o.symbol}${qty}`,
      });
    } else if (o.status === "EXPIRED") {
      synthesized.push({
        ...base,
        id: `order:${o.id}:expired`,
        timestamp: o.expiresAt ?? o.updatedAt,
        type: "PROPOSAL_EXPIRED",
        summary: `${intent} proposal on ${o.symbol} expired without decision`,
      });
    } else {
      // PENDING / FILLED / CANCELLED after approval — the approve moment.
      synthesized.push({
        ...base,
        id: `order:${o.id}:approved`,
        timestamp: o.alpacaConfirmedAt ?? o.updatedAt,
        type: "PROPOSAL_APPROVED",
        summary: `Approved ${intent} on ${o.symbol}${qty}`,
      });
    }
  }

  // Dedup: drop ThesisUpdate PROPOSAL_* copies whose order is covered by a
  // synthesized event; keep any that reference an unknown order (defensive).
  const kept: TimelineEvent[] = updates.filter((u) => {
    if (!u.type.startsWith("PROPOSAL_")) return true;
    const oid = proposalOrderId(u.fieldChanges);
    return oid == null || !coveredOrderIds.has(oid);
  });

  const merged = [...kept, ...synthesized]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, limit);

  return NextResponse.json({ updates: merged });
}
