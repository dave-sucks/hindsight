/**
 * setups.ts — the setup catalog: the buy patterns a plan is built from.
 *
 * docs/plans/TRADING_PLAYBOOK.md Part D (D1–D12) as data. Each entry says
 * what the pattern is, which horizons and seats it fits, what must be true
 * first, the entry as trigger conditions with placeholders the writer fills
 * from the chart (lib/market-data/price-structure.ts), how the stop and
 * target are set (Part E), the size note, the trail by horizon, the time
 * limit, and what failure looks like.
 *
 * Read through read_knowledge_library (topic "setup"). A thesis records the
 * pattern it was written on in `Thesis.setupId`. Nothing here refuses
 * anything: it is the knowledge the writer (PR 4), tactical run (PR 6),
 * screens (PR 9) and scorecard (PR 11) consume. DAV-244.
 *
 * The numbers are the playbook's, blessed by Dave on DAV-245 (2026-09-11).
 * They live at the top of this file so one edit changes them everywhere.
 */

import type { TriggerPredicate } from "@/lib/agent/triggers/types";
import { applySetupOverride, type SetupOverrides } from "./setup-overrides";

// ── The numbers (DAV-245 ruling 1: playbook defaults accepted) ───────────

/** A TRADE-horizon stop is never wider than this from entry (O'Neil 7–8%). */
export const TRADE_STOP_MAX_PCT = 8;
/** A stop closer than this many ATR(14) to entry is inside the noise. */
export const MIN_STOP_ATR = 1;
/** Breakout-day volume vs the average that makes a breakout real. */
export const BREAKOUT_VOLUME_RATIO = 1.5;
/** Do not buy more than this far past the pivot / entry condition. */
export const CHASE_LIMIT_PCT = 5;
/** The reward-to-risk floor every plan clears (Hindsight enforces 2:1). */
export const MIN_REWARD_RISK = 2;
/** Sum of open risk if every stop hits, as % of equity (Elder). */
export const PORTFOLIO_HEAT_PCT = 6;
/** Most names held in one industry group. */
export const MAX_NAMES_PER_INDUSTRY = 2;
/** The only automatic sale on a compounder: this far off the high. */
export const COMPOUNDER_CATASTROPHE_PCT = 25;
/** A compounder giving back this much from its high opens a review. */
export const COMPOUNDER_GIVEBACK_REVIEW_PCT = 15;

/**
 * Playbook E5: a trail is "the larger of 3× the stock's average daily range
 * or the analyst's percent". A quiet name and a jumpy one should not wear
 * the same give-back — MU's range is $50 a day, ABT's is $2.58 (DAV-294).
 */
export const TRAIL_ATR_MULTIPLE = 3;

/**
 * Playbook: "sell part into strength at +20–25%, unless the stock did +20%
 * in ≤ 3 weeks — then hold". A stock that runs this far off the buy THAT
 * FAST is a likely big winner: the partial sale at N R is off and the trail
 * manages it from there. Cutting a winner in half is how a good year becomes
 * an average one.
 *
 * Both halves are load-bearing. The size alone would switch the partial off
 * for any name that ever touched +20% — including a six-month grind, which
 * is an ordinary winner and exactly what the partial is for. On the book
 * today SMMT ran 30.5% in 13 days (fast) while MU took 54 days to reach
 * 15.5% (a grind).
 */
export const BIG_WINNER_PEAK_GAIN_PCT = 20;
/** …and it has to have got there within this many days of the buy. */
export const BIG_WINNER_PEAK_WITHIN_DAYS = 21;
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
/** Pre-catalyst: the entry window before a dated event, in days. */
export const CATALYST_WINDOW_DAYS: [number, number] = [14, 70];
/** Insider cluster: buyers within the window. */
export const INSIDER_MIN_BUYERS = 3;
export const INSIDER_WINDOW_DAYS = 30;
export const INSIDER_STOP_MAX_PCT = 12;
/** RSI(2) mean reversion: buy below, sell above. */
export const RSI2_ENTRY_BELOW = 10;
export const RSI2_EXIT_ABOVE = 65;
/** A buy level unfilled this many trading days gets re-priced (Part E6). */
export const UNFILLED_REPRICE_TRADING_DAYS = 20;

