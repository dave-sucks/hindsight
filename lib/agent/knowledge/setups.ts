/**
 * setups.ts — the playbooks: the buy patterns an analyst trades.
 *
 * docs/plans/TRADING_PLAYBOOK.md Part D (D1–D12) as data. Each entry says
 * what the pattern is, which horizons and seats it fits, what must be true
 * first, how a buy is confirmed, the sell price's two numbers (the widest and
 * the closest, in ATR), the size note and what failure looks like. Its
 * triggers are its templates (`triggers`, the seed of Settings → Playbook,
 * ./playbook-templates); every rule a trigger carries lives there, never here.
 *
 * Read through read_knowledge_library (topic "setup"). A thesis records the
 * pattern it was written on in `Thesis.setupId`. Nothing here refuses
 * anything.
 *
 * The numbers are the playbook's, blessed by Dave on DAV-245 (2026-09-11).
 * They live at the top of this file so one edit changes them everywhere.
 */


import { etTradingDayDate } from "@/lib/market-hours";
import { applySetupOverride, type SetupOverrides } from "./setup-overrides";
import type { Condition, When } from "@/lib/agent/triggers/condition";
import { PLAYBOOK_TEMPLATES, type Template } from "./playbook-templates";

// ── The numbers (DAV-245 ruling 1: playbook defaults accepted) ───────────

/** A TRADE-horizon stop is never wider than this from entry (O'Neil 7–8%). */
export const TRADE_STOP_MAX_PCT = 8;
/** A stop closer than this many ATR(14) to entry is inside the noise. */
export const MIN_STOP_ATR = 1;
/** Breakout-day volume vs the average that makes a breakout real. */
export const BREAKOUT_VOLUME_RATIO = 1.5;
/** Do not buy more than this far past the pivot / entry condition. */
export const CHASE_LIMIT_PCT = 5;
/** Sum of open risk if every stop hits, as % of equity (Elder). */
export const PORTFOLIO_HEAT_PCT = 6;
/** Most names held in one industry group. */
export const MAX_NAMES_PER_INDUSTRY = 2;
/** The widest a compounder's plan floor may sit under its buy. */
export const COMPOUNDER_STOP_MAX_PCT = 25;
/** A compounder giving back this much from its high opens a review. */
export const COMPOUNDER_GIVEBACK_REVIEW_PCT = 15;

/** Binary catalysts (PDUFA, readouts) risk this share of normal (DAV-245 ruling 2). */
export const BINARY_RISK_MULTIPLIER = 0.5;
/** …and a −50% gap on one may not cost more than this % of equity. */
export const BINARY_MAX_GAP_LOSS_PCT = 0.5;
/** An episodic-pivot gap: at least this big at the open… */
export const EP_GAP_MIN_PCT = 8;
/** …on at least this multiple of average volume. */
export const EP_GAP_MIN_VOLUME_RATIO = 3;
/** PEAD: EPS surprise at least this… */
export const PEAD_MIN_SURPRISE_PCT = 5;
/** …entered this many sessions after the print. */
export const PEAD_ENTRY_WINDOW: [number, number] = [1, 3];
/** PEAD: reaction-day volume vs the 20-day average. */
export const PEAD_REACTION_VOLUME_RATIO = 2;
/** PEAD: past this much above the gap, most of the edge is gone. */
export const PEAD_MAX_RUN_PAST_GAP_PCT = 10;
/** Pullback: price within this % of the 20/50-day arms the entry. */
export const PULLBACK_NEAR_SMA_PCT = 2;
/**
 * How close to the event a pre-catalyst entry stops being one (QB ruling
 * 2026-09-26). The run-up trade sells 1–2 weeks before the date, so a buy
 * still unfilled three weeks out is a trade that never started; entering
 * there is holding the coin flip by accident.
 */
export const PRE_CATALYST_ENTRY_CUTOFF_DAYS = 21;
/**
 * Pre-catalyst: the entry window before a dated event, in days — opens 70
 * out, closes at the cutoff above. One window (QB ruling on DAV-338,
 * 2026-09-29): this said 14 while the cutoff stopped every buy at 21.
 */
