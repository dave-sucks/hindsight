/**
 * digest-facts-builder.ts — the IO shell behind the Daily Portfolio Digest
 * facts blob (Feature A). See docs/plans/PORTFOLIO_DIGEST.md and the pure
 * assembler in digest-facts.ts.
 *
 * `buildDigestFacts(accountId, date)` gathers raw rows from Prisma + Alpaca for
 * one account/trading-day, then hands them to the PURE `assembleDigestFacts`.
 * All IO lives here; all math lives in digest-facts.ts (unit-tested). There is
 * NO LLM in this file.
 *
 * P&L uses the DEPOSIT-ADJUSTED path (funding events → net contributed). NEVER
 * a fixed STARTING_CAPITAL baseline — see CLAUDE.md recurring bugs.
 */

import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import {
  resolveAlpacaCredentials,
  type AlpacaEnvironment,
} from "@/lib/actions/api-keys.actions";
import {
  getAccount,
  getFundingActivities,
  getLatestPrices,
  type AlpacaAccount,
  type AlpacaCredentials,
} from "@/lib/alpaca";
import { type FundingEvent } from "@/lib/portfolio/contributions";
import { assembleDigestFacts, type DigestFacts } from "@/lib/portfolio/digest-facts";

const STARTING_CAPITAL_FALLBACK = 100_000;
/** Days back to surface PASSED theses for the regret signal. */
const PASS_LOOKBACK_DAYS = 30;

/**
 * ET trading-day window [startUtc, endUtc) for a YYYY-MM-DD date string.
 * Anchored at ET midnight; the offset is derived from the date itself so it
 * survives DST. Returns Date objects in UTC for Prisma range filters.
 */
