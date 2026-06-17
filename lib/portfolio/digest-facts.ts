/**
 * digest-facts.ts — the deterministic facts blob behind the Daily Portfolio
 * Digest (Feature A). See docs/plans/PORTFOLIO_DIGEST.md.
 *
 * This file is the PURE half: the DigestFacts types + `assembleDigestFacts`,
 * which derives the facts blob from already-fetched raw rows. There is NO IO
 * and NO LLM here, so it is unit-tested directly (same split as
 * contributions.ts). The IO shell that gathers the raw rows from Prisma +
 * Alpaca lives in `digest-facts-builder.ts` (`buildDigestFacts`).
 *
 * The blob is the single source of truth: every number the narration writer
 * (lib/agent/digest-writer.ts) prints comes from here, and it carries the ids
 * the writer needs to embed reference tokens (`[TICKER](thesis:id)`,
 * `[Analyst](analyst:id)`, `[label](run:id)`).
 *
 * P&L is computed via the DEPOSIT-ADJUSTED path (lib/portfolio/contributions.ts).
 * NEVER measure against a fixed STARTING_CAPITAL baseline — that reintroduces
 * the homepage "+1015%" deposit-as-gain bug (see CLAUDE.md recurring bugs).
 */

// `import type` only — AlpacaAccount is erased at compile, so this pure module
// never loads the alpaca SDK (keeps it jest-importable without prisma/SDK ESM).
import type { AlpacaAccount } from "@/lib/alpaca";
import { netContributedTotal, type FundingEvent } from "@/lib/portfolio/contributions";

// ─── Facts shape ────────────────────────────────────────────────────────────

/** A run that executed today, with the ids the writer needs for `run:` tokens. */
export interface DigestRunFact {
  runId: string;
  mode: string; // "MORNING_PLAN" | "INTRADAY_TACTICAL" | "EOD_REFLECTIVE"
  status: string; // "COMPLETE" | "FAILED" | "RUNNING" | ...
  analystId: string | null;
  analystName: string | null;
  /** ET HH:MM the run started — used for "tactical 18:46" run labels. */
  startedAtEt: string;
  startedAtIso: string;
}

/** A thesis decision logged today (entry / exit / trim / review / pass / ...). */
export interface DigestDecisionFact {
  thesisId: string;
  ticker: string;
  /** ThesisUpdate.type — CREATED | UPDATED | REVIEWED | ACTED | INVALIDATED |
   *  CLOSED | STATUS_CHANGED | TRIGGER_FIRED | SUPERSEDED. */
  type: string;
  summary: string;
  analystId: string | null;
  analystName: string | null;
  runId: string | null;
  timeEt: string;
  priceAtTime: number | null;
}

/** A trade action that hit the book today (open / close / add / trim / stop). */
export interface DigestTradeFact {
  positionId: string;
  ticker: string;
  /** "OPEN" | "CLOSE" | "PARTIAL_CLOSE" | "ADD_TO_POSITION" | "UPDATE_TARGETS"
   *  | "MOVE_STOP_TO_BREAKEVEN" | "SET_TRAILING_STOP". */
  kind: string;
  direction: string | null; // LONG | SHORT
  quantity: number | null;
  price: number | null;
  realizedPnl: number | null; // populated on closes
  analystId: string | null;
  analystName: string | null;
  timeEt: string;
}

/** One open position in the book snapshot. */
export interface DigestHeldFact {
  positionId: string;
  thesisId: string | null;
  ticker: string;
  direction: string; // LONG | SHORT
  quantity: number;
  avgCost: number;
  analystId: string | null;
  analystName: string | null;
}

/** A name we PASSED on that has since moved — the regret signal. */
export interface DigestPassFact {
  thesisId: string;
  ticker: string;
  passedAtIso: string;
  daysSincePass: number;
  priceAtPass: number | null;
}

/** Book-level snapshot of capacity, cash, exposure, concentration. */
export interface DigestBookSnapshot {
  heldCount: number;
  /** Sum of analyst maxOpenPositions across enabled analysts on the account. */
  capacity: number;
  slotsUsedLabel: string; // e.g. "3/10"
  cash: number;
  buyingPower: number;
  totalEquity: number;
  longMarketValue: number;
  shortMarketValue: number; // absolute value
  grossExposure: number;
  /** Largest single-sector share of gross exposure, 0-1, or null if unknown. */
  topSectorConcentration: number | null;
  topSector: string | null;
  held: DigestHeldFact[];
}