export const CATALYST_WINDOW_DAYS: [number, number] = [PRE_CATALYST_ENTRY_CUTOFF_DAYS, 70];
/** Insider cluster: buyers within the window. */
export const INSIDER_MIN_BUYERS = 3;
export const INSIDER_WINDOW_DAYS = 30;
export const INSIDER_STOP_MAX_PCT = 12;
/** RSI(2) mean reversion: buy below, sell above. */
export const RSI2_ENTRY_BELOW = 10;
export const RSI2_EXIT_ABOVE = 65;
// ── Types ─────────────────────────────────────────────────────────────────

export type Horizon = "TRADE" | "TARGET" | "CATALYST" | "COMPOUNDER";

/**
 * A `{name}` the writer fills from the chart or the calendar at write time.
 * Every name used in a template is defined in PLACEHOLDERS.
 */
export type Placeholder = `{${string}}`;

/**
 * An entry condition with holes: the condition shape (lib/agent/triggers/condition),
 * with a value allowed to be a `{placeholder}` the writer fills from the chart.
 */
export type TemplateCondition = Omit<Condition, "value"> & { value?: number | Placeholder };
export type TemplatePredicate = TemplateCondition | { match: "all"; conditions: TemplateCondition[] };

export interface Setup {
  /** Stable id stored on Thesis.setupId. */
  id: SetupId;
  /** The playbook section, e.g. "D1". */
  code: string;
  name: string;
  /**
   * ENTRY: a buy pattern with its own entry condition.
   * SCREEN: finds names; the entry comes from one of `entryVia`.
   */
  role: "ENTRY" | "SCREEN";
  horizons: Horizon[];
  /** What must be true before the pattern applies (trend, regime, fundamentals). */
  preconditions: string[];
  entry: {
    /** For a SCREEN: the playbooks with a buy of their own whose triggers it uses. */
    entryVia?: SetupId[];
    /** What else must be true on the day (checked by the tactical run). */
    confirmation: string[];
    /** Max % past the level a buy may be placed; null = no chase rule. */
    chaseLimitPct: number | null;
    /**
     * Days after the report inside which this entry applies — the same
     * count the after-earnings kind evaluates (the report day is 0). Past
     * the last day the setup no longer applies and the writer is told so
     * (HPE 2026-09-15: written as PEAD 13 days after the print, with no
     * plan the drift rules could price).
     */
    windowDays?: [number, number];
  };
  /** The sell price's numbers, read on the sell price a buy names (saleRuleProblem): the widest from the buy price, %, on a TRADE (null = no cap), and the closest, in ATR(14). */
  sale: { maxPct: number | null; minAtr: number };
  /** Multiplies the risk-per-trade (1.0 normal; binary events 0.5). */
  riskMultiplier: number;
  sizing: string;
  failureSigns: string[];
  /** The playbook's paragraph, condensed. */
  summary: string;
  /** The triggers the playbook writes on a stock, the seed of Settings → Playbook (./playbook-templates). */
  triggers: Template[];
}

// ── Placeholders the writer fills ─────────────────────────────────────────

/** Where each `{placeholder}` comes from. `chart.` paths are PriceStructure fields. */
export const PLACEHOLDERS: Record<Placeholder, string> = {
  "{pivot}": "chart.base.pivot — the base's high; add 0.1–0.3% buffer",
  "{pivotChase}": `chart.base.pivot × ${1 + CHASE_LIMIT_PCT / 100} — the chase ceiling`,
  "{flagHigh}": "chart.range.high20 — the flag's high (or the last swing high inside the flag)",
  "{gapDayHigh}": "chart.gaps[0].high — day-1 high of the gap",
  "{gapDayMid}": "chart.gaps[0].mid — the gap-day midpoint (a hold above it on day 2 is the entry)",
  "{gapDayLow}": "chart.gaps[0].low — the gap-day low, the market's own line",
  "{swingLow}": "chart.swings.lastLow.price",
  "{high20}": "chart.range.high20 — the 20-day high",
  "{baseLow}": "chart.base.low — the base's low",
  "{priorHigh}": "chart.swings.lastHigh.price — the prior high above the buy",
  "{low52}": "chart.range.low52w — the 52-week low",
  "{flagLow}": "chart.range.low20 — the flag's low",
  "{price}": "chart.price — today's price",
  "{sellPrice}": "the sell price the run names with the buy (place_trade's sell_if_below), by its trigger's own reason",
  "{riskPct}": "(the buy price − the sell price) ÷ the buy price, as a % — one risk",
};

