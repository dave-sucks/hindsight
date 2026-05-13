/**
 * audit-analyst-configs.ts
 *
 * Session 4 — flag contradictory analyst configurations. Read-only scan.
 * Does NOT auto-fix anything; the user reviews and repairs via the editor.
 *
 * Flags:
 *   1. Fence vs watchlist:  watchlist contains a ticker whose market cap
 *      sits outside the configured [marketCapMin, marketCapMax] fence.
 *      (Uses a small hardcoded ticker→cap lookup — no Finnhub calls, so
 *      the script runs offline. Unknown tickers are skipped silently.)
 *   2. Missing themes:  sectors/industries populated but themes empty,
 *      while the analyst name contains a theme-flavoured keyword.
 *   3. High confidence:  minConfidence > 80.
 *
 * Run with:
 *   npx tsx scripts/audit-analyst-configs.ts
 */

import { prisma } from "@/lib/prisma";

// Hardcoded market caps (USD) for common names the builder shops from.
// Rough numbers — we only care about "is this way outside the fence?".
// Extend as audits surface new offenders.
const TICKER_CAP_USD: Record<string, number> = {
  AAPL: 3_400_000_000_000,
  MSFT: 3_100_000_000_000,
  NVDA: 3_000_000_000_000,
  GOOGL: 2_100_000_000_000,
  GOOG: 2_100_000_000_000,
  AMZN: 2_000_000_000_000,
  META: 1_300_000_000_000,
  TSLA: 800_000_000_000,
  BRKB: 900_000_000_000,
  AVGO: 700_000_000_000,
  TSM: 700_000_000_000,
  LLY: 700_000_000_000,
  V: 550_000_000_000,
  JPM: 550_000_000_000,
  WMT: 550_000_000_000,
  XOM: 500_000_000_000,
  UNH: 500_000_000_000,
  MA: 450_000_000_000,
  ORCL: 400_000_000_000,
  COST: 380_000_000_000,
  HD: 370_000_000_000,
  PG: 370_000_000_000,
  ASML: 350_000_000_000,
  NFLX: 300_000_000_000,
  BAC: 280_000_000_000,
  AMD: 260_000_000_000,
  CRM: 260_000_000_000,
  ADBE: 240_000_000_000,
  KO: 270_000_000_000,
  PEP: 230_000_000_000,
  INTC: 150_000_000_000,
  QCOM: 180_000_000_000,
  MU: 100_000_000_000,
  SHOP: 100_000_000_000,
  SMCI: 30_000_000_000,
  PLTR: 60_000_000_000,
  COIN: 50_000_000_000,
  RIVN: 12_000_000_000,
  LCID: 6_000_000_000,
};

const THEMEY_KEYWORDS = [
  "momentum",
  "ai",
  "ev",
  "biotech",
  "crypto",
  "semiconductor",
  "energy",
  "weed",
  "cannabis",
  "quantum",
];

type Finding = {
  severity: "warn" | "info";
  analyst: string;
  rule: string;
  message: string;
};

function formatUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n}`;
}

function auditFenceVsWatchlist(
  name: string,
  watchlist: string[],
  capMin: number | null,
  capMax: number | null,
): Finding[] {
  if (!watchlist?.length) return [];
  const findings: Finding[] = [];

  for (const rawSym of watchlist) {
    const sym = rawSym.toUpperCase().replace(/[^A-Z]/g, "");
    const cap = TICKER_CAP_USD[sym];
    if (cap == null) continue;

    if (capMax != null && cap > capMax) {
      findings.push({
        severity: "warn",
        analyst: name,
        rule: "fence-vs-watchlist",
        message: `Watchlist contains $${sym} (~${formatUsd(cap)}) but marketCapMax is ${formatUsd(capMax)}. Either widen the fence or remove the oversized ticker.`,
      });
    }
    if (capMin != null && cap < capMin) {
      findings.push({
        severity: "warn",
        analyst: name,
        rule: "fence-vs-watchlist",
        message: `Watchlist contains $${sym} (~${formatUsd(cap)}) but marketCapMin is ${formatUsd(capMin)}. Either narrow the fence or remove the undersized ticker.`,
      });
    }
  }
  return findings;
}

function auditMissingThemes(
  name: string,
  sectors: string[],
  industries: string[],
  themes: string[],
): Finding[] {
  const anyDimension = (sectors?.length ?? 0) + (industries?.length ?? 0) > 0;
  if (!anyDimension) return [];
  if ((themes?.length ?? 0) > 0) return [];

  const lowered = name.toLowerCase();
  const hit = THEMEY_KEYWORDS.find((k) => lowered.includes(k));
  if (!hit) return [];

  return [
    {
      severity: "warn",
      analyst: name,
      rule: "missing-themes",
      message: `Sector/industry fence is populated but themes is empty, and the name hints at a theme ("${hit}"). Likely missing themes.`,
    },
  ];
}

function auditHighConfidence(name: string, minConfidence: number): Finding[] {
  if (minConfidence > 80) {
    return [
      {
        severity: "warn",
        analyst: name,
        rule: "high-confidence",
        message: `minConfidence = ${minConfidence} is unusually high. Few theses will clear the bar.`,
      },
    ];
  }
  return [];
}

async function main() {
  const analysts = await prisma.agentConfig.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      marketCapMin: true,
      marketCapMax: true,
      sectors: true,
      industries: true,
      themes: true,
      minConfidence: true,
    },
  });

  // Watchlist post-collapse = WATCHING theses. Pull all in one query.
  const watchingTheses = await prisma.thesis.findMany({
    where: {
      status: "WATCHING",
      researchRun: { agentConfigId: { in: analysts.map((a) => a.id) } },
    },
    select: { ticker: true, researchRun: { select: { agentConfigId: true } } },
  });
  const watchlistByAnalyst = new Map<string, string[]>();
  for (const t of watchingTheses) {
    const aid = t.researchRun.agentConfigId;
    if (!aid) continue;
    const arr = watchlistByAnalyst.get(aid) ?? [];
    if (!arr.includes(t.ticker)) arr.push(t.ticker);
    watchlistByAnalyst.set(aid, arr);
  }

  const findings: Finding[] = [];

  for (const a of analysts) {
    const capMin = a.marketCapMin != null ? Number(a.marketCapMin) : null;
    const capMax = a.marketCapMax != null ? Number(a.marketCapMax) : null;

    findings.push(
      ...auditFenceVsWatchlist(a.name, watchlistByAnalyst.get(a.id) ?? [], capMin, capMax),
      ...auditMissingThemes(
        a.name,
        a.sectors ?? [],
        a.industries ?? [],
        a.themes ?? [],
      ),
      ...auditHighConfidence(a.name, a.minConfidence ?? 70),
    );
  }

  // Pretty-print table. Plain columns so output works in any terminal.
  console.log(`\nAudited ${analysts.length} enabled analyst(s)`);
  console.log(`Flagged ${findings.length} issue(s)\n`);

  if (findings.length === 0) {
    console.log("No contradictions found. Nice.");
    await prisma.$disconnect();
    return;
  }

  const pad = (s: string, n: number) =>
    s.length >= n ? s : s + " ".repeat(n - s.length);
  const header = `${pad("ANALYST", 28)}  ${pad("RULE", 22)}  MESSAGE`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const f of findings) {
    console.log(
      `${pad(f.analyst.slice(0, 28), 28)}  ${pad(f.rule, 22)}  ${f.message}`,
    );
  }
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("audit-analyst-configs failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
