/**
 * GET /api/theses/:id/analyst-coverage
 *
 * Returns the structured FMP analyst coverage for the thesis's ticker:
 * Bullish/Neutral/Bearish counts and the Low/Avg/Median/High price target
 * range. Powers the AnalystConsensusWidget visual on the ThesisSheet.
 *
 * Fresh fetch (FMP is cached at the network edge for 5 min via `revalidate`),
 * NOT a column on the thesis row — the data behind the visual changes daily
 * as firms revise targets and the widget should reflect "current" coverage,
 * not coverage-at-mint.
 *
 * Falls back gracefully on per-endpoint 403s (some FMP tiers gate the
 * consensus endpoint). Returns null fields with errors[] populated.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

const FMP_KEY = process.env.FMP_API_KEY!;

interface FmpResult<T> {
  data: T | null;
  error?: string;
}

async function fmp<T>(path: string): Promise<FmpResult<T>> {
  const url = `https://financialmodelingprep.com${path}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok)
      return { data: null, error: `FMP ${res.status} on ${path.split("?")[0]}` };
    const data = (await res.json()) as T;
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      "Error Message" in (data as object)
    ) {
      return {
        data: null,
        error: `FMP: ${(data as Record<string, string>)["Error Message"]}`,
      };
    }
    return { data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "fmp error" };
  }
}

interface PriceTargetConsensus {
  symbol?: string;
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}

interface PriceTargetSummary {
  symbol?: string;
  publishers?: number;
  numberOfAnalysts?: number;
}

interface UpgradeDowngradeRow {
  symbol: string;
  publishedDate: string;
  newGrade?: string;
  previousGrade?: string;
  gradingCompany?: string;
  action?: string;
}

function classifyRating(
  grade?: string | null,
): "BULL" | "NEUTRAL" | "BEAR" | "UNK" {
  if (!grade) return "UNK";
  const g = grade.toLowerCase();
  if (
    g.includes("buy") ||
    g.includes("outperform") ||
    g.includes("overweight") ||
    g.includes("positive") ||
    g.includes("accumulate") ||
    g.includes("strong")
  )
    return "BULL";
  if (
    g.includes("sell") ||
    g.includes("underperform") ||
    g.includes("underweight") ||
    g.includes("negative") ||
    g.includes("reduce")
  )
    return "BEAR";
  if (
    g.includes("hold") ||
    g.includes("neutral") ||
    g.includes("equal") ||
    g.includes("sector perform")
  )
    return "NEUTRAL";
  return "UNK";
}

export async function GET(
  _req: Request,
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
  if (!accountId)
    return NextResponse.json({ error: "No account" }, { status: 403 });

  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: { ticker: true },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const T = thesis.ticker.toUpperCase();

  const [consensusRes, summaryRes, updnRes] = await Promise.all([
    fmp<PriceTargetConsensus[]>(`/stable/price-target-consensus?symbol=${T}`),
    fmp<PriceTargetSummary[]>(`/stable/price-target-summary?symbol=${T}`),
    fmp<UpgradeDowngradeRow[]>(`/stable/upgrades-downgrades?symbol=${T}`),
  ]);

  const errors: string[] = [];
  if (consensusRes.error)
    errors.push(`price-target-consensus: ${consensusRes.error}`);
  if (summaryRes.error)
    errors.push(`price-target-summary: ${summaryRes.error}`);
  if (updnRes.error) errors.push(`upgrades-downgrades: ${updnRes.error}`);

  const consensusRow = consensusRes.data?.[0];
  const summaryRow = summaryRes.data?.[0];

  const priceTargets =
    consensusRow && consensusRow.targetConsensus != null
      ? {
          low: consensusRow.targetLow ?? null,
          average: consensusRow.targetConsensus,
          median: consensusRow.targetMedian ?? null,
          high: consensusRow.targetHigh ?? null,
          numAnalysts:
            summaryRow?.numberOfAnalysts ?? summaryRow?.publishers ?? null,
        }
      : null;

  // Build consensus from the most-recent action per firm over the last 90 days.
  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const recent = (updnRes.data ?? []).filter(
    (r) => (r.publishedDate ?? "").slice(0, 10) >= cutoffISO,
  );
  const latestByFirm = new Map<string, UpgradeDowngradeRow>();
  for (const r of recent) {
    const key = (r.gradingCompany ?? "Unknown").toLowerCase();
    const existing = latestByFirm.get(key);
    if (!existing || (r.publishedDate ?? "") > (existing.publishedDate ?? "")) {
      latestByFirm.set(key, r);
    }
  }
  let buy = 0,
    hold = 0,
    sell = 0,
    unk = 0;
  for (const r of latestByFirm.values()) {
    const c = classifyRating(r.newGrade);
    if (c === "BULL") buy++;
    else if (c === "NEUTRAL") hold++;
    else if (c === "BEAR") sell++;
    else unk++;
  }
  const total = buy + hold + sell + unk;
  const consensus =
    total > 0
      ? {
          buy,
          hold,
          sell,
          unknown: unk,
          total,
        }
      : null;

  return NextResponse.json({
    ticker: T,
    consensus,
    priceTargets,
    errors: errors.length > 0 ? errors : undefined,
  });
}
