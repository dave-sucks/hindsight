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
  mode: string; // "MORNING_PLAN" | "INTRADAY_TACTICAL" | "DISCOVERY"
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
  /** Live quote, or null when no price could be sourced. */
  currentPrice: number | null;
  /** Move since entry vs avgCost, direction-aware (SHORT inverts). null when no quote. */
  sinceEntryPct: number | null;
  /** Today's % move from the quote's prior-close, when the feed carries it. null otherwise. */
  dayChangePct: number | null;
}

/** Verdict on a PASSED name once it has moved (mirrors coverage.actions.ts). */
export type DigestPassVerdict = "DODGED" | "MISSED" | "FLAT";

/** A name we PASSED on that has since moved — the regret signal. */
export interface DigestPassFact {
  thesisId: string;
  ticker: string;
  /** "LONG" | "SHORT" | null — drives the verdict. */
  direction: string | null;
  passedAtIso: string;
  daysSincePass: number;
  priceAtPass: number | null;
  /** Live quote, or null when no price could be sourced. */
  currentPrice: number | null;
  /** Raw % move since the pass price (sign as-is, not direction-adjusted). */
  sincePassPct: number | null;
  /** DODGED = the pass was right; MISSED = regret; FLAT = no/unknown move. */
  verdict: DigestPassVerdict;
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

// Run-mode → category. These are the REAL ResearchRun.mode values written by
// the crons (verified 2026-06-17):
//   • daily      → MORNING_PLAN       (lib/inngest/functions/morning-research.ts)
//   • tactical   → INTRADAY_TACTICAL  (lib/inngest/functions/tactical-run.ts)
//   • discovery  → DISCOVERY          (lib/inngest/functions/discovery-run.ts)
// The old `EOD_REFLECTIVE` value is a schema-comment placeholder that nothing
// actually writes — mapping discovery to it (the prior bug) meant the discovery
// rollup was always 0.
//
// PRINCIPAL_CHAT is deliberately NOT counted as discovery. Those rows are
// chat-session containers (the /runs page excludes them as "not analytical").
// Batched-discovery inside a principal-chat session does not create a
// DISCOVERY-mode run; its real research output lands as dispatched
// thesis-writer child runs (mode-less workers), so counting the chat container
// would over-count cadence. We count only true DISCOVERY-mode cron runs.
const MODE_DAILY = "MORNING_PLAN";
const MODE_TACTICAL = "INTRADAY_TACTICAL";
const MODE_DISCOVERY = "DISCOVERY";

/**
 * Verdict for a held name's "since entry" move — direction-aware. LONG up = good,
 * SHORT up = bad. Returns the signed % AS THE TRADE EXPERIENCES IT: positive when
 * the position is in profit, negative when underwater.
 */
function directionAwarePct(
  direction: string,
  entry: number,
  current: number,
): number | null {
  if (entry === 0) return null;
  const raw = ((current - entry) / entry) * 100;
  return direction === "SHORT" ? -raw : raw;
}

/**
 * Verdict for a PASSED thesis. Mirrors `passVerdict` in
 * lib/actions/coverage.actions.ts EXACTLY: a pass on a LONG idea is DODGED if the
 * stock fell, MISSED if it rose; SHORT inverts; no direction → long bias (any
 * rise-since-pass is regret). `sincePct` is the raw (non-direction-adjusted) move.
 */
function passVerdict(
  direction: string | null,
  sincePct: number | null,
): DigestPassVerdict {
  if (sincePct == null || sincePct === 0) return "FLAT";
  const rose = sincePct > 0;
  if (direction === "SHORT") return rose ? "DODGED" : "MISSED";
  return rose ? "MISSED" : "DODGED";
}

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
    /** "LONG" | "SHORT" | null — drives the DODGED/MISSED verdict. */
    direction: string | null;
    passedAt: Date;
    priceAtPass: number | null;
  }[];
  /**
   * Live quote map (symbol → current price) for the union of held + passed +
   * today's traded symbols. Best-effort: a missing symbol is simply absent, and
   * the assembler leaves that name's price fields null. Sourced from the SAME
   * batched util the coverage table uses (lib/alpaca.ts getLatestPrices).
   */
  quotes: Record<string, number>;
  /**
   * Optional per-symbol intraday % change from prior close, when the quote feed
   * carries it. getLatestPrices today returns price only, so this is usually
   * empty — held `dayChangePct` stays null until a day-change-bearing feed lands.
   */
  dayChangePct?: Record<string, number>;
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
    quotes,
    dayChangePct,
  } = input;
  const dayChange = dayChangePct ?? {};

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
  const held: DigestHeldFact[] = heldPositions.map((p) => {
    const currentPrice = quotes[p.symbol] ?? null;
    const sinceEntryPct =
      currentPrice != null
        ? directionAwarePct(p.direction, p.avgCost, currentPrice)
        : null;
    return {
      positionId: p.id,
      thesisId: p.thesisId,
      ticker: p.symbol,
      direction: p.direction,
      quantity: p.quantity,
      avgCost: p.avgCost,
      analystId: p.analystId,
      analystName: p.analystName,
      currentPrice,
      sinceEntryPct,
      dayChangePct: dayChange[p.symbol] ?? null,
    };
  });

  // Sector concentration from notional. Prefer CURRENT market value
  // (price × qty) per name when a live quote exists; fall back to cost-basis
  // (avgCost × qty) when a quote is missing. Per-position fallback so a single
  // missing quote doesn't poison the whole table. Null when no sectors known.
  const sectorNotional = new Map<string, number>();
  let knownSectorTotal = 0;
  for (const p of heldPositions) {
    if (!p.sector) continue;
    const quote = quotes[p.symbol];
    const unitPrice = quote != null ? quote : p.avgCost;
    const notional = Math.abs(unitPrice * p.quantity);
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
    .map((t) => {
      const currentPrice = quotes[t.ticker] ?? null;
      const sincePassPct =
        currentPrice != null && t.priceAtPass != null && t.priceAtPass !== 0
          ? ((currentPrice - t.priceAtPass) / t.priceAtPass) * 100
          : null;
      return {
        thesisId: t.id,
        ticker: t.ticker,
        direction: t.direction,
        passedAtIso: t.passedAt.toISOString(),
        daysSincePass: daysBetween(t.passedAt, generatedAtIso),
        priceAtPass: t.priceAtPass,
        currentPrice,
        sincePassPct,
        verdict: passVerdict(t.direction, sincePassPct),
      };
    });

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