function etDayWindow(date: string): { start: Date; end: Date } {
  // Midnight ET on `date`. ET is UTC-5 (EST) or UTC-4 (EDT); compute the
  // actual offset for this date rather than hardcoding.
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(noonUtc);
  // etParts is the ET hour for 12:00 UTC; offset = 12 - etHour.
  const etHour = parseInt(etParts, 10);
  const offsetHours = 12 - etHour; // 5 for EST, 4 for EDT
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCHours(start.getUTCHours() + offsetHours);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/**
 * Gather all raw rows for the account/day and assemble the facts blob. The IO
 * lives here; the math lives in `assembleDigestFacts` (pure, tested).
 *
 * @param environment — which book to read (PAPER default). Positions/runs are
 *   filtered by environment so a PAPER digest doesn't mix in LIVE rows.
 */
export async function buildDigestFacts(
  accountId: string,
  date: string,
  environment: AlpacaEnvironment = "PAPER",
): Promise<DigestFacts> {
  const generatedAtIso = new Date().toISOString();
  const { start, end } = etDayWindow(date);
  const passSince = new Date(start);
  passSince.setUTCDate(passSince.getUTCDate() - PASS_LOOKBACK_DAYS);

  // ── Runs today ────────────────────────────────────────────────────────────
  const runRows = await prisma.researchRun.findMany({
    where: { accountId, environment, startedAt: { gte: start, lt: end } },
    select: {
      id: true,
      mode: true,
      status: true,
      agentConfigId: true,
      startedAt: true,
      agentConfig: { select: { name: true } },
    },
  });

  // ── ThesisUpdates today (decisions) ─────────────────────────────────────────
  const updateRows = await prisma.thesisUpdate.findMany({
    where: {
      timestamp: { gte: start, lt: end },
      thesis: { accountId },
    },
    select: {
      id: true,
      type: true,
      summary: true,
      timestamp: true,
      priceAtTime: true,
      runId: true,
      thesisId: true,
      thesis: {
        select: {
          ticker: true,
          researchRun: { select: { agentConfigId: true, agentConfig: { select: { name: true } } } },
        },
      },
    },
  });

  // ── Positions opened / closed today ─────────────────────────────────────────
  const openedRows = await prisma.position.findMany({
    where: { accountId, environment, openedAt: { gte: start, lt: end } },
    select: {
      id: true,
      symbol: true,
      direction: true,
      quantity: true,
      avgCost: true,
      openedAt: true,
      analystId: true,
      analyst: { select: { name: true } },
    },
  });
  const closedRows = await prisma.position.findMany({
    where: {
      accountId,
      environment,
      status: "CLOSED",
      closedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      symbol: true,
      direction: true,
      quantity: true,
      closePrice: true,
      realizedPnl: true,
      closedAt: true,
      analystId: true,
      analyst: { select: { name: true } },
    },
  });

  // ── Management actions today ─────────────────────────────────────────────────
  const mgmtRows = await prisma.positionManagementAction.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      position: { accountId, environment },
    },
    select: {
      positionId: true,
      actionType: true,
      newQty: true,
      createdAt: true,
      position: {
        select: {
          symbol: true,
          direction: true,
          analystId: true,
          analyst: { select: { name: true } },
        },
      },
    },
  });

  // ── Current book (OPEN positions) ────────────────────────────────────────────
  const heldRows = await prisma.position.findMany({
    where: { accountId, environment, status: "OPEN" },
    select: {
      id: true,
      symbol: true,
      direction: true,
      quantity: true,
      avgCost: true,
      analystId: true,
      analyst: { select: { name: true } },
    },
  });
  // Resolve a sector per held name via its most-recent thesis (best-effort).
  const heldSymbols = [...new Set(heldRows.map((p) => p.symbol))];
  const sectorTheses = heldSymbols.length
    ? await prisma.thesis.findMany({
        where: { accountId, ticker: { in: heldSymbols } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, ticker: true, sector: true },
      })
    : [];
  const sectorByTicker = new Map<string, string | null>();
  const thesisIdByTicker = new Map<string, string>();
  for (const t of sectorTheses) {
    if (!sectorByTicker.has(t.ticker)) sectorByTicker.set(t.ticker, t.sector);
    if (!thesisIdByTicker.has(t.ticker)) thesisIdByTicker.set(t.ticker, t.id);
  }

  // ── Pending proposals (positions awaiting approval) ──────────────────────────
  const pendingProposalCount = await prisma.position.count({
    where: { accountId, environment, status: "PENDING_APPROVAL" },
  });

  // ── Last new entry before today ──────────────────────────────────────────────
  const lastEntry = await prisma.position.findFirst({
    where: { accountId, environment, openedAt: { lt: start } },
    orderBy: { openedAt: "desc" },
    select: { openedAt: true },
  });

  // ── Passes aged ──────────────────────────────────────────────────────────────
  const passedRows = await prisma.thesis.findMany({
    where: {
      accountId,
      status: "PASSED",
      updatedAt: { gte: passSince },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      ticker: true,
      direction: true,
      updatedAt: true,
      entryPrice: true,
    },
  });

  // ── Capacity (sum of maxOpenPositions across enabled analysts) ───────────────
  const enabledAnalysts = await prisma.agentConfig.findMany({
    where: { accountId, enabled: true },
    select: { maxOpenPositions: true },
  });
  const capacity = enabledAnalysts.reduce(
    (sum, a) => sum + (a.maxOpenPositions ?? 0),
    0,
  );

  // ── Alpaca account + funding (deposit-adjusted P&L) ──────────────────────────
  let account: AlpacaAccount | null = null;
  let fundingEvents: FundingEvent[] = [];
  let creds: AlpacaCredentials | undefined;
  const ownerUserId = await getOwnerUserId(accountId);
  if (ownerUserId) {
    creds =
      (await resolveAlpacaCredentials(ownerUserId, environment).catch(
        () => undefined,
      )) ?? undefined;
    if (creds) {
      account = await getAccount(creds).catch((err) => {
        console.warn(
          `[digest-facts] getAccount failed: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      });
      if (environment === "LIVE") {
        fundingEvents = await getFundingActivities(creds).catch((err) => {
          console.warn(
            `[digest-facts] getFundingActivities failed: ${err instanceof Error ? err.message : err}`,
          );
          return [] as FundingEvent[];
        });
      }
    }
  }

  // ── Live quotes (one batch) for held + passed + today's traded symbols ───────
  // Best-effort and never throws: getLatestPrices returns the symbols it could
  // resolve; the pure assembler leaves price fields null for the rest. SAME
  // batched util the coverage table uses (lib/alpaca.ts getLatestPrices), so the
  // Alpaca-batch → Finnhub → single-symbol fallback ladder is shared.
  const quoteSymbols = Array.from(
    new Set([
      ...heldRows.map((p) => p.symbol),
      ...passedRows.map((t) => t.ticker),
      ...openedRows.map((p) => p.symbol),
      ...closedRows.map((p) => p.symbol),
      ...mgmtRows.map((m) => m.position.symbol),
    ]),
  );
  const quotes =
    quoteSymbols.length > 0
      ? await getLatestPrices(quoteSymbols, creds).catch((err) => {
          console.warn(
            `[digest-facts] getLatestPrices failed: ${err instanceof Error ? err.message : err}`,
          );
          return {} as Record<string, number>;
        })
      : ({} as Record<string, number>);

  return assembleDigestFacts({
    accountId,
    date,
    generatedAtIso,
    runs: runRows.map((r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      analystId: r.agentConfigId,
      analystName: r.agentConfig?.name ?? null,
      startedAt: r.startedAt,
    })),
    thesisUpdates: updateRows.map((u) => ({
      id: u.id,
      type: u.type,
      summary: u.summary,
      timestamp: u.timestamp,
      priceAtTime: u.priceAtTime,
      runId: u.runId,
      thesisId: u.thesisId,
      ticker: u.thesis.ticker,
      analystId: u.thesis.researchRun?.agentConfigId ?? null,
      analystName: u.thesis.researchRun?.agentConfig?.name ?? null,
    })),
    openedPositions: openedRows.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      direction: p.direction,
      quantity: p.quantity,
      avgCost: p.avgCost,
      openedAt: p.openedAt,
      analystId: p.analystId,
      analystName: p.analyst?.name ?? null,
    })),
    closedPositions: closedRows.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      direction: p.direction,
      quantity: p.quantity,
      closePrice: p.closePrice,
      realizedPnl: p.realizedPnl,
      closedAt: p.closedAt ?? start,
      analystId: p.analystId,
      analystName: p.analyst?.name ?? null,
    })),
    managementActions: mgmtRows.map((m) => ({
      positionId: m.positionId,
      symbol: m.position.symbol,
      direction: m.position.direction,
      actionType: m.actionType,
      newQty: m.newQty,
      createdAt: m.createdAt,
      analystId: m.position.analystId,
      analystName: m.position.analyst?.name ?? null,
    })),
    heldPositions: heldRows.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      direction: p.direction,
      quantity: p.quantity,
      avgCost: p.avgCost,
      sector: sectorByTicker.get(p.symbol) ?? null,
      thesisId: thesisIdByTicker.get(p.symbol) ?? null,
      analystId: p.analystId,
      analystName: p.analyst?.name ?? null,
    })),
    pendingProposalCount,
    lastEntryBeforeTodayAt: lastEntry?.openedAt ?? null,
    passedTheses: passedRows.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      direction: t.direction ?? null,
      passedAt: t.updatedAt,
      priceAtPass: t.entryPrice,
    })),
    capacity,
    fundingEvents,
    startingCapitalFallback: STARTING_CAPITAL_FALLBACK,
    account,
    quotes,
  });
}
