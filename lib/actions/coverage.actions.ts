"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getLatestPrices } from "@/lib/alpaca";
import {
  resolveAlpacaCredentials,
  type AlpacaEnvironment,
} from "@/lib/actions/api-keys.actions";

// ─── Coverage Table data (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ─────────
//
// Read-only feed for the principal's main stock-overview, grouped by the clean
// post-P1-24 Thesis.status (HOLDING / WATCHING / PASSED). Phase-1 math only:
// "since [anchor]" compares a stored anchor price (entry / watch-add / pass)
// against the live quote. No candle history yet.
//
// Anchors per tab:
//   Active   (HOLDING)  → position.avgCost (held entry), else thesis.entryPrice.
//                         "since entry" = live vs anchor.
//   Watching (WATCHING) → thesis.entryPrice as the buy-above level; anchor for
//                         "since added" is also entryPrice (best available
//                         decision price until phase-2 decision-price capture).
//   Passed   (PASSED)   → the pass-moment quote (ThesisUpdate.priceAtTime on the
//                         most recent STATUS_CHANGED/UPDATED row), else
//                         thesis.entryPrice. Verdict (Dodged/Missed) is derived
//                         from move-direction-vs-pass, NOT raw green/red.
//
// TODO(phase-2): fixed 5d/10d/30d post-decision windows need Finnhub daily
// candles cached per-day + a clean decision-price stamped on the ThesisUpdate.
// See docs/plans/PORTFOLIO_DIGEST.md → Feature B → "The time math".

export type CoverageStatus = "HOLDING" | "WATCHING" | "PASSED";

/** Dodged = the pass was right (would-be loss avoided). Missed = regret. */
export type CoverageVerdict = "DODGED" | "MISSED" | "FLAT";

export interface CoverageRow {
  thesisId: string;
  ticker: string;
  status: CoverageStatus;
  /** "LONG" | "SHORT" | null (unresearched watch / pass with no view). */
  direction: string | null;
  analystName: string | null;
  /** Live (or last-resolved) quote. null when no price could be sourced. */
  currentPrice: number | null;
  /** The decision anchor: entry / buy-above / pass price. */
  anchorPrice: number | null;
  /** Move since anchor, in $ and %. null when either price is missing. */
  sinceDollar: number | null;
  sincePct: number | null;
  /** When the anchor was set (entry date / watch-add / pass date). */
  anchorAt: string;
  // ── Active only ──
  targetPrice: number | null;
  stopLoss: number | null;
  /** 0–1 progress from entry→target along the trade direction. null if unknown. */
  targetProximity: number | null;
  // ── Watching only ──
  /** Most recent REVIEWED/UPDATED timestamp, else anchorAt. */
  lastReviewedAt: string;
  // ── Passed only ──
  verdict: CoverageVerdict;
}

export interface CoverageData {
  active: CoverageRow[];
  watching: CoverageRow[];
  passed: CoverageRow[];
}

const EMPTY: CoverageData = { active: [], watching: [], passed: [] };

/**
 * Compute target-proximity as a 0–1 fraction of the entry→target gap traversed,
 * directionally. LONG: (cur−entry)/(target−entry). SHORT: (entry−cur)/(entry−target).
 * Clamped to [0,1]. null when any leg is missing or the gap is degenerate.
 */
function targetProximity(
  direction: string | null,
  entry: number | null,
  target: number | null,
  current: number | null,
): number | null {
  if (entry == null || target == null || current == null) return null;
  const gap = direction === "SHORT" ? entry - target : target - entry;
  if (gap <= 0) return null;
  const moved = direction === "SHORT" ? entry - current : current - entry;
  return Math.max(0, Math.min(1, moved / gap));
}

/**
 * Verdict for a PASSED thesis. A pass on a LONG idea is "right" (DODGED) if the
 * stock fell; "wrong" (MISSED) if it rose. A pass on a SHORT idea inverts. With
 * no stored direction, fall back to treating any rise-since-pass as regret
 * (the long-bias default the spec describes: "a passed stock going UP is regret").
 */
function passVerdict(
  direction: string | null,
  sincePct: number | null,
): CoverageVerdict {
  if (sincePct == null || sincePct === 0) return "FLAT";
  const rose = sincePct > 0;
  if (direction === "SHORT") return rose ? "DODGED" : "MISSED";
  return rose ? "MISSED" : "DODGED";
}