// ── The catalog ───────────────────────────────────────────────────────────

export const SETUP_IDS = [
  "BASE_BREAKOUT",
  "MOMENTUM_FLAG",
  "EPISODIC_PIVOT",
  "PEAD",
  "MA_PULLBACK",
  "RSI2_BOUNCE",
  "RS_52W_HIGH",
  "PRE_CATALYST",
  "INSIDER_CLUSTER",
  "ESTIMATE_REVISION",
  "COMPOUNDER_ACCUMULATION",
  "SECTOR_ROTATION",
] as const;
export type SetupId = (typeof SETUP_IDS)[number];

/**
 * What a review stores when it looked and no catalog setup fits the stock
 * (DAV-285). The reason is the review's own sentence on the Activity line.
 * Every reader treats it as "no setup": getSetup returns nothing for it.
 */
export const NO_SETUP_FITS = "NONE";

/** True when the row carries a catalog setup (not null, not "no setup fits"). */
export function isNamedSetup(id: string | null | undefined): id is SetupId {
  return !!id && (SETUP_IDS as readonly string[]).includes(id);
}

type BinaryRow = {
  setupId?: string | null;
  horizon?: string | null;
  catalystDate?: Date | string | null;
};

/**
 * A pre-catalyst play: the PRE_CATALYST setup, or a CATALYST-horizon row no
 * setup was named on (BMRN, CYTK). These live by the buying window — parked
 * until it opens, no buy armed inside the cutoff.
 */
export function isPreCatalystPlay(row: BinaryRow): boolean {
  return row.setupId === "PRE_CATALYST" || (!isNamedSetup(row.setupId) && row.horizon === "CATALYST");
}

/**
 * Is a buy on this stock, today, a bet into a dated binary event — half the
 * risk (playbook E4)? ONE answer for every path that sizes a buy: the entry
 * (place_trade) and the add (manage_position).
 *
 *   - A pre-catalyst play: always.
 *   - Any other CATALYST-horizon stock: until its event date is behind it.
 *     AIR, KMX and JBL are CATALYST rows wearing the PEAD setup. Bought the
 *     day before the print they are a bet on the print — half. Bought on
 *     days 1–3 after it they are the drift entry, which the setup sizes in
 *     full; the coin has landed.
 *   - Everything else: no. HPE and DOCU carry their next print in
 *     `catalystDate` too (64 and 66 days out) and are TARGET-horizon drift
 *     names — the date alone never halves a buy.
 *
 * "Behind" is the whole event day: a print is before the open or after the
 * close, and the row stores the day, not the hour.
 */
export function isBinaryBet(row: BinaryRow, asOf: Date = new Date()): boolean {
  if (isPreCatalystPlay(row)) return true;
  if (row.horizon !== "CATALYST") return false;
  if (!row.catalystDate) return true;
  const eventDayEnds = new Date(row.catalystDate).getTime() + 86_400_000;
  return asOf.getTime() < eventDayEnds;
}

/**
 * Where a pre-catalyst stock's event date sits against this setup's buying
 * window, in one plain line (DAV-338). The trigger run deciding a buy is
 * told it, and the proposal Dave approves carries it. It is information,
 * never a gate: a buy that fires outside the window still goes to the run,
 * which decides.
 *
 * The window is the setup's own two numbers, the ones the setup's
 * confirmation already uses: it opens CATALYST_WINDOW_DAYS[1] days
 * before the event, and a buy stops being one inside the last
 * PRE_CATALYST_ENTRY_CUTOFF_DAYS. CORT, 2026-09-29, the FDA date Dec 17:
 * "79 days to the event date (Dec 17), 9 days before this setup's window
 * opens (Oct 8)." Its trigger run was told nothing of the kind and proposed
 * a buy.
 *
 * Null for a stock that doesn't live by the window, or has no date.
 */
