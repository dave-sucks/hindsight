/**
 * activity — the ONE read-layer for "what happened", merged from the tables
 * that each record a slice of it. No new storage; this is a typed, tier-ranked
 * view over existing rows (read-layer-first — prove the taxonomy before any
 * schema change).
 *
 * The tier hierarchy (what the user actually needs insight into, in order):
 *   1  buys / sells / adds / trims   — source of truth: Order (intent + fills)
 *   2  price-target / stop changes   — source of truth: PositionManagementAction
 *                                      (structured prev→new), deduping the
 *                                      duplicate copies in PositionEvent and
 *                                      ThesisUpdate.fieldChanges
 *   3  thesis minted / status change — ThesisUpdate CREATED / STATUS_CHANGED
 *   4  reviewed-no-change / misc     — ThesisUpdate REVIEWED etc. (low signal)
 *
 * Why Order is tier 1's source: it's the only table with true buy/sell/add/
 * trim semantics AND real fill prices. Every feed previously re-derived
 * opens/closes from Position scalars or PMA rows and never read Order at all.
 * PMA trade rows (FULL_CLOSE / PARTIAL_CLOSE / ADD_TO_POSITION) are used only
 * to enrich the matching Order event with the agent's `reason` (matched via
 * alpacaOrderId), and emitted as a fallback event only when no FILLED order
 * covers them (legacy data recorded before Order rows existed).
 */
import { prisma } from "@/lib/prisma";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivityKind =
  | "BUY" // opened a position (Order intent OPEN)
  | "ADD" // scaled in (intent ADD)
  | "SELL" // full close (intent CLOSE)
  | "TRIM" // partial close (intent PARTIAL_CLOSE)
  | "LEVELS_CHANGED" // target / stop / trailing-stop moved
  | "THESIS_MINTED"
  | "STATUS_CHANGED"
  | "REVIEWED"
  | "UPDATED"; // substantive thesis update that didn't touch price levels

export interface ActivityLevelChange {
  field: "target" | "stop" | "trailPct";
  from: number | null;
  to: number | null;
}

export interface ActivityEvent {
  /** Source-prefixed stable id: order_* | pma_* | tu_* */
  id: string;
  tier: 1 | 2 | 3 | 4;
  kind: ActivityKind;
  at: string; // ISO
  ticker: string;
  /** Human one-liner ("Bought 7 shares at $418.89"). */
  summary: string;
  qty: number | null;
  price: number | null;
  /** Tier-2 structured changes ("Target $340 → $360 · Stop moved to $300"). */
  changes: ActivityLevelChange[] | null;
  /** The actor's stated reasoning (PMA.reason / Order.rationale / TU.rationale). */
  reason: string | null;
  source: "agent" | "price_monitor" | "user" | null;
  positionId: string | null;
  thesisId: string | null;
  orderId: string | null;
  runId: string | null;
}

// ── Builders ─────────────────────────────────────────────────────────────────

const INTENT_KIND: Record<string, ActivityKind> = {
  OPEN: "BUY",
  ADD: "ADD",
  CLOSE: "SELL",
  PARTIAL_CLOSE: "TRIM",
};