export async function getCoverageData(
  environment: AlpacaEnvironment = "PAPER",
): Promise<CoverageData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const accountId = await getAccountId(user.id);
  if (!accountId) return EMPTY;

  // ── DB reads (independent → parallel) ──────────────────────────────────────
  const [theses, openPositions, alpacaCreds] = await Promise.all([
    prisma.thesis.findMany({
      where: {
        accountId,
        status: { in: ["HOLDING", "WATCHING", "PASSED"] },
        researchRun: { environment },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        ticker: true,
        status: true,
        direction: true,
        entryPrice: true,
        targetPrice: true,
        stopLoss: true,
        createdAt: true,
        updatedAt: true,
        researchRun: {
          select: { agentConfig: { select: { name: true } } },
        },
        // Most-recent audit row carrying a resolved price — used as the pass
        // anchor and the "since last review" timestamp.
        updates: {
          where: { type: { in: ["STATUS_CHANGED", "UPDATED", "REVIEWED"] } },
          orderBy: { timestamp: "desc" },
          take: 1,
          select: { timestamp: true, priceAtTime: true },
        },
      },
    }).catch(() => [] as never[]),
    prisma.position.findMany({
      where: { accountId, status: "OPEN", environment },
      select: { symbol: true, avgCost: true, direction: true },
    }).catch(() => [] as never[]),
    resolveAlpacaCredentials(user.id, environment)
      .then((c) => c ?? undefined)
      .catch(() => undefined),
  ]);

  if (theses.length === 0) return EMPTY;

  // ── Live quotes (one batch) ────────────────────────────────────────────────
  const tickers = Array.from(new Set(theses.map((t) => t.ticker)));
  const prices = await getLatestPrices(tickers, alpacaCreds).catch(
    () => ({}) as Record<string, number>,
  );

  const positionBySymbol = new Map(openPositions.map((p) => [p.symbol, p]));

  const rows: CoverageRow[] = theses.map((t) => {
    const status = t.status as CoverageStatus;
    const pos = positionBySymbol.get(t.ticker);
    const current = prices[t.ticker] ?? null;
    const lastUpdate = t.updates[0];

    // Anchor selection by tab.
    let anchorPrice: number | null;
    let anchorAt: string;
    if (status === "HOLDING") {
      anchorPrice = pos?.avgCost ?? t.entryPrice ?? null;
      anchorAt = t.createdAt.toISOString();
    } else if (status === "PASSED") {
      anchorPrice = lastUpdate?.priceAtTime ?? t.entryPrice ?? null;
      anchorAt = (lastUpdate?.timestamp ?? t.updatedAt).toISOString();
    } else {
      // WATCHING — buy-above level doubles as the anchor.
      anchorPrice = t.entryPrice ?? null;
      anchorAt = t.createdAt.toISOString();
    }

    // Raw price move since the anchor.
    const rawSinceDollar =
      current != null && anchorPrice != null ? current - anchorPrice : null;
    const rawSincePct =
      rawSinceDollar != null && anchorPrice != null && anchorPrice !== 0
        ? (rawSinceDollar / anchorPrice) * 100
        : null;
    // On a HELD position "since entry" means P&L, so a SHORT gains when price
    // falls — flip the sign. WATCHING/PASSED keep the raw price move (the pass
    // verdict already accounts for direction separately, below).
    const pnlSign = status === "HOLDING" && t.direction === "SHORT" ? -1 : 1;
    const sinceDollar = rawSinceDollar != null ? rawSinceDollar * pnlSign : null;
    const sincePct = rawSincePct != null ? rawSincePct * pnlSign : null;

    return {
      thesisId: t.id,
      ticker: t.ticker,
      status,
      direction: t.direction ?? null,
      analystName: t.researchRun?.agentConfig?.name ?? null,
      currentPrice: current,
      anchorPrice,
      sinceDollar,
      sincePct,
      anchorAt,
      targetPrice: t.targetPrice ?? null,
      stopLoss: t.stopLoss ?? null,
      targetProximity: targetProximity(
        t.direction ?? null,
        anchorPrice,
        t.targetPrice ?? null,
        current,
      ),
      lastReviewedAt: (lastUpdate?.timestamp ?? t.updatedAt).toISOString(),
      verdict:
        status === "PASSED"
          ? passVerdict(t.direction ?? null, sincePct)
          : "FLAT",
    };
  });

  return {
    active: rows.filter((r) => r.status === "HOLDING"),
    watching: rows.filter((r) => r.status === "WATCHING"),
    passed: rows.filter((r) => r.status === "PASSED"),
  };
}