export function preCatalystWindowLine(row: BinaryRow, asOf: Date = new Date()): string | null {
  if (!isPreCatalystPlay(row) || !row.catalystDate) return null;
  const DAY = 86_400_000;
  const event = new Date(row.catalystDate);
  // Both are 00:00 UTC of a calendar date (the ET trading day for today).
  const daysOut = Math.round((event.getTime() - etTradingDayDate(asOf).getTime()) / DAY);
  const opens = CATALYST_WINDOW_DAYS[1];
  const closes = PRE_CATALYST_ENTRY_CUTOFF_DAYS;
  const on = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const before = (n: number) => new Date(event.getTime() - n * DAY);
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const rule = `A run-up into the event buys ${opens} to ${closes} days before it.`;
  const where =
    daysOut < 0
      ? `the event date on file (${on(event)}) has passed`
      : daysOut > opens
        ? `${days(daysOut)} to the event date (${on(event)}), so the buying window opens in ${days(daysOut - opens)} (${on(before(opens))})`
        : daysOut <= closes
          ? `${days(daysOut)} to the event date (${on(event)}), past the buying window, which closed ${on(before(closes))}`
          : `${days(daysOut)} to the event date (${on(event)}), inside the buying window`;
  return `${where.charAt(0).toUpperCase()}${where.slice(1)}. ${rule}`;
}

const trendTemplate =
  "Trend Template passes (chart.trendTemplate — price above a rising 150/200-day, 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)";