// ── Types ─────────────────────────────────────────────────────────────────

export type Horizon = "TRADE" | "TARGET" | "CATALYST" | "COMPOUNDER";

/**
 * A `{name}` the writer fills from the chart or the calendar at write time.
 * Every name used in a template is defined in PLACEHOLDERS.
 */
export type Placeholder = `{${string}}`;
type Level = number | Placeholder;

/** Kinds deleted in DAV-247 (they could never fire) — no template may name them. */
export const DELETED_KINDS = ["SIGNAL_TYPE", "GUIDANCE_CHANGE", "FILING"] as const;

export type TemplateKind = TriggerPredicate["kind"];

/**
 * An entry condition with holes: the TriggerPredicate shapes, with a price
 * level allowed to be a `{placeholder}` the writer fills from the chart.
 */
export type TemplatePredicate =
  | { kind: "PRICE_ABOVE" | "PRICE_BELOW"; level: Level; basis?: "close" | "intraday" }
  | { kind: "VOLUME_RATIO"; min: number }
  | { kind: "NEW_HIGH"; window: "20D" | "52W" }
  | { kind: "NEAR_SMA"; period: 20 | 50 | 150 | 200; withinPct: number }
  | { kind: "VS_SMA"; period: 20 | 50 | 150 | 200; direction: "ABOVE" | "BELOW" }
  | { kind: "PCT_FROM_52W_HIGH"; max: number }
  | { kind: "RS_VS_SPY"; window: "1M" | "3M" | "6M"; min: number }
  | { kind: "GAP_UP"; minPct: number; minVolRatio: number; withinDays?: number }
  | { kind: "RSI"; period?: 2 | 14; threshold: number; direction: "ABOVE" | "BELOW" }
  | { kind: "EARNINGS_SINCE"; min: number; max: number }
  | { kind: "EARNINGS_WITHIN"; days: number }
  | { kind: "AND" | "OR"; predicates: TemplatePredicate[] };

/** Compile-time: every template kind is a real trigger kind. */
type AssertKinds<T extends TemplateKind> = T;
export type TemplatePredicateKind = AssertKinds<TemplatePredicate["kind"]>;

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
  /** Strategy-archetype ids (strategy-archetypes.ts) this pattern serves. */
  archetypes: string[];
  /** What must be true before the pattern applies (trend, regime, fundamentals). */
  preconditions: string[];
  entry: {
    /** The condition, with placeholders. Null for a SCREEN. */
    template: TemplatePredicate | null;
    /** For a SCREEN: the ENTRY setups whose condition is used. */
    entryVia?: SetupId[];
    /** What else must be true on the day (checked by the tactical run). */
    confirmation: string[];
    /** Max % past the level a buy may be placed; null = no chase rule. */
    chaseLimitPct: number | null;
    /**
     * Days after the report inside which this entry applies — the same
     * count the EARNINGS_SINCE kind evaluates (the report day is 0). Past
     * the last day the setup no longer applies and the writer is told so
     * (HPE 2026-09-15: written as PEAD 13 days after the print, with no
     * plan the drift rules could price).
     */
    windowDays?: [number, number];
    text: string;
  };
  stop: {
    /** The structure the stop sits under, in order of preference. */
    structure: string[];
    /** Widest the stop may be from entry, %, where the pattern caps it. */
    maxPct: number | null;
    minAtr: number;
    text: string;
  };
  target: { minR: number; text: string };
  /** Multiplies the risk-per-trade (1.0 normal; binary events 0.5). */
  riskMultiplier: number;
  sizing: string;
  trail: Partial<Record<Horizon, string>>;
  /**
   * What a fill writes onto the stock as its own exits (lib/agent/triggers/
   * setup-exits.ts) — the setup's rules, not the seat's style (the trail
   * lives on the analyst): a partial sale at this many R, and the
   * beat-the-market-sold review (a beat with the stock down 3% on the day).
   * The time limit is `time`, counted from the buy.
   */
  manage: { partialAtR: number | null; beatAndFadeReview: boolean };
  /**
   * The time limit, in the unit the playbook wrote it in.
   *
   * The short ones are SESSIONS — "no progress in 10–20 sessions is a failed
   * breakout" counts days the market was open, so a long weekend does not
   * spend the stock's rope. The 60-day checkpoints are CALENDAR: "a 60-day
   * business checkpoint" is two months of the company's life, not 60 opens.
   * Nothing here is a time stop; every one of them is a review.
   *
   * A trigger's day count from the buy is calendar days, so SESSIONS is
   * converted against the real NYSE calendar in ONE place — `setupExitTriggers`
   * in lib/agent/triggers/setup-exits.ts, at the moment the fill writes it.
   * Never multiply by 7/5: that is wrong by a day around every holiday.
   */
  time: { count: number | null; unit: "SESSIONS" | "CALENDAR"; text: string };
  failureSigns: string[];
  /** The playbook's paragraph, condensed. */
  summary: string;
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
  "{entry}": "the entry level this plan uses",
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

