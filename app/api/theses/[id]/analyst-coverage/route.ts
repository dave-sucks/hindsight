/**
 * GET /api/theses/:id/analyst-coverage
 *
 * Returns the structured analyst coverage for the thesis's ticker:
 * a standing Bullish/Neutral/Bearish ratings snapshot (Finnhub) and the
 * Low/Avg/Median/High consensus price target range (FMP). Powers the
 * AnalystConsensusWidget visual on the ThesisSheet.
 *
 * Fresh fetch on every sheet open. The two providers answer different
 * questions:
 *   - Finnhub `/stock/recommendation` is a STANDING snapshot — across the
 *     firms currently covering this stock, how many sit at buy / hold /
 *     sell right now. Returns one record per month; we read the latest.
 *     This is the right shape for the "5 Bearish · 5 Neutral · 1 Bullish"
 *     distribution bar (the prior implementation used FMP's
 *     `/stable/upgrades-downgrades`, which is a rating-CHANGE event log
 *     and returned empty for quiet stocks — wrong shape entirely).
 *   - FMP `/stable/price-target-consensus` is also a snapshot but for
 *     price targets specifically: targetHigh / targetLow / targetConsensus
 *     / targetMedian aggregated across covering firms.
 *
 * Both fields are nullable. If a provider returns nothing the widget hides
 * that row only; the rest still renders.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getRecommendationTrends } from "@/lib/actions/finnhub.actions";

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

  const [consensusRes, summaryRes, finnhubTrends] = await Promise.all([
    fmp<PriceTargetConsensus[]>(`/stable/price-target-consensus?symbol=${T}`),
    fmp<PriceTargetSummary[]>(`/stable/price-target-summary?symbol=${T}`),
    getRecommendationTrends(T).catch(() => null),
  ]);

  const errors: string[] = [];
  if (consensusRes.error)
    errors.push(`price-target-consensus: ${consensusRes.error}`);
  if (summaryRes.error)
    errors.push(`price-target-summary: ${summaryRes.error}`);

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

  // Finnhub returns one record per month (most-recent first). The latest
  // record is the current standing ratings snapshot — `strongBuy` + `buy`
  // collapses into Bullish, `hold` is Neutral, `sell` + `strongSell` is
  // Bearish. Same 3-bucket shape the widget renders.
  const latest = finnhubTrends?.[0];
  const consensus = latest
    ? (() => {
        const bull = (latest.strongBuy ?? 0) + (latest.buy ?? 0);
        const neutral = latest.hold ?? 0;
        const bear = (latest.sell ?? 0) + (latest.strongSell ?? 0);
        const total = bull + neutral + bear;
        return total > 0
          ? { buy: bull, hold: neutral, sell: bear, unknown: 0, total, period: latest.period ?? null }
          : null;
      })()
    : null;
  if (finnhubTrends == null)
    errors.push("finnhub /stock/recommendation: no data");

  return NextResponse.json({
    ticker: T,
    consensus,
    priceTargets,
    errors: errors.length > 0 ? errors : undefined,
  });
}