const CATALOG: Omit<Setup, "triggers">[] = [
  {
    id: "BASE_BREAKOUT",
    code: "D1",
    name: "Base breakout (VCP / cup-with-handle / flat base)",
    role: "ENTRY",
    horizons: ["TRADE", "TARGET", "COMPOUNDER"],
    preconditions: [
      trendTemplate,
      "A base of 20+ sessions (chart.base), 15–25% deep at most, the last contraction tighter than the base (≤ 5–8%)",
      "Volume drying up into the pivot",
      "Earnings at least 10 days away",
      "A risk-on market: breakouts fail most in a cautious one (playbook Part C)",
    ],
    entry: {
      confirmation: [
        `A close above the pivot, not an intraday poke (intraday crosses fail about half the time)`,
        `Volume ≥ ${BREAKOUT_VOLUME_RATIO}× average on the breakout day`,
        `No more than ${CHASE_LIMIT_PCT}% past the pivot`,
      ],
      chaseLimitPct: CHASE_LIMIT_PCT,
    },
    sale: { maxPct: TRADE_STOP_MAX_PCT, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    failureSigns: [
      "Closes back below the pivot within days, on volume",
      "Breakout-day volume below average",
      "A breakout into earnings week",
    ],
    summary:
      "A Stage 2 stock consolidates for 4–8+ weeks in a tightening range under a clear ceiling, then breaks out on heavy volume — sellers are exhausted and institutions are buying with size.",
  },
  {
    id: "MOMENTUM_FLAG",
    code: "D2",
    name: "Momentum-leader flag",
    role: "ENTRY",
    horizons: ["TRADE"],
    preconditions: [
      "Already moved 30–100%+ in 1–3 months (top 1–2% by 1/3/6-month return)",
      "Average daily range (chart.adr20Pct) ≥ 3–5%",
      "Orderly pullback: higher lows, tightening range, riding the rising 10/20-day",
      "Dollar volume enough to fill the seat's size",
    ],
    entry: {
      confirmation: ["Range expands upward out of the flag", `Volume ≥ ${BREAKOUT_VOLUME_RATIO}× the 20-day average volume on the day it clears`, "Price above the 10- and 20-day"],
      chaseLimitPct: CHASE_LIMIT_PCT,
    },
    sale: { maxPct: TRADE_STOP_MAX_PCT, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4); 0.25–1% of account at risk.",
    failureSigns: ["No follow-through in 3–5 days", "Closes back inside the flag"],
    summary:
      "A leader that already ran pulls back in an orderly way and surfs its rising short averages; the next leg starts when the range expands upward. No seat runs this today (DAV-245 ruling 3).",
  },
  {
    id: "EPISODIC_PIVOT",
    code: "D3",
    name: "Episodic pivot / earnings gap",
    role: "ENTRY",
    horizons: ["TRADE", "TARGET"],
    preconditions: [
      "Neglected before the news: flat or down for 3–6 months, not already up 30%+ in 3 months",
      `Gap ≥ ${EP_GAP_MIN_PCT}% at the open on a real catalyst (blow-out earnings, approval, contract)`,
      `Volume ≥ ${EP_GAP_MIN_VOLUME_RATIO}× average (ideally 10×)`,
      "Growth numbers mid-double-digit or better; liquidity floor met",
    ],
    entry: {
      confirmation: ["The gap holds (day 2 closes above the gap-day midpoint)", "Volume stays heavy"],
      chaseLimitPct: CHASE_LIMIT_PCT,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4); a wide gap-day low means fewer shares.",
    failureSigns: ["The gap fills", "Closes below the gap-day midpoint", "Volume fades on day 2"],
    summary:
      "A neglected stock reprices on unexpected news with volume many times average; institutions need weeks to build positions, so real gaps start multi-month moves. Breakaway earnings gaps fill within a month under 30% of the time.",
  },
  {
    id: "PEAD",
    code: "D4",
    name: "Post-earnings drift",
    role: "ENTRY",
    horizons: ["TARGET", "TRADE"],
    preconditions: [
      `Reported in the last ${PEAD_ENTRY_WINDOW[0]}–${PEAD_ENTRY_WINDOW[1]} sessions`,
      `EPS surprise ≥ ${PEAD_MIN_SURPRISE_PCT}% and a revenue beat; guidance raised`,
      `Reaction-day volume ≥ ${PEAD_REACTION_VOLUME_RATIO}× the 20-day average`,
      "The gap held — closed in the upper half of the day's range",
      `Not already ${PEAD_MAX_RUN_PAST_GAP_PCT}%+ past the gap`,
      "Never a beat the market sold: a beat that gaps down is a fade signal, not a buy",
    ],
    entry: {
      confirmation: ["Gap held", "Surprise and guidance confirmed from the release or transcript"],
      chaseLimitPct: PEAD_MAX_RUN_PAST_GAP_PCT,
      windowDays: PEAD_ENTRY_WINDOW,
    },
    sale: { maxPct: TRADE_STOP_MAX_PCT, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    failureSigns: [
      "The gap-day low breaks",
      "A beat with flat or vague guidance",
      "Revisions don't follow in the 1–10 days after the print",
    ],
    summary:
      "A clean beat-and-raise the market under-reacts to drifts for weeks. This is the setup where the condition is already true on the day the plan is written.",
  },
  {
    id: "MA_PULLBACK",
    code: "D5",
    name: "Pullback to a rising moving average",
    role: "ENTRY",
    horizons: ["TARGET", "COMPOUNDER", "CATALYST"],
    preconditions: [
      trendTemplate,
      "Relative strength vs SPY positive over 3 months (chart.relativeStrength.vsSpy.m3 > 0)",
      "The pullback comes on below-average volume (healthy), not above (distribution)",
    ],
    entry: {
      confirmation: [
        "The reversal: a close above the prior day's high after touching the average — the tactical run checks this on the fire",
        "The pullback came on below-average volume",
      ],
      chaseLimitPct: CHASE_LIMIT_PCT,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    failureSigns: ["Closes below the 50-day on heavy volume", "The pullback comes on rising volume"],
    summary:
      "Buying a confirmed uptrend at a discount with a natural stop — the moving average is where institutions re-buy. MSFT touched its 50-day repeatedly on the way from $418 to $497.",
  },
  {
    id: "RSI2_BOUNCE",
    code: "D6",
    name: "Mean-reversion bounce in an uptrend (RSI-2)",
    role: "ENTRY",
    horizons: ["TRADE"],
    preconditions: ["Price above the 200-day", "A sharp 2–5 day flush"],
    entry: {
      confirmation: ["Buy the close"],
      chaseLimitPct: null,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4). Best used as a scale-in rule on a held compounder.",
    failureSigns: ["Closes below the 200-day"],
    summary:
      "A stock above its 200-day that flushes hard for a few days tends to snap back within a week. Not a primary seat — a scale-in rule for a held compounder.",
  },
  {
    id: "RS_52W_HIGH",
    code: "D7",
    name: "52-week-high / relative-strength momentum",
    role: "SCREEN",
    horizons: ["TRADE", "TARGET", "COMPOUNDER"],
    preconditions: [
      "Within 5% of the 52-week high (chart.range.pctBelow52wHigh ≤ 5)",
      "Beating SPY over 3–12 months; momentum is negative under 1 month — the window matters",
    ],
    entry: {
      entryVia: ["BASE_BREAKOUT", "MOMENTUM_FLAG", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "From the entry setup used.",
    failureSigns: ["Relative strength rolls over"],
    summary:
      "Stocks near their 52-week high and ahead of the market keep outperforming for up to 12 months (George & Hwang). A ranking, not a trigger.",
  },
  {
    id: "PRE_CATALYST",
    code: "D8",
    name: "Pre-catalyst run-up (PDUFA and dated binaries)",
    role: "ENTRY",
    horizons: ["CATALYST"],
    preconditions: [
      `A dated event ${CATALYST_WINDOW_DAYS[0]}–${CATALYST_WINDOW_DAYS[1]} days out (Thesis.catalystDate)`,
      "A positive advisory-committee vote if one happened",
      "Cash runway past the decision",
      "Sub-$1B single-asset names: supplemental approvals and label expansions only",
    ],
    entry: {
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: [
        "Never the day before the event",
        `Never inside the last ${PRE_CATALYST_ENTRY_CUTOFF_DAYS} days before the date — by then the run-up either happened or did not`,
        "A falling chart is never bought at the market: the level sits ABOVE the current price and the run-up has to start before we are in it",
        // QB ruling 2026-09-26: BBIO, IBRX and CORT landed with no buy waiting for a Trend Template.
        "No Trend Template: a stock drifting into its decision will not pass one",
      ],
      chaseLimitPct: CHASE_LIMIT_PCT,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: BINARY_RISK_MULTIPLIER,
    sizing: `Half the normal risk (DAV-245 ruling 2). If a −50% gap would cost more than ${BINARY_MAX_GAP_LOSS_PCT}% of equity, the position is too big.`,
    failureSigns: ["Run-up stalls inside the window", "Negative read-across from a peer's decision"],
    summary:
      "A dated decision. Trade the run-up (buy 6–8 weeks before, sell 1–2 before, never holding the coin flip) or hold through at a size that survives a −60% gap.",
  },
  {
    id: "INSIDER_CLUSTER",
    code: "D9",
    name: "Insider cluster buying",
    role: "SCREEN",
    horizons: ["TARGET", "COMPOUNDER"],
    preconditions: [
      `${INSIDER_MIN_BUYERS}+ insiders buying on the open market within ${INSIDER_WINDOW_DAYS} days, ideally including independent directors`,
      "Stronger in small and mid caps",
    ],
    entry: {
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
    },
    sale: { maxPct: INSIDER_STOP_MAX_PCT, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    failureSigns: ["Insiders sell into the rally"],
    summary:
      "Three or more insiders buying within a month predicts positive returns over 6–12 months — roughly double a single buy.",
  },
  {
    id: "ESTIMATE_REVISION",
    code: "D10",
    name: "Estimate-revision momentum",
    role: "SCREEN",
    horizons: ["TARGET"],
    preconditions: [
      "Consensus EPS estimates rose in the last 30 days, especially right after a print",
      // Finnhub /stock/eps-estimate refuses (probed 2026-09-11): no plan we hold serves estimate history.
      "Cite a revision only from a source you actually read: no data we hold has the revision number",
    ],
    entry: {
      entryVia: ["PEAD", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "From the entry setup used.",
    failureSigns: ["Revisions turn down"],
    summary: "Rising estimates extend post-earnings drift; the Zacks Rank in one line.",
  },
  {
    id: "COMPOUNDER_ACCUMULATION",
    code: "D11",
    name: "Compounder accumulation",
    role: "ENTRY",
    horizons: ["COMPOUNDER"],
    preconditions: [
      "Quality: ROIC > 20% for years, high stable gross margin for its industry, FCF margin ≥ 15%, high reinvestment at high returns, aligned management",
      "A business that will be structurally more valuable in 3–5 years",
    ],
    entry: {
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: ["Thesis intact; volume matters less than for a trade", "A stock at new highs on a working thesis is working, not extended"],
      chaseLimitPct: null,
    },
    sale: { maxPct: COMPOUNDER_STOP_MAX_PCT, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: "First tranche 50% of target size; second on strength (+7% from the first fill, or a new high after a pause) or on a held 50-day pullback in a market-wide dip. Never add into company-specific bad news.",
    failureSigns: ["The named invalidation happens", "Guidance cut", "Margin break"],
    summary:
      "A business bought at conviction size and held through volatility, entered on confirmation rather than hope, sold only when the story breaks.",
  },
  {
    id: "SECTOR_ROTATION",
    code: "D12",
    name: "Sector and theme rotation",
    role: "SCREEN",
    horizons: ["TARGET", "TRADE"],
    preconditions: [
      "The stock's group is Leading or Improving by relative strength vs SPY and its slope",
      "Buy the leader in a leading group; skip the best chart in a lagging group",
    ],
    entry: {
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
    },
    sale: { maxPct: null, minAtr: MIN_STOP_ATR },
    riskMultiplier: 1,
    sizing: `From the entry setup used; at most ${MAX_NAMES_PER_INDUSTRY} names per industry group.`,
    failureSigns: ["The group turns Lagging — a review for every name in it"],
    summary: "Stocks move in groups and leadership rotates; three longs in one group are one bet.",
  },
];

export const SETUPS: Setup[] = CATALOG.map((s) => ({ ...s, triggers: PLAYBOOK_TEMPLATES[s.id] }));

// ── The analyst's setups (DAV-280) ────────────────────────────────────────

/**
 * The setups an analyst may write on: `AgentConfig.setupIds`, a setting on
 * the analyst (the builder proposes it, the analyst page edits it). An
 * analyst with none chosen gets the whole catalog rather than nothing — a
 * blank setting must never silently empty the writer's choices. Unknown ids
 * (a setup since removed) are ignored.
 */
export function setupsForAnalyst(setupIds: readonly string[] | null | undefined, overrides?: SetupOverrides): Setup[] {
  const chosen = (setupIds ?? []).filter(isNamedSetup);
  const list = chosen.length ? chosen.map((id) => SETUPS.find((s) => s.id === id)!) : SETUPS;
  return overrides ? list.map((s) => applySetupOverride(s, overrides[s.id])) : list;
}

// ── Lookups ───────────────────────────────────────────────────────────────

/** The catalog entry, with an account's playbook numbers laid over it when given (DAV-273). */
export function getSetup(id: string, overrides?: SetupOverrides): Setup | undefined {
  const s = SETUPS.find((x) => x.id === id.toUpperCase());
  return s && overrides ? applySetupOverride(s, overrides[s.id]) : s;
}

export function setupIndex(): { id: SetupId; code: string; name: string; role: Setup["role"]; horizons: Horizon[] }[] {
  return SETUPS.map(({ id, code, name, role, horizons }) => ({ id, code, name, role, horizons }));
}

const conditionsOfTemplate = (p: TemplatePredicate): TemplateCondition[] => ("match" in p ? p.conditions : [p]);

/** The `{placeholders}` a template uses. */
export function templatePlaceholders(p: TemplatePredicate | null): string[] {
  return p ? conditionsOfTemplate(p).flatMap((c) => (typeof c.value === "string" ? [c.value] : [])) : [];
}

/** The template with each `{placeholder}` replaced by `fill(name)`. */
export function fillTemplate(p: TemplatePredicate, fill: (name: Placeholder) => number): When {
  const filled = (c: TemplateCondition) => ({ ...c, value: typeof c.value === "string" ? fill(c.value) : c.value }) as Condition;
  return "match" in p ? { match: "all", conditions: p.conditions.map(filled) } : filled(p);
}
