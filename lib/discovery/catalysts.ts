/**
 * Catalyst scanning — forward-looking event aggregation.
 * NO LLM calls. Aggregates earnings, economic events, insider buying, analyst actions.
 */

import type {
  Catalyst,
  CatalystType,
  DirectionBias,
  ImpactLevel,
  ScanCatalystsResult,
  ToolSource,
} from "@/lib/discovery/types";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const FMP_KEY = process.env.FMP_API_KEY!;

// ── Fetch helpers (same pattern as themes.ts) ─────────────────────────────

async function finnhubFetch<T>(path: string): Promise<T | null> {
  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      console.warn(`[catalysts] Finnhub ${path.split("?")[0]} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[catalysts] Finnhub ${path.split("?")[0]} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function fmpFetch<T>(path: string): Promise<T | null> {
  const base = path.startsWith("/v4/")
    ? `https://financialmodelingprep.com/api${path}`
    : `https://financialmodelingprep.com/api/v3${path}`;
  const url = `${base}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      console.warn(`[catalysts] FMP ${path.split("?")[0]} returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && !Array.isArray(data) && "Error Message" in data) {
      console.warn(`[catalysts] FMP ${path.split("?")[0]}: ${(data as Record<string, string>)["Error Message"]}`);
      return null;
    }
    return data as T;
  } catch (err) {
    console.warn(`[catalysts] FMP ${path.split("?")[0]} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Source fetchers ───────────────────────────────────────────────────────

async function fetchEarningsCatalysts(
  from: string,
  to: string,
): Promise<{ catalysts: Catalyst[]; source: ToolSource | null }> {
  const data = await finnhubFetch<{
    earningsCalendar?: {
      symbol: string;
      date: string;
      epsEstimate: number | null;
      epsActual: number | null;
      revenueEstimate: number | null;
      hour: string;
    }[];
  }>(`/calendar/earnings?from=${from}&to=${to}`);

  if (!data?.earningsCalendar?.length) {
    return { catalysts: [], source: null };
  }

  const catalysts: Catalyst[] = data.earningsCalendar.map((e) => {
    const isPast = e.date < isoDate(new Date());
    const hasBeat = e.epsActual != null && e.epsEstimate != null && e.epsActual > e.epsEstimate;

    let details = "";
    if (isPast && e.epsActual != null) {
      details = `Reported EPS $${e.epsActual.toFixed(2)}`;
      if (e.epsEstimate != null) details += ` vs est $${e.epsEstimate.toFixed(2)}`;
      if (hasBeat) details += " (BEAT)";
    } else {
      details = e.epsEstimate != null
        ? `Earnings${e.hour === "bmo" ? " (pre-market)" : e.hour === "amc" ? " (after-close)" : ""}, EPS est $${e.epsEstimate.toFixed(2)}`
        : `Earnings report${e.hour === "bmo" ? " (pre-market)" : e.hour === "amc" ? " (after-close)" : ""}`;
    }

    return {
      ticker: e.symbol,
      catalyst_type: "EARNINGS" as CatalystType,
      date: e.date,
      expected_impact: "HIGH" as ImpactLevel,
      direction_bias: (isPast && hasBeat ? "BULLISH" : "UNKNOWN") as DirectionBias,
      details,
    };
  });

  return {
    catalysts,
    source: {
      provider: "Finnhub",
      title: "Earnings Calendar",
      url: "https://finnhub.io/docs/api/earnings-calendar",
      excerpt: `${catalysts.length} earnings events (${from} to ${to})`,
    },
  };
}

async function fetchEconomicCatalysts(
  from: string,
  to: string,
): Promise<{ catalysts: Catalyst[]; source: ToolSource | null }> {
  const data = await fmpFetch<
    {
      event?: string;
      date?: string;
      country?: string;
      actual?: number | null;
      estimate?: number | null;
      previous?: number | null;
      impact?: string;
    }[]
  >(`/economic_calendar?from=${from}&to=${to}`);

  if (!Array.isArray(data) || data.length === 0) {
    return { catalysts: [], source: null };
  }

  const usEvents = data.filter((e) => e.country === "US");

  const catalysts: Catalyst[] = usEvents.map((e) => {
    const impact: ImpactLevel =
      e.impact === "High" ? "HIGH" : e.impact === "Medium" ? "MEDIUM" : "LOW";

    let details = e.event ?? "Economic Event";
    if (e.estimate != null) details += ` (est: ${e.estimate})`;
    if (e.actual != null) details += ` → actual: ${e.actual}`;

    return {
      ticker: null,
      catalyst_type: "ECONOMIC" as CatalystType,
      date: e.date?.slice(0, 10) ?? from,
      expected_impact: impact,
      direction_bias: "UNKNOWN" as DirectionBias,
      details,
    };
  });

  return {
    catalysts,
    source: {
      provider: "FMP",
      title: "US Economic Calendar",
      url: "https://site.financialmodelingprep.com/developer/docs#economic-calendar",
      excerpt: `${catalysts.length} US economic events (${from} to ${to})`,
    },
  };
}

async function fetchInsiderCatalysts(
  lookbackDays: number,
): Promise<{ catalysts: Catalyst[]; source: ToolSource | null }> {
  // FMP insider trading — recent purchases
  const data = await fmpFetch<
    {
      symbol?: string;
      transactionDate?: string;
      transactionType?: string;
      securitiesTransacted?: number;
      price?: number;
      reportingName?: string;
    }[]
  >(`/v4/insider-trading?page=0&transactionType=P-Purchase`);

  if (!Array.isArray(data) || data.length === 0) {
    return { catalysts: [], source: null };
  }

  const cutoff = isoDate(new Date(Date.now() - lookbackDays * 86400_000));

  // Filter to recent purchases and group by ticker
  const recent = data.filter(
    (t) => t.symbol && t.transactionDate && t.transactionDate >= cutoff,
  );

  // Group by ticker to find clusters
  const byTicker = new Map<
    string,
    { count: number; totalValue: number; names: string[]; latestDate: string }
  >();

  for (const t of recent) {
    const sym = t.symbol!.toUpperCase();
    const existing = byTicker.get(sym);
    const value = (t.securitiesTransacted ?? 0) * (t.price ?? 0);
    const date = t.transactionDate!;

    if (existing) {
      existing.count++;
      existing.totalValue += value;
      if (t.reportingName && !existing.names.includes(t.reportingName)) {
        existing.names.push(t.reportingName);
      }
      if (date > existing.latestDate) existing.latestDate = date;
    } else {
      byTicker.set(sym, {
        count: 1,
        totalValue: value,
        names: t.reportingName ? [t.reportingName] : [],
        latestDate: date,
      });
    }
  }

  // Only return clusters (>= 2 insiders) or large single purchases (>$500k)
  const catalysts: Catalyst[] = [];
  for (const [ticker, info] of byTicker) {
    const isCluster = info.names.length >= 2;
    const isLarge = info.totalValue >= 500_000;
    if (!isCluster && !isLarge) continue;

    const valueStr = info.totalValue >= 1_000_000
      ? `$${(info.totalValue / 1_000_000).toFixed(1)}M`
      : `$${Math.round(info.totalValue / 1000)}K`;

    catalysts.push({
      ticker,
      catalyst_type: "INSIDER" as CatalystType,
      date: info.latestDate,
      expected_impact: isCluster ? "HIGH" : "MEDIUM",
      direction_bias: "BULLISH" as DirectionBias,
      details: `${info.names.length} insider${info.names.length > 1 ? "s" : ""} bought ${valueStr} in ${lookbackDays}d`,
    });
  }

  return {
    catalysts,
    source: catalysts.length > 0
      ? {
          provider: "FMP",
          title: "Insider Transactions",
          url: "https://site.financialmodelingprep.com/developer/docs#insider-trading",
          excerpt: `${catalysts.length} insider buying signals (${lookbackDays}d lookback)`,
        }
      : null,
  };
}

async function fetchAnalystCatalysts(
  lookbackDays: number,
): Promise<{ catalysts: Catalyst[]; source: ToolSource | null }> {
  const data = await fmpFetch<
    {
      symbol?: string;
      publishedDate?: string;
      newGrade?: string;
      previousGrade?: string;
      gradingCompany?: string;
      action?: string;
    }[]
  >(`/upgrades-downgrades?page=0`);

  if (!Array.isArray(data) || data.length === 0) {
    return { catalysts: [], source: null };
  }

  const cutoff = isoDate(new Date(Date.now() - lookbackDays * 86400_000));
  const recent = data.filter(
    (a) => a.symbol && a.publishedDate && a.publishedDate.slice(0, 10) >= cutoff,
  );

  const catalysts: Catalyst[] = recent.slice(0, 30).map((a) => {
    const isUpgrade = a.action === "upgrade" ||
      (a.newGrade?.toLowerCase().includes("buy") && !a.previousGrade?.toLowerCase().includes("buy"));
    const isDowngrade = a.action === "downgrade" ||
      (a.previousGrade?.toLowerCase().includes("buy") && !a.newGrade?.toLowerCase().includes("buy"));

    const details = `${a.gradingCompany ?? "Analyst"}: ${a.previousGrade ?? "?"} → ${a.newGrade ?? "?"}`;

    return {
      ticker: a.symbol!.toUpperCase(),
      catalyst_type: "ANALYST_ACTION" as CatalystType,
      date: a.publishedDate!.slice(0, 10),
      expected_impact: "MEDIUM" as ImpactLevel,
      direction_bias: (isUpgrade ? "BULLISH" : isDowngrade ? "BEARISH" : "UNKNOWN") as DirectionBias,
      details,
    };
  });

  return {
    catalysts,
    source: catalysts.length > 0
      ? {
          provider: "FMP",
          title: "Analyst Upgrades & Downgrades",
          url: "https://site.financialmodelingprep.com/developer/docs#upgrades-downgrades",
          excerpt: `${catalysts.length} analyst actions (${lookbackDays}d lookback)`,
        }
      : null,
  };
}

// ── Main export ───────────────────────────────────────────────────────────

interface CatalystOptions {
  forwardDays?: number;
  lookbackDays?: number;
  catalystTypes?: CatalystType[];
}

export async function scanCatalysts(
  options: CatalystOptions = {},
): Promise<ScanCatalystsResult> {
  const forwardDays = options.forwardDays ?? 14;
  const lookbackDays = options.lookbackDays ?? 3;
  const types = options.catalystTypes;

  const today = new Date();
  const from = isoDate(new Date(Date.now() - lookbackDays * 86400_000));
  const to = isoDate(new Date(Date.now() + forwardDays * 86400_000));

  // Fetch all requested catalyst sources in parallel
  const shouldFetch = (t: CatalystType) => !types || types.includes(t);

  const [earnings, economic, insider, analyst] = await Promise.all([
    shouldFetch("EARNINGS") ? fetchEarningsCatalysts(from, to) : { catalysts: [], source: null },
    shouldFetch("ECONOMIC") ? fetchEconomicCatalysts(isoDate(today), to) : { catalysts: [], source: null },
    shouldFetch("INSIDER") ? fetchInsiderCatalysts(lookbackDays) : { catalysts: [], source: null },
    shouldFetch("ANALYST_ACTION") ? fetchAnalystCatalysts(lookbackDays) : { catalysts: [], source: null },
  ]);

  // Combine and sort by date
  const allCatalysts = [
    ...earnings.catalysts,
    ...economic.catalysts,
    ...insider.catalysts,
    ...analyst.catalysts,
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Build summary
  const byType: Record<CatalystType, number> = {
    EARNINGS: earnings.catalysts.length,
    ECONOMIC: economic.catalysts.length,
    INSIDER: insider.catalysts.length,
    ANALYST_ACTION: analyst.catalysts.length,
  };

  const highImpact = allCatalysts.find((c) => c.expected_impact === "HIGH" && c.date >= isoDate(today));

  // Collect non-null sources
  const sources: ToolSource[] = [
    earnings.source,
    economic.source,
    insider.source,
    analyst.source,
  ].filter((s): s is ToolSource => s != null);

  return {
    catalysts: allCatalysts,
    summary: {
      total: allCatalysts.length,
      by_type: byType,
      next_high_impact: highImpact?.date ?? null,
    },
    _sources: sources,
  };
}