const trendTemplate =
  "Trend Template passes (chart.trendTemplate — price above a rising 150/200-day, 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)";

export const SETUPS: Setup[] = [
  {
    id: "BASE_BREAKOUT",
    code: "D1",
    name: "Base breakout (VCP / cup-with-handle / flat base)",
    role: "ENTRY",
    horizons: ["TRADE", "TARGET", "COMPOUNDER"],
    archetypes: ["MOMENTUM_BREAKOUT", "THEMATIC_SECULAR", "CATALYST_EVENT"],
    preconditions: [
      trendTemplate,
      "A base of 20+ sessions (chart.base), 15–25% deep at most, the last contraction tighter than the base (≤ 5–8%)",
      "Volume drying up into the pivot",
      "Earnings at least 10 days away",
      "Regime RISK_ON — breakouts fail most in CAUTION (Part C)",
    ],
    entry: {
      template: {
        kind: "AND",
        predicates: [
          { kind: "PRICE_ABOVE", level: "{pivot}", basis: "close" },
          { kind: "VOLUME_RATIO", min: BREAKOUT_VOLUME_RATIO },
          { kind: "PRICE_BELOW", level: "{pivotChase}" },
        ],
      },
      confirmation: [
        `A close above the pivot, not an intraday poke (intraday crosses fail about half the time)`,
        `Volume ≥ ${BREAKOUT_VOLUME_RATIO}× average on the breakout day`,
        `No more than ${CHASE_LIMIT_PCT}% past the pivot`,
      ],
      chaseLimitPct: CHASE_LIMIT_PCT,
      text: `Close above the pivot on ${BREAKOUT_VOLUME_RATIO}× volume, not more than ${CHASE_LIMIT_PCT}% past it.`,
    },
    stop: {
      structure: ["the last contraction's low", "the base low, if within the max"],
      maxPct: TRADE_STOP_MAX_PCT,
      minAtr: MIN_STOP_ATR,
      text: `Under the last contraction's low, or the base low if that is within ${TRADE_STOP_MAX_PCT}%. At least ${MIN_STOP_ATR} ATR from entry. If structure needs a wider stop, the position is smaller — the stop is not wider.`,
    },
    target: {
      minR: MIN_REWARD_RISK,
      text: "Measured move (base depth added to the pivot) or the next prior high, whichever two methods agree on. ≥ 2R; 3R is the design (7–8% stop, 20–25% target).",
    },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    trail: {
      TRADE: "Stop to breakeven at +1R; close under the 21-day EMA.",
      TARGET: "After +10%: max(3 ATR, 12–15%) under the high, or a close under the 50-day.",
      COMPOUNDER: "No automatic sale under 25%; a 15% give-back and a close under the 200-day are reviews.",
    },
    manage: { partialAtR: 2, beatAndFadeReview: true },
    time: {
      count: 20,
      unit: "SESSIONS",
      text: "No progress in 10–20 sessions = a failed breakout; exit or re-set. If it gains 20% within 3 weeks of the breakout, hold at least 8 weeks (O'Neil's 8-week rule) instead of selling the partial.",
    },
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
    archetypes: ["MOMENTUM_BREAKOUT"],
    preconditions: [
      "Already moved 30–100%+ in 1–3 months (top 1–2% by 1/3/6-month return)",
      "Average daily range (chart.adr20Pct) ≥ 3–5%",
      "Orderly pullback: higher lows, tightening range, riding the rising 10/20-day",
      "Dollar volume enough to fill the seat's size",
    ],
    entry: {
      template: {
        kind: "AND",
        predicates: [
          { kind: "PRICE_ABOVE", level: "{flagHigh}", basis: "close" },
          { kind: "VOLUME_RATIO", min: BREAKOUT_VOLUME_RATIO },
        ],
      },
      confirmation: ["Range expands upward out of the flag", "Price above the 10- and 20-day"],
      chaseLimitPct: CHASE_LIMIT_PCT,
      text: "Close above the flag high on volume.",
    },
    stop: {
      structure: ["the entry day's low"],
      maxPct: TRADE_STOP_MAX_PCT,
      minAtr: MIN_STOP_ATR,
      text: "The entry day's low, never wider than one ADR. If the structure forces a wider stop, the position is smaller.",
    },
    target: {
      minR: MIN_REWARD_RISK,
      text: "No fixed target: sell a third to a half after 3–5 days of progress, stop to breakeven, trail the rest.",
    },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4); 0.25–1% of account at risk.",
    trail: { TRADE: "Close under the 10-day (aggressive) or 20-day (patient)." },
    manage: { partialAtR: null, beatAndFadeReview: true },
    time: { count: 5, unit: "SESSIONS", text: "If it hasn't moved in 3–5 sessions, it's wrong; exit." },
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
    archetypes: ["EARNINGS_DRIFT", "CATALYST_EVENT"],
    preconditions: [
      "Neglected before the news: flat or down for 3–6 months, not already up 30%+ in 3 months",
      `Gap ≥ ${EP_GAP_MIN_PCT}% at the open on a real catalyst (blow-out earnings, approval, contract)`,
      `Volume ≥ ${EP_GAP_MIN_VOLUME_RATIO}× average (ideally 10×)`,
      "Growth numbers mid-double-digit or better; liquidity floor met",
    ],
    entry: {
      template: {
        kind: "AND",
        predicates: [
          // The gap happened today or in the last two sessions — the entry is
          // day 1 (close above the gap-day high) or day 2 (hold the midpoint).
          { kind: "GAP_UP", minPct: EP_GAP_MIN_PCT, minVolRatio: EP_GAP_MIN_VOLUME_RATIO, withinDays: 3 },
          {
            kind: "OR",
            predicates: [
              { kind: "PRICE_ABOVE", level: "{gapDayHigh}", basis: "close" },
              { kind: "PRICE_ABOVE", level: "{gapDayMid}", basis: "close" },
            ],
          },
        ],
      },
      confirmation: ["The gap holds (day 2 closes above the gap-day midpoint)", "Volume stays heavy"],
      chaseLimitPct: CHASE_LIMIT_PCT,
      text: "A close above the gap-day high, or a day-2 hold above the gap-day midpoint.",
    },
    stop: {
      structure: ["the gap-day low"],
      maxPct: null,
      minAtr: MIN_STOP_ATR,
      text: "The gap-day low. A close below the gap's midpoint is an early warning; a filled gap is invalidation.",
    },
    target: { minR: MIN_REWARD_RISK, text: "Partial at 3–5 days of progress; the trail decides the rest." },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4); a wide gap-day low means fewer shares.",
    trail: {
      TRADE: "Close under the 10- or 20-day.",
      TARGET: "After +10%: max(3 ATR, 12–15%) under the high, or a close under the 21-day EMA.",
    },
    manage: { partialAtR: null, beatAndFadeReview: true },
    time: { count: 5, unit: "SESSIONS", text: "Partial at 3–5 sessions; the trail decides the rest." },
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
    archetypes: ["EARNINGS_DRIFT"],
    preconditions: [
      `Reported in the last ${PEAD_ENTRY_WINDOW[0]}–${PEAD_ENTRY_WINDOW[1]} sessions`,
      `EPS surprise ≥ ${PEAD_MIN_SURPRISE_PCT}% and a revenue beat; guidance raised`,
      `Reaction-day volume ≥ ${PEAD_REACTION_VOLUME_RATIO}× the 20-day average`,
      "The gap held — closed in the upper half of the day's range",
      `Not already ${PEAD_MAX_RUN_PAST_GAP_PCT}%+ past the gap`,
      "Never a beat the market sold: a beat that gaps down is a fade signal, not a buy",
    ],
    entry: {
      template: {
        kind: "AND",
        predicates: [
          { kind: "EARNINGS_SINCE", min: PEAD_ENTRY_WINDOW[0], max: PEAD_ENTRY_WINDOW[1] },
          { kind: "PRICE_ABOVE", level: "{gapDayLow}" },
        ],
      },
      confirmation: ["Gap held", "Surprise and guidance confirmed from the release or transcript"],
      chaseLimitPct: PEAD_MAX_RUN_PAST_GAP_PCT,
      windowDays: PEAD_ENTRY_WINDOW,
      text: `Days ${PEAD_ENTRY_WINDOW[0]}–${PEAD_ENTRY_WINDOW[1]} after the print, above the gap-day low — usually already true, so the entry is set at the current price. After day ${PEAD_ENTRY_WINDOW[1]} the drift entry is gone; a name still worth owning in an uptrend is written on the pullback setup (MA_PULLBACK).`,
    },
    stop: {
      structure: ["the gap-day low", `−${TRADE_STOP_MAX_PCT}% from entry`],
      maxPct: TRADE_STOP_MAX_PCT,
      minAtr: MIN_STOP_ATR,
      text: `The gap-day low or −${TRADE_STOP_MAX_PCT}% from entry, whichever is tighter — but not inside 1 ATR.`,
    },
    target: {
      minR: MIN_REWARD_RISK,
      text: "The prior high or a measured move; partial at 2R.",
    },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    trail: {
      TARGET: "After +10%: max(3 ATR, 12–15%) under the high.",
      TRADE: "Close under the 20-day.",
    },
    manage: { partialAtR: 2, beatAndFadeReview: true },
    time: {
      count: 60,
      unit: "CALENDAR",
      text: "Hold 30–60 days; the bulk of the drift is inside ~20 sessions. Out before the next print.",
    },
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
    archetypes: ["THEMATIC_SECULAR", "EARNINGS_DRIFT", "CATALYST_EVENT", "SECTOR_ROTATION"],
    preconditions: [
      trendTemplate,
      "Relative strength vs SPY positive over 3 months (chart.relativeStrength.vsSpy.m3 > 0)",
      "The pullback comes on below-average volume (healthy), not above (distribution)",
    ],
    entry: {
      // The arm. The buy level itself is the average, written as the plan's
      // entry price; the reversal is the tactical run's confirmation, not a
      // stored condition. A stored "close above the prior day's high" needs
      // a level something re-sets every day, and nothing did — the writer
      // had an entry it could not store (HPE 2026-09-15).
      template: {
        kind: "OR",
        predicates: [
          { kind: "NEAR_SMA", period: 20, withinPct: PULLBACK_NEAR_SMA_PCT },
          { kind: "NEAR_SMA", period: 50, withinPct: PULLBACK_NEAR_SMA_PCT },
        ],
      },
      confirmation: [
        "The reversal: a close above the prior day's high after touching the average — the tactical run checks this on the fire",
        "The pullback came on below-average volume",
      ],
      chaseLimitPct: CHASE_LIMIT_PCT,
      text: `Within ${PULLBACK_NEAR_SMA_PCT}% of the rising 20- or 50-day. The buy level is the average itself; the tactical run confirms the touch held (a close above the prior day's high). This is the entry for a stock that never dips 10%.`,
    },
    stop: {
      structure: [
        "the pullback's swing low, once it has printed",
        "until then, 1 ATR under the average being bought",
      ],
      maxPct: null,
      minAtr: MIN_STOP_ATR,
      text: "Under the pullback's swing low once it has printed; until then, 1 ATR under the average being bought (the 20-day for a 20-day pullback). At least 1 ATR from entry. A close below the 50-day on volume invalidates.",
    },
    target: { minR: MIN_REWARD_RISK, text: "The prior high first (a partial), then the measured move." },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    trail: {
      TARGET: "After +10%: max(3 ATR, 12–15%) under the high, or a close under the 50-day.",
      COMPOUNDER: "No automatic sale under 25%; a 15% give-back and a close under the 200-day are reviews.",
      CATALYST: "The structural stop until the event.",
    },
    manage: { partialAtR: null, beatAndFadeReview: true },
    time: { count: 10, unit: "SESSIONS", text: "10 sessions to reclaim the prior high, else review." },
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
    archetypes: ["MEAN_REVERSION_OVERSOLD"],
    preconditions: ["Price above the 200-day", "A sharp 2–5 day flush"],
    entry: {
      template: {
        kind: "AND",
        predicates: [
          { kind: "VS_SMA", period: 200, direction: "ABOVE" },
          { kind: "RSI", period: 2, threshold: RSI2_ENTRY_BELOW, direction: "BELOW" },
        ],
      },
      confirmation: ["Buy the close"],
      chaseLimitPct: null,
      text: `Above the 200-day with RSI(2) under ${RSI2_ENTRY_BELOW}; buy the close.`,
    },
    stop: {
      structure: ["a close below the 200-day"],
      maxPct: null,
      minAtr: MIN_STOP_ATR,
      text: "No fixed stop in the original; time and the 200-day are the stops.",
    },
    target: {
      minR: 1,
      text: `Exit on a close above the 5-day average or RSI(2) > ${RSI2_EXIT_ABOVE}. Small average gains, 65–75% win rate — the 2R floor does not describe this pattern.`,
    },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4). Best used as a scale-in rule on a held compounder.",
    trail: { TRADE: `Close above the 5-day average or RSI(2) > ${RSI2_EXIT_ABOVE}.` },
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: 5, unit: "SESSIONS", text: "Snaps back within 1–5 sessions or it's out." },
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
    archetypes: ["MOMENTUM_BREAKOUT", "THEMATIC_SECULAR", "SECTOR_ROTATION"],
    preconditions: [
      "Within 5% of the 52-week high (chart.range.pctBelow52wHigh ≤ 5)",
      "Beating SPY over 3–12 months; momentum is negative under 1 month — the window matters",
    ],
    entry: {
      template: null,
      entryVia: ["BASE_BREAKOUT", "MOMENTUM_FLAG", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
      text: "A screen: it says which names; D1/D2/D5 say when. As a condition: PCT_FROM_52W_HIGH ≤ 5 and RS_VS_SPY 3M > 0.",
    },
    stop: { structure: [], maxPct: null, minAtr: MIN_STOP_ATR, text: "From the entry setup used." },
    target: { minR: MIN_REWARD_RISK, text: "From the entry setup used." },
    riskMultiplier: 1,
    sizing: "From the entry setup used.",
    trail: {},
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: null, unit: "SESSIONS", text: "From the entry setup used." },
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
    archetypes: ["CATALYST_EVENT"],
    preconditions: [
      `A dated event ${CATALYST_WINDOW_DAYS[0]}–${CATALYST_WINDOW_DAYS[1]} days out (Thesis.catalystDate) — give it a REVIEW trigger counted from the event (REVIEW_CADENCE, from: "EVENT", side: "BEFORE") so the run opens the stock while there is still time to act, not on the day it resolves`,
      "A positive advisory-committee vote if one happened",
      "Cash runway past the decision",
      "Sub-$1B single-asset names: supplemental approvals and label expansions only",
    ],
    entry: {
      template: null,
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: ["Never the day before the event"],
      chaseLimitPct: CHASE_LIMIT_PCT,
      text: "A technical entry (D1 or D5 shape) inside the window, never the day before.",
    },
    stop: {
      structure: ["the entry setup's structure"],
      maxPct: null,
      minAtr: MIN_STOP_ATR,
      text: "Structural but advisory: gaps skip stops. Size is the stop.",
    },
    target: {
      minR: MIN_REWARD_RISK,
      text: "Run-up version: sell 1–2 weeks before the event (typically +20–40%). Hold-through version: exit at the event or T+30.",
    },
    riskMultiplier: BINARY_RISK_MULTIPLIER,
    sizing: `Half the normal risk (DAV-245 ruling 2). If a −50% gap would cost more than ${BINARY_MAX_GAP_LOSS_PCT}% of equity, the position is too big.`,
    trail: { CATALYST: "The structural stop until the event; the event is the exit." },
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: null, unit: "SESSIONS", text: "The event, or T+30." },
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
    archetypes: ["INSIDER_ACTIVITY"],
    preconditions: [
      `${INSIDER_MIN_BUYERS}+ insiders buying on the open market within ${INSIDER_WINDOW_DAYS} days, ideally including independent directors`,
      "Stronger in small and mid caps",
    ],
    entry: {
      template: null,
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
      text: "A screen and a conviction input; the entry is a D1 or D5 condition. As a wake: INSIDER_CLUSTER (≥ 3 open-market buyers within 30 days) → REVIEW, with the buyers named on the fire.",
    },
    stop: {
      structure: ["the lowest insider purchase price"],
      maxPct: INSIDER_STOP_MAX_PCT,
      minAtr: MIN_STOP_ATR,
      text: `Below the lowest insider purchase price or −${INSIDER_STOP_MAX_PCT}%, whichever is tighter.`,
    },
    target: { minR: MIN_REWARD_RISK, text: "From the entry setup used; the effect runs 6–12 months." },
    riskMultiplier: 1,
    sizing: "Risk-based (Part E4).",
    trail: {},
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: null, unit: "SESSIONS", text: "6–12 months for the effect; the entry setup's clock for the trade." },
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
    archetypes: ["EARNINGS_DRIFT"],
    preconditions: ["Consensus EPS estimates rose in the last 30 days, especially right after a print"],
    entry: {
      template: null,
      entryVia: ["PEAD", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
      text: "A screen and D4's third confirmation — but no plan we hold serves estimate history (Finnhub /stock/eps-estimate refuses; probed 2026-09-11), so there is no revision number to read and no trigger kind for it. Cite a revision only from a source you actually read.",
    },
    stop: { structure: [], maxPct: null, minAtr: MIN_STOP_ATR, text: "From the entry setup used." },
    target: { minR: MIN_REWARD_RISK, text: "From the entry setup used." },
    riskMultiplier: 1,
    sizing: "From the entry setup used.",
    trail: {},
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: null, unit: "SESSIONS", text: "From the entry setup used." },
    failureSigns: ["Revisions turn down"],
    summary: "Rising estimates extend post-earnings drift; the Zacks Rank in one line.",
  },
  {
    id: "COMPOUNDER_ACCUMULATION",
    code: "D11",
    name: "Compounder accumulation",
    role: "ENTRY",
    horizons: ["COMPOUNDER"],
    archetypes: ["THEMATIC_SECULAR"],
    preconditions: [
      "Quality: ROIC > 20% for years, high stable gross margin for its industry, FCF margin ≥ 15%, high reinvestment at high returns, aligned management",
      "A business that will be structurally more valuable in 3–5 years",
    ],
    entry: {
      template: {
        kind: "OR",
        predicates: [
          {
            kind: "AND",
            predicates: [
              { kind: "PRICE_ABOVE", level: "{pivot}", basis: "close" },
              { kind: "VOLUME_RATIO", min: BREAKOUT_VOLUME_RATIO },
            ],
          },
          { kind: "NEAR_SMA", period: 50, withinPct: PULLBACK_NEAR_SMA_PCT },
          { kind: "VS_SMA", period: 50, direction: "ABOVE" },
        ],
      },
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: ["Thesis intact; volume matters less than for a trade"],
      chaseLimitPct: null,
      text: "Whichever comes first: a base breakout, a reclaim of the 50-day, or a pullback that holds the 50-day. A stock at new highs on a working thesis is working, not extended; with no pullback in 30 days of uptrend, take the breakout. When one is already true, set the entry at the current price.",
    },
    stop: {
      structure: ["a named thesis invalidation"],
      maxPct: COMPOUNDER_CATASTROPHE_PCT,
      minAtr: MIN_STOP_ATR,
      text: `Thesis invalidation named in advance (guidance cut twice, margin break, capital-allocation failure). A close below the 200-day and a ${COMPOUNDER_GIVEBACK_REVIEW_PCT}% give-back are reviews. The ${COMPOUNDER_CATASTROPHE_PCT}% catastrophe line off the high is the only automatic sale.`,
    },
    target: { minR: MIN_REWARD_RISK, text: "A 3–5 year valuation case; trims only at valuation extremes." },
    riskMultiplier: 1,
    sizing: "First tranche 50% of target size; second on strength (+7% from the first fill, or a new high after a pause) or on a held 50-day pullback in a market-wide dip. Never add into company-specific bad news.",
    trail: {
      COMPOUNDER: `No automatic sale under ${COMPOUNDER_CATASTROPHE_PCT}%; a ${COMPOUNDER_GIVEBACK_REVIEW_PCT}% give-back and a close under the 200-day are reviews.`,
    },
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: 60, unit: "CALENDAR", text: "A 60-day business checkpoint (is what we said would happen starting to happen?) — a review, never a time stop." },
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
    archetypes: ["SECTOR_ROTATION"],
    preconditions: [
      "The stock's group is Leading or Improving by relative strength vs SPY and its slope",
      "Buy the leader in a leading group; skip the best chart in a lagging group",
    ],
    entry: {
      template: null,
      entryVia: ["BASE_BREAKOUT", "MA_PULLBACK"],
      confirmation: [],
      chaseLimitPct: null,
      text: "A screen and a regime input. (A group-rank trigger kind is not in the plan yet.)",
    },
    stop: { structure: [], maxPct: null, minAtr: MIN_STOP_ATR, text: "From the entry setup used." },
    target: { minR: MIN_REWARD_RISK, text: "From the entry setup used." },
    riskMultiplier: 1,
    sizing: `From the entry setup used; at most ${MAX_NAMES_PER_INDUSTRY} names per industry group.`,
    trail: {},
    manage: { partialAtR: null, beatAndFadeReview: false },
    time: { count: null, unit: "SESSIONS", text: "From the entry setup used." },
    failureSigns: ["The group turns Lagging — a review for every name in it"],
    summary: "Stocks move in groups and leadership rotates; three longs in one group are one bet.",
  },
];

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