/** Deposit-adjusted P&L facts. day + cumulative, never STARTING_CAPITAL-based. */
export interface DigestPnlFacts {
  dayPnl: number;
  dayPnlPct: number;
  totalPnl: number;
  totalPnlPct: number;
  netContributed: number;
  realizedToday: number;
}

/** Capacity / cadence signals — the "are we idle / fully deployed" read. */
export interface DigestCadenceFacts {
  slotsUsed: number;
  slotsTotal: number;
  fullyDeployed: boolean;
  idleCash: number;
  daysSinceLastNewEntry: number | null;
  pendingProposals: number; // positions awaiting approval
}

/** Per-run-type rollup for the agent-memory timeline lines. */
export interface DigestRunTypeRollup {
  daily: number;
  tactical: number;
  discovery: number;
  failed: number;
}

export interface DigestFacts {
  /** Schema version — bump if the shape changes so consumers can branch. */
  version: 1;
  accountId: string;
  /** YYYY-MM-DD — the trading day this digest covers. */
  date: string;
  generatedAtIso: string;
  /** True when there was no Alpaca account (creds missing / fetch failed) — the
   *  P&L + book numbers are then best-effort / empty. */
  hadAlpaca: boolean;

  runs: DigestRunFact[];
  runRollup: DigestRunTypeRollup;
  decisions: DigestDecisionFact[];
  trades: DigestTradeFact[];
  book: DigestBookSnapshot;
  pnl: DigestPnlFacts;
  passesAged: DigestPassFact[];
  cadence: DigestCadenceFacts;
}

// ─── Pure assembler (unit-tested) ─────────────────────────────────────────────

const MODE_DAILY = "MORNING_PLAN";
const MODE_TACTICAL = "INTRADAY_TACTICAL";
const MODE_DISCOVERY = "EOD_REFLECTIVE";

/** Raw rows handed to the pure assembler. Mirrors the DB/Alpaca reads but with
 *  no IO so the assembler is deterministic and testable. */
export interface DigestRawInputs {
  accountId: string;
  date: string; // YYYY-MM-DD (ET trading day)
  generatedAtIso: string;
  runs: {
    id: string;
    mode: string;
    status: string;
    analystId: string | null;
    analystName: string | null;
    startedAt: Date;
  }[];
  thesisUpdates: {
    id: string;
    type: string;
    summary: string;
    timestamp: Date;
    priceAtTime: number | null;
    runId: string | null;
    thesisId: string;
    ticker: string;
    analystId: string | null;
    analystName: string | null;
  }[];
  /** Positions opened today. */
  openedPositions: {
    id: string;
    symbol: string;
    direction: string;
    quantity: number;
    avgCost: number;
    openedAt: Date;
    analystId: string | null;
    analystName: string | null;
  }[];
  /** Positions closed today. */
  closedPositions: {
    id: string;
    symbol: string;
    direction: string;
    quantity: number;
    closePrice: number | null;
    realizedPnl: number | null;
    closedAt: Date;
    analystId: string | null;
    analystName: string | null;
  }[];
  /** Management actions (add / trim / stop / target) logged today. */
  managementActions: {
    positionId: string;
    symbol: string;
    direction: string;
    actionType: string;
    newQty: number | null;
    createdAt: Date;
    analystId: string | null;
    analystName: string | null;
  }[];
  /** Currently OPEN positions (book snapshot). */
  heldPositions: {
    id: string;
    symbol: string;
    direction: string;
    quantity: number;
    avgCost: number;
    sector: string | null;
    thesisId: string | null;
    analystId: string | null;
    analystName: string | null;
  }[];
  pendingProposalCount: number;
  /** Most recent OPEN before today, for "days since last new entry". */
  lastEntryBeforeTodayAt: Date | null;
  /** Recent PASSED theses (the regret signal). */
  passedTheses: {
    id: string;
    ticker: string;
    passedAt: Date;
    priceAtPass: number | null;
  }[];
  /** Sum of maxOpenPositions across enabled analysts (capacity). */
  capacity: number;
  /** Funding events (LIVE only) for deposit-adjusted net contributed. */
  fundingEvents: FundingEvent[];
  /** STARTING_CAPITAL fallback for paper / no funding events. */
  startingCapitalFallback: number;
  /** Alpaca account snapshot, or null when creds missing / fetch failed. */
  account: AlpacaAccount | null;
}