const KIND_VERB: Record<string, string> = {
  BUY: "Bought",
  ADD: "Added",
  SELL: "Sold",
  TRIM: "Trimmed",
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const qtyStr = (n: number) =>
  `${Number.isInteger(n) ? n : n.toFixed(2)} ${n === 1 ? "share" : "shares"}`;

function levelChangeSummary(changes: ActivityLevelChange[]): string {
  return changes
    .map((c) => {
      const label =
        c.field === "target" ? "Target" : c.field === "stop" ? "Stop" : "Trail";
      const to =
        c.to == null ? "—" : c.field === "trailPct" ? `${c.to}%` : usd(c.to);
      const from =
        c.from == null ? null : c.field === "trailPct" ? `${c.from}%` : usd(c.from);
      return from ? `${label} ${from} → ${to}` : `${label} set to ${to}`;
    })
    .join(" · ");
}

// ── The read-layer ───────────────────────────────────────────────────────────

/**
 * All activity for one position, tier-ranked, newest first. Powers the trade
 * page's Activity tab (and the sheet's trade-scoped activity once the trade
 * page folds into it). Thesis- and account-scoped variants build on the same
 * event shape.
 */
export async function getPositionActivity(
  positionId: string,
): Promise<ActivityEvent[]> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    select: {
      id: true,
      symbol: true,
      orders: { orderBy: { createdAt: "asc" } },
      managementActions: { orderBy: { createdAt: "asc" } },
      decisions: {
        take: 1,
        select: { thesis: { select: { id: true } } },
      },
    },
  });
  if (!position) return [];
  const ticker = position.symbol.toUpperCase();
  const thesisId = position.decisions[0]?.thesis?.id ?? null;

  const events: ActivityEvent[] = [];

  // ── Tier 1 — executed trades, from Order ──────────────────────────────────
  // PMA trade rows keyed by alpacaOrderId for reason-enrichment + dedupe.
  const TRADE_ACTIONS = new Set(["FULL_CLOSE", "PARTIAL_CLOSE", "ADD_TO_POSITION"]);
  const pmaByAlpacaId = new Map(
    position.managementActions
      .filter((a) => TRADE_ACTIONS.has(a.actionType) && a.alpacaOrderId)
      .map((a) => [a.alpacaOrderId as string, a]),
  );
  const coveredPmaIds = new Set<string>();

  for (const o of position.orders) {
    if (o.status !== "FILLED") continue; // proposals/cancels aren't activity
    const kind = INTENT_KIND[o.intent ?? ""] ?? (o.side === "BUY" ? "BUY" : "SELL");
    const pma = o.alpacaOrderId ? pmaByAlpacaId.get(o.alpacaOrderId) : undefined;
    if (pma) coveredPmaIds.add(pma.id);
    const qty = o.filledQty ?? o.quantity;
    const price = o.filledPrice;
    events.push({
      id: `order_${o.id}`,
      tier: 1,
      kind,
      at: (o.filledAt ?? o.createdAt).toISOString(),
      ticker,
      summary: `${KIND_VERB[kind]} ${qtyStr(qty)}${price != null ? ` at ${usd(price)}` : ""}`,
      qty,
      price: price ?? null,
      changes: null,
      reason: pma?.reason ?? o.rationale ?? null,
      source:
        (pma?.source as ActivityEvent["source"]) ??
        (o.closeSource as ActivityEvent["source"]) ??
        null,
      positionId: position.id,
      thesisId,
      orderId: o.id,
      runId: pma?.runId ?? null,
    });
  }

  // ── Tier 2 — level changes, from PositionManagementAction ─────────────────
  // (PositionEvent's TARGET_UPDATED/STOP_MOVED rows are duplicates of these —
  // manage_position writes both — so PMA alone covers tier 2.)
  for (const a of position.managementActions) {
    if (TRADE_ACTIONS.has(a.actionType)) {
      // Trade-shaped PMA row: emit only if no FILLED order covered it (legacy
      // rows from before Orders existed, or price-monitor direct closes).
      if (coveredPmaIds.has(a.id)) continue;
      const kind =
        a.actionType === "ADD_TO_POSITION"
          ? "ADD"
          : a.actionType === "PARTIAL_CLOSE"
            ? "TRIM"
            : "SELL";
      const qty = a.fillQty ?? (a.prevQty != null && a.newQty != null ? Math.abs(a.prevQty - a.newQty) : null);
      events.push({
        id: `pma_${a.id}`,
        tier: 1,
        kind,
        at: a.createdAt.toISOString(),
        ticker,
        summary: `${KIND_VERB[kind]} ${qty != null ? qtyStr(qty) : ticker}${a.fillPrice != null ? ` at ${usd(a.fillPrice)}` : ""}`,
        qty,
        price: a.fillPrice ?? null,
        changes: null,
        reason: a.reason,
        source: (a.source as ActivityEvent["source"]) ?? null,
        positionId: position.id,
        thesisId,
        orderId: null,
        runId: a.runId ?? null,
      });
      continue;
    }

    const changes: ActivityLevelChange[] = [];
    if (a.newTargetPrice != null && a.newTargetPrice !== a.prevTargetPrice)
      changes.push({ field: "target", from: a.prevTargetPrice, to: a.newTargetPrice });
    if (a.newStopLoss != null && a.newStopLoss !== a.prevStopLoss)
      changes.push({ field: "stop", from: a.prevStopLoss, to: a.newStopLoss });
    if (a.newTrailPct != null && a.newTrailPct !== a.prevTrailPct)
      changes.push({ field: "trailPct", from: a.prevTrailPct, to: a.newTrailPct });
    if (changes.length === 0) continue; // nothing actually moved

    events.push({
      id: `pma_${a.id}`,
      tier: 2,
      kind: "LEVELS_CHANGED",
      at: a.createdAt.toISOString(),
      ticker,
      summary: levelChangeSummary(changes),
      qty: null,
      price: null,
      changes,
      reason: a.reason,
      source: (a.source as ActivityEvent["source"]) ?? null,
      positionId: position.id,
      thesisId,
      orderId: null,
      runId: a.runId ?? null,
    });
  }

  // ── Tier 3 — thesis minted (context for "why does this trade exist") ──────
  if (thesisId) {
    const minted = await prisma.thesisUpdate.findFirst({
      where: { thesisId, type: "CREATED" },
      orderBy: { timestamp: "asc" },
      select: { id: true, timestamp: true, summary: true, runId: true },
    });
    if (minted) {
      events.push({
        id: `tu_${minted.id}`,
        tier: 3,
        kind: "THESIS_MINTED",
        at: minted.timestamp.toISOString(),
        ticker,
        summary: minted.summary || "Thesis created",
        qty: null,
        price: null,
        changes: null,
        reason: null,
        source: "agent",
        positionId: position.id,
        thesisId,
        orderId: null,
        runId: minted.runId ?? null,
      });
    }
  }

  // Newest first — the feed reads top-down as "most recent".
  return events.sort((x, y) => y.at.localeCompare(x.at));
}