/** The kinds a template uses, recursively. */
export function templateKinds(p: TemplatePredicate | null): string[] {
  if (!p) return [];
  if (p.kind === "AND" || p.kind === "OR") return [p.kind, ...p.predicates.flatMap(templateKinds)];
  return [p.kind];
}

/** The `{placeholders}` a template uses, recursively. */
export function templatePlaceholders(p: TemplatePredicate | null): string[] {
  if (!p) return [];
  if (p.kind === "AND" || p.kind === "OR") return p.predicates.flatMap(templatePlaceholders);
  if ((p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW") && typeof p.level === "string") return [p.level];
  return [];
}

/** One line per condition, for tool output and prompts. */
export function describeTemplate(p: TemplatePredicate | null): string {
  if (!p) return "(no condition of its own)";
  switch (p.kind) {
    case "AND":
    case "OR":
      return `${p.kind}[${p.predicates.map(describeTemplate).join(", ")}]`;
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return `${p.kind}(${p.level}${p.basis ? `, ${p.basis}` : ""})`;
    case "VOLUME_RATIO":
      return `VOLUME_RATIO ≥ ${p.min}×`;
    case "NEW_HIGH":
      return `NEW_HIGH(${p.window})`;
    case "NEAR_SMA":
      return `NEAR_SMA(${p.period}-day, within ${p.withinPct}%)`;
    case "VS_SMA":
      return `VS_SMA(${p.direction} ${p.period}-day)`;
    case "PCT_FROM_52W_HIGH":
      return `PCT_FROM_52W_HIGH ≤ ${p.max}%`;
    case "RS_VS_SPY":
      return `RS_VS_SPY(${p.window}) > ${p.min}`;
    case "GAP_UP":
      return `GAP_UP(≥ ${p.minPct}% on ≥ ${p.minVolRatio}× volume${p.withinDays ? `, within ${p.withinDays} sessions` : ""})`;
    case "RSI":
      return `RSI(${p.period ?? 14}) ${p.direction === "BELOW" ? "<" : ">"} ${p.threshold}`;
    case "EARNINGS_SINCE":
      return `EARNINGS_SINCE(${p.min}–${p.max} days)`;
    case "EARNINGS_WITHIN":
      return `EARNINGS_WITHIN(${p.days} days)`;
  }
}