/** ET HH:MM for a Date, used for run/decision/trade labels. */
function etTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function daysBetween(from: Date, toIso: string): number {
  const to = new Date(toIso);
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Pure: derive the full DigestFacts blob from already-fetched raw rows. No IO,
 * no LLM. This is the function the jest tests exercise with fixtures.
 */
export function assembleDigestFacts(input: DigestRawInputs): DigestFacts {
  const {
    accountId,
    date,
    generatedAtIso,
    runs,
    thesisUpdates,
    openedPositions,
    closedPositions,
    managementActions,
    heldPositions,
    pendingProposalCount,
    lastEntryBeforeTodayAt,
    passedTheses,
    capacity,
    fundingEvents,
    startingCapitalFallback,
    account,
  } = input;

  // ── Runs + rollup ──────────────────────────────────────────────────────────
  const runFacts: DigestRunFact[] = runs
    .slice()
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((r) => ({
      runId: r.id,
      mode: r.mode,
      status: r.status,
      analystId: r.analystId,
      analystName: r.analystName,
      startedAtEt: etTime(r.startedAt),
      startedAtIso: r.startedAt.toISOString(),
    }));

  const runRollup: DigestRunTypeRollup = {
    daily: runFacts.filter((r) => r.mode === MODE_DAILY).length,
    tactical: runFacts.filter((r) => r.mode === MODE_TACTICAL).length,
    discovery: runFacts.filter((r) => r.mode === MODE_DISCOVERY).length,
    failed: runFacts.filter((r) => r.status === "FAILED").length,
  };

  // ── Decisions (ThesisUpdate today) ───────────────────────────────────────────
  const decisions: DigestDecisionFact[] = thesisUpdates
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((u) => ({
      thesisId: u.thesisId,
      ticker: u.ticker,
      type: u.type,
      summary: u.summary,
      analystId: u.analystId,
      analystName: u.analystName,
      runId: u.runId,
      timeEt: etTime(u.timestamp),
      priceAtTime: u.priceAtTime,
    }));

  // ── Trades (opens + closes + management actions) ─────────────────────────────
  const trades: DigestTradeFact[] = [
    ...openedPositions.map((p) => ({
      positionId: p.id,
      ticker: p.symbol,
      kind: "OPEN",
      direction: p.direction,
      quantity: p.quantity,
      price: p.avgCost,
      realizedPnl: null,
      analystId: p.analystId,
      analystName: p.analystName,
      timeEt: etTime(p.openedAt),
    })),
    ...closedPositions.map((p) => ({
      positionId: p.id,
      ticker: p.symbol,
      kind: "CLOSE",
      direction: p.direction,
      quantity: p.quantity,
      price: p.closePrice,
      realizedPnl: p.realizedPnl,
      analystId: p.analystId,
      analystName: p.analystName,
      timeEt: etTime(p.closedAt),
    })),
    ...managementActions.map((m) => ({
      positionId: m.positionId,
      ticker: m.symbol,
      kind: m.actionType,
      direction: m.direction,
      quantity: m.newQty,
      price: null,
      realizedPnl: null,
      analystId: m.analystId,
      analystName: m.analystName,
      timeEt: etTime(m.createdAt),
    })),
  ].sort((a, b) => a.timeEt.localeCompare(b.timeEt));

  // ── P&L (deposit-adjusted) ───────────────────────────────────────────────────
  const netContributed =
    fundingEvents.length > 0
      ? netContributedTotal(fundingEvents)
      : startingCapitalFallback;

  const realizedToday = closedPositions.reduce(
    (sum, p) => sum + (p.realizedPnl ?? 0),
    0,
  );

  let totalEquity = 0;
  let cash = 0;
  let buyingPower = 0;
  let longMarketValue = 0;
  let shortMarketValue = 0;
  let dayPnl = 0;
  let dayPnlPct = 0;
  let totalPnl = 0;
  let totalPnlPct = 0;

  if (account) {
    totalEquity = parseFloat(account.equity);
    cash = parseFloat(account.cash);
    buyingPower = parseFloat(account.buying_power);
    longMarketValue = account.long_market_value
      ? parseFloat(account.long_market_value)
      : 0;
    const shortRaw = account.short_market_value
      ? parseFloat(account.short_market_value)
      : 0;
    shortMarketValue = Math.abs(shortRaw);

    // total P&L = equity − net contributed (the deposit-adjusted identity).
    totalPnl = totalEquity - netContributed;
    totalPnlPct = netContributed > 0 ? (totalPnl / netContributed) * 100 : 0;

    // day P&L = equity − prior close − any deposit that posted today.
    const lastEquity = account.last_equity
      ? parseFloat(account.last_equity)
      : null;
    const depositsToday = fundingEvents
      .filter((e) => e.date === date)
      .reduce((sum, e) => sum + e.amount, 0);
    if (lastEquity != null && Number.isFinite(lastEquity)) {
      dayPnl = totalEquity - lastEquity - depositsToday;
      dayPnlPct = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;
    }
  }

  const grossExposure = longMarketValue + shortMarketValue;

  // ── Book snapshot ────────────────────────────────────────────────────────────
  const held: DigestHeldFact[] = heldPositions.map((p) => ({
    positionId: p.id,
    thesisId: p.thesisId,
    ticker: p.symbol,
    direction: p.direction,
    quantity: p.quantity,
    avgCost: p.avgCost,
    analystId: p.analystId,
    analystName: p.analystName,
  }));

  // Sector concentration from notional at entry cost (Alpaca doesn't break out
  // per-position market value here, so cost-basis weight is the deterministic
  // proxy). Null when no sectors are known.
  const sectorNotional = new Map<string, number>();
  let knownSectorTotal = 0;
  for (const p of heldPositions) {
    if (!p.sector) continue;
    const notional = Math.abs(p.avgCost * p.quantity);
    sectorNotional.set(p.sector, (sectorNotional.get(p.sector) ?? 0) + notional);
    knownSectorTotal += notional;
  }
  let topSector: string | null = null;
  let topSectorConcentration: number | null = null;
  if (knownSectorTotal > 0) {
    for (const [sector, notional] of sectorNotional) {
      const share = notional / knownSectorTotal;
      if (topSectorConcentration == null || share > topSectorConcentration) {
        topSectorConcentration = share;
        topSector = sector;
      }
    }
  }

  const heldCount = heldPositions.length;
  const book: DigestBookSnapshot = {
    heldCount,
    capacity,
    slotsUsedLabel: `${heldCount}/${capacity}`,
    cash,
    buyingPower,
    totalEquity,
    longMarketValue,
    shortMarketValue,
    grossExposure,
    topSectorConcentration,
    topSector,
    held,
  };

  // ── Passes aged (regret signal) ──────────────────────────────────────────────
  const passesAged: DigestPassFact[] = passedTheses
    .slice()
    .sort((a, b) => b.passedAt.getTime() - a.passedAt.getTime())
    .map((t) => ({
      thesisId: t.id,
      ticker: t.ticker,
      passedAtIso: t.passedAt.toISOString(),
      daysSincePass: daysBetween(t.passedAt, generatedAtIso),
      priceAtPass: t.priceAtPass,
    }));

  // ── Cadence / capacity signals ───────────────────────────────────────────────
  const fullyDeployed = capacity > 0 && heldCount >= capacity;
  const daysSinceLastNewEntry =
    openedPositions.length > 0
      ? 0
      : lastEntryBeforeTodayAt != null
        ? daysBetween(lastEntryBeforeTodayAt, generatedAtIso)
        : null;
  const cadence: DigestCadenceFacts = {
    slotsUsed: heldCount,
    slotsTotal: capacity,
    fullyDeployed,
    idleCash: cash,
    daysSinceLastNewEntry,
    pendingProposals: pendingProposalCount,
  };

  return {
    version: 1,
    accountId,
    date,
    generatedAtIso,
    hadAlpaca: account != null,
    runs: runFacts,
    runRollup,
    decisions,
    trades,
    book,
    pnl: {
      dayPnl,
      dayPnlPct,
      totalPnl,
      totalPnlPct,
      netContributed,
      realizedToday,
    },
    passesAged,
    cadence,
  };
}
