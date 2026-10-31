/**
 * Strategy archetypes — the playbooks a new analyst is built from.
 *
 * A playbook carries the style as data: the setups an analyst on it runs
 * (signature first), how long it holds, the confidence a buy needs, how many
 * stocks it holds at once, and the fence its edge needs, if any. The builder
 * names a playbook in suggest_config and the tool fills those fields in, so
 * the model never types them (playbookFields). Its promptSkeleton is the
 * strategy text in seven parts, with no number a setting, setup or account
 * rule owns.
 *
 * Three are tested: the live analysts were built on them, and
 * playbooks.replay.test.ts holds them to those analysts' settings.
 */

import type { Sector } from "@/lib/universe/canonical";
import type { SetupId } from "./setups";

export type HoldDuration = "DAY" | "SWING" | "POSITION";
export type DirectionBias = "LONG" | "SHORT" | "BOTH";
export interface StrategyArchetype {
  /** SCREAMING_SNAKE_CASE unique ID */
  id: string;
  /** Short human label, e.g. "Earnings Drift" */
  name: string;
  /** One-sentence description of the edge */
  tagline: string;
  /** Long-form explanation of when / why the edge exists */
  edge: string;
  /** Best-fit direction bias for this archetype */
  directionBias: DirectionBias;
  /** How long an analyst on this playbook holds. */
  holdDurations: HoldDuration[];
  /** The setups it runs, signature first. Empty = the whole catalog. */
  setupIds: SetupId[];
  /** The confidence a buy needs. */
  minConfidence: number;
  /** How many stocks it holds at once. */
  maxOpenPositions: number;
  /** The fence its edge needs, if any. Left out = no filter on that axis. */
  fence?: { sectors?: Sector[]; marketCapMin?: number; marketCapMax?: number };
  /** A live analyst was built on it. */
  tested?: boolean;
  /** Signal type IDs (from signal-type-catalog) that feed this archetype */
  primarySignals: string[];
  /** Source catalog IDs that matter most — narrows domain monitors */
  keySources: string[];
  /** The strategy text in seven parts, the starting point for analystPrompt. */
  promptSkeleton: string;
  /** Common pitfalls / anti-patterns for this style */
  watchOutFor: string[];
}

export const STRATEGY_ARCHETYPES: StrategyArchetype[] = [
  {
    id: "EARNINGS_DRIFT",
    name: "Post-Earnings Announcement Drift",
    tagline: "Ride confirmed beat-and-raise prints into the drift window.",
    edge: "Stocks that beat earnings and guide higher tend to drift upward for weeks as analysts update models and institutions rebalance. The edge is persistence — not the gap day itself.",
    directionBias: "LONG",
    holdDurations: ["SWING", "POSITION"],
    setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"],
    minConfidence: 60,
    maxOpenPositions: 6,
    fence: { marketCapMin: 200_000_000 },
    tested: true,
    primarySignals: ["EARNINGS_BEAT", "ANALYST_REVISION", "INSTITUTIONAL_FLOW"],
    keySources: ["SEEKING_ALPHA", "FMP_EARNINGS", "FINNHUB_RECOMMENDATIONS", "STREET_INSIDER"],
    promptSkeleton: `**The edge.** You trade post-earnings drift, long only. A clean beat-and-raise keeps drifting for weeks after the print as analysts raise their numbers and funds rebalance. You buy the drift, not the gap-day reaction.

**What counts.** A beat on earnings and revenue with guidance raised, heavy volume on the gap day, a gap that holds, and estimate revisions that follow within days. Confirm the surprise and the guide from the release, the 8-K and the transcript, and read the sell-side notes in the days after the print for where estimates are going. The drift works in every sector: don't narrow to the one that won last quarter.

**What it skips.** A beat driven by one-time items (buybacks, tax benefits, insurance recoveries). A beat where guidance went sideways or down: there is no drift without a guide. A stock that has already run far past the gap. A beat the market sold.

**When it buys.** In the days after the print, once the gap has held and the guide is confirmed. Never on the print itself.

**When it's done.** The gap-day low breaks, the revisions don't follow, the drift has run its course, or the next print is close. You don't hold into the next report.

**How it sizes, in words.** The cleanest prints, where every signal lines up, earn the larger size; a marginal one takes the smaller. If the conviction doesn't justify a real position, the stock waits on the watchlist rather than taking a token one.

**What it never does.** Short a miss: a miss is a pass, written down. Chase a day-of gap. Trade an earnings lottery.`,
    watchOutFor: [
      "Sector-wide moves can fake the drift — check relative strength vs sector ETF.",
      "Revisions lag by a few days — don't enter before the first sell-side note.",
      "Low-float stocks drift violently in both directions.",
    ],
  },
  {
    id: "MOMENTUM_BREAKOUT",
    name: "Relative Strength Momentum",
    tagline: "Buy 52-week highs with sector leadership and volume confirmation.",
    edge: "Stocks making new highs with broadening volume and sector strength keep trending. The edge is the statistical anomaly of persistent strength vs mean reversion.",
    directionBias: "LONG",
    holdDurations: ["SWING"],
    setupIds: ["BASE_BREAKOUT", "MOMENTUM_FLAG", "RS_52W_HIGH"],
    minConfidence: 60,
    maxOpenPositions: 5,
    fence: { marketCapMin: 500_000_000 },
    primarySignals: ["PRICE_BREAKOUT", "VOLUME_SPIKE", "SECTOR_ROTATION"],
    keySources: ["FINVIZ", "STOCKCHARTS", "CNBC", "BARRONS"],
    promptSkeleton: `**The edge.** You trade relative-strength breakouts, long only. Strong stocks stay strong longer than mean reversion predicts.

**What counts.** A new 52-week high or a breakout from a multi-week base, on heavy volume, with relative strength against the S&P near the top of the market and the stock's own sector trending up. A clean chart: no distribution before it.

**What it skips.** Low-float speculative names. Stocks with recent heavy insider selling. A breakout into earnings week. A breakout against a weak sector.

**When it buys.** On the breakout, or on the first pullback to the breakout level.

**When it's done.** The trend breaks: the breakout fails back into the base, or the stock loses its trend line. A broken trend is a broken thesis.

**How it sizes, in words.** The breakouts with the strongest volume and leadership earn the larger size; a borderline one takes the smaller, or waits.

**What it never does.** Hold through earnings. Average down on a momentum name.`,
    watchOutFor: [
      "Breakouts late in a bull cycle fail more often — check SPY regime.",
      "Low-volume breakouts are traps — demand the volume confirmation.",
      "Gap-ups that close poorly are distribution, not breakouts.",
    ],
  },
  {
    id: "MEAN_REVERSION_OVERSOLD",
    name: "Oversold Bounce",
    tagline: "Buy quality names washed out on sector-wide panic, not fundamental breaks.",
    edge: "High-quality stocks pulled down with a sector during fear events tend to revert when panic clears, even if the fundamental story is unchanged.",
    directionBias: "LONG",
    holdDurations: ["SWING"],
    setupIds: ["RSI2_BOUNCE"],
    minConfidence: 60,
    maxOpenPositions: 5,
    primarySignals: ["RSI_OVERSOLD", "VOLATILITY_SPIKE", "FEAR_INDICATOR"],
    keySources: ["FINVIZ", "STOCKCHARTS", "MARKETWATCH", "CNBC"],
    promptSkeleton: `**The edge.** You buy quality names washed out in a sector-wide panic, long only. Fear sells quality without looking, and quality comes back once the fear clears.

**What counts.** A deeply oversold quality stock, pulled down with its sector on a broad fear event rather than its own news. An investment-grade balance sheet, no recent earnings miss, no guidance cut, no pending regulatory action.

**What it skips.** Fresh bad news: a miss, fraud, an executive leaving. A broken weekly trend, where oversold stays oversold. A weak balance sheet: those don't revert, they collapse.

**When it buys.** On the reversal: an intraday reversal on volume, or the next open after a fear-driven close.

**When it's done.** The bounce has come, or it hasn't started quickly. This is not buy-and-hope.

**How it sizes, in words.** The strongest balance sheets in the broadest panics earn the larger size; a name with any question about its own story takes the smaller, or waits.

**What it never does.** Catch a falling knife on its own news. Fight a real bear market.`,
    watchOutFor: [
      "Oversold can get more oversold in a real bear market — check regime.",
      "Sector-specific weakness (bank runs, biotech trial fails) is not mean reversion.",
      "Beware knife-catching stocks with fresh downgrade notes — wait for volume reversal.",
    ],
  },
  {
    id: "CATALYST_EVENT",
    name: "Catalyst-Driven Event Trading",
    tagline: "Position ahead of known binary events with asymmetric payoffs.",
    edge: "Markets systematically underprice binary catalysts (FDA, M&A, trial readouts). The edge is pricing the probability of known-date events.",
    directionBias: "LONG",
    holdDurations: ["SWING", "POSITION"],
    setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"],
    minConfidence: 50,
    maxOpenPositions: 5,
    fence: { sectors: ["Health Care", "Information Technology"], marketCapMin: 500_000_000, marketCapMax: 20_000_000_000 },
    tested: true,
    primarySignals: ["FDA_CATALYST", "MA_RUMOR", "TRIAL_READOUT", "GUIDANCE"],
    keySources: ["SEC_EDGAR", "FDA_CALENDAR", "BIO_PHARMA_CATALYSTS", "BENZINGA"],
    promptSkeleton: `**The edge.** You trade known, dated binary events, long only: FDA decisions, trial readouts, M&A targets, court rulings, guidance raises. The edge is pricing the probability right, not predicting the outcome.

**What counts.** A dated event with a clear binary: a PDUFA date, a readout with a pre-specified primary endpoint, an M&A target with corroborating insider filings or a 13D, a pre-announced guidance raise or capital markets day, a patent or antitrust ruling. Confirm it from the primary document: the FDA calendar, the SEC filing, the court docket, not a rumor.

**What it skips.** An event you can't read the primary document for. A first approval on a single-asset small company, where an overnight gap runs straight through any floor. An approval that would force a dilutive raise: check the cash runway. An event that points down: that is a pass, written down.

**When it buys.** Inside the pre-catalyst setup's buying window, once the setup is confirmed. The trigger run is told where each event date sits in it.

**When it's done.** The event resolves, the thesis breaks, or the event is well behind you. If the date slips (a PDUFA extension, a trial delay), reassess from scratch rather than anchor to the first entry.

**How it sizes, in words.** Smaller on a true coin-flip readout, because a failed binary gaps through a floor; larger on a de-risked setup where the data is in hand and only a dated regulatory step remains. The smallest companies take the smaller size. If the conviction doesn't justify a real position, the stock waits on the watchlist.

**What it never does.** Short a binary. Chase after the event prints: that is a different trade. Average down on a broken setup.`,
    watchOutFor: [
      "Catalyst dates slip — always have the latest SEC filing, not a stale rumor.",
      "Insider buys can be cosmetic — look for cluster buys with 10b5-1 plans confirmed.",
    ],
  },
  {
    id: "SECTOR_ROTATION",
    name: "Sector Rotation",
    tagline: "Trade the macro regime by rotating into leading sectors, avoiding lagging ones.",
    edge: "Sector leadership changes with the macro cycle. The edge is identifying the leader early via relative strength and macro context.",
    directionBias: "LONG",
    holdDurations: ["SWING", "POSITION"],
    setupIds: ["SECTOR_ROTATION", "RS_52W_HIGH", "MA_PULLBACK"],
    minConfidence: 60,
    maxOpenPositions: 5,
    primarySignals: ["SECTOR_ROTATION", "MACRO_SHIFT", "ANALYST_REVISION"],
    keySources: ["SPDR_SECTOR", "BARRONS", "WSJ_MARKETS", "BLOOMBERG"],
    promptSkeleton: `**The edge.** You rotate into the sector the macro regime favors, early, long only.

**What counts.** A sector ETF taking leadership against the S&P over weeks and months, rising on volume, with the regime behind it: the yield curve, volatility, the dollar, commodities and the Fed's direction. Within it, the strongest few names.

**What it skips.** A single name without its sector's confirmation. The laggards inside a leading sector.

**When it buys.** When the sector's leadership is confirmed, not before.

**When it's done.** The sector breaks down, or the regime that put it in front changes.

**How it sizes, in words.** The clearest leaders in the clearest regimes earn the larger size; an early or noisy read takes the smaller.

**What it never does.** Front-run a regime shift. Hold a losing sector hoping for rotation.`,
    watchOutFor: [
      "Rotation can reverse quickly during headline shocks.",
      "Sector ETFs hide dispersion — leading sector still has laggard names.",
      "Regime shifts are noisy — wait for confirmation, don't front-run them.",
    ],
  },
  {
    id: "INSIDER_ACTIVITY",
    name: "Insider Cluster Buying",
    tagline: "Follow clusters of insider buys — not individual buys.",
    edge: "Multiple insiders buying within weeks signals strong internal conviction. Individual insider buys are noise; clusters are signal.",
    directionBias: "LONG",
    holdDurations: ["POSITION"],
    setupIds: ["INSIDER_CLUSTER"],
    minConfidence: 60,
    maxOpenPositions: 5,
    primarySignals: ["INSIDER_BUYING", "FORM_4_CLUSTER"],
    keySources: ["SEC_EDGAR", "INSIDER_MONKEY", "FINVIZ_INSIDER", "OPENINSIDER"],
    promptSkeleton: `**The edge.** You follow clusters of insiders buying with their own money, long only. A cluster signals conviction inside the company that usually comes before a better business.

**What counts.** Several insiders buying on the open market within a few weeks, or one insider adding meaningfully to their stake, in real dollars. Read the Form 4s themselves, not summaries; check whether the insider has a record of good timing, and weight a CEO's or CFO's buy above a director's.

**What it skips.** Pre-scheduled 10b5-1 trades. Small qualifying purchases. Option exercises and gifts. Buys during an active buyback. A stock that has already run hard.

**When it buys.** Soon after the cluster forms, once the filings check out.

**When it's done.** The insiders change course, or the business thesis breaks.

**How it sizes, in words.** The largest clusters from the most senior insiders earn the larger size; a thinner one takes the smaller.

**What it never does.** Treat a single buy as a cluster. Trust a summary over the filing.`,
    watchOutFor: [
      "Insiders can be wrong — a cluster is a signal, not a guarantee.",
      "Beware timing: insiders often buy early, and the stock can keep falling before the thesis plays out.",
      "Private company spin-offs distort Form 4 data — filter them out.",
    ],
  },
  {
    id: "DEEP_VALUE",
    name: "Deep Value Contrarian",
    tagline: "Buy quality businesses priced for crisis when the crisis is temporary.",
    edge: "Markets overreact to temporary problems. The edge is distinguishing temporary pain from structural decay using balance sheet quality and cash flow.",
    directionBias: "LONG",
    holdDurations: ["POSITION"],
    // No setup in the catalog is a value entry: an analyst on it runs the whole catalog.
    setupIds: [],
    minConfidence: 60,
    maxOpenPositions: 5,
    primarySignals: ["VALUATION_EXTREME", "INSIDER_BUYING", "ANALYST_DOWNGRADE_EXHAUSTION"],
    keySources: ["SEC_EDGAR", "SEEKING_ALPHA", "MORNINGSTAR", "VIC"],
    promptSkeleton: `**The edge.** You buy quality businesses priced for a crisis that is temporary, long only. The edge is patience, and telling temporary pain from structural decay.

**What counts.** Free cash flow most years, modest debt, a sound current ratio, insiders who own or are buying, a price far below its highs, and a valuation below its sector. Read the 10-K and 10-Q, the calls, and the best independent write-ups.

**What it skips.** Value traps: perpetually cheap with falling cash flow. Bankruptcy and restructuring lottery tickets. A decline caused by fraud, accounting trouble or major litigation. Anything structural: an obsolete product, a regulatory wall, a broken moat.

**When it buys.** In stages, once fair value (sum of the parts or a cash-flow model) is well above the price and the problem looks temporary.

**When it's done.** The price reaches fair value, or the problem turns out to be structural.

**How it sizes, in words.** The widest gap to fair value on the strongest balance sheet earns the larger size; build to it over time, never all at once.

**What it never does.** Buy cheap without the cash flow to back it. Hurry.`,
    watchOutFor: [
      "Value traps are the biggest risk — demand evidence of FCF durability.",
      "Patience required — expect multi-quarter drawdowns before the thesis plays out.",
      "Small-cap value is illiquid — scale in slowly.",
    ],
  },
  {
    id: "THEMATIC_SECULAR",
    name: "Secular Theme Allocator",
    tagline: "Allocate capital to multi-year secular themes via best-in-class operators.",
    edge: "Secular themes (AI, EV, GLP-1, aging demographics) drive years of compounding. The edge is avoiding hype cycles and owning the picks-and-shovels leaders.",
    directionBias: "LONG",
    holdDurations: ["POSITION"],
    setupIds: ["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"],
    minConfidence: 70,
    maxOpenPositions: 10,
    tested: true,
    primarySignals: ["THEME_MOMENTUM", "EARNINGS_GROWTH", "CAPEX_TREND"],
    keySources: ["BARRONS", "BLOOMBERG", "STRATECHERY", "THE_INFORMATION"],
    promptSkeleton: `**The edge.** You own businesses that will be structurally more valuable in a few years, and hold them through volatility, long only. Everyone knows the theme; the edge is the operator that compounds it into value.

**What counts.** A durable secular tailwind (a capex cycle, regulation, demographics, technology); a best-in-class operator with capital-allocation discipline; pricing power in the gross margin; free cash flow that funds the next cycle; management aligned with long-term holders. Judge each against its own industry: a compounding industrial or medtech won't show software margins. Name the themes you cover here; a best-in-class business outside them is in scope on the same bar.

**What it skips.** Profitless growth dressed up as secular. Story stocks without unit economics. A real theme with a mediocre operator. A cyclical labeled secular.

**When it buys.** On confirmation, whichever comes first: a breakout above a base, a reclaim of the 50-day average, or a pullback to it. A stock at new highs on a working thesis is working, not extended; don't wait out an uptrend for a pullback that never comes. Build to full size over months, and make the first buy a real part of it.

**When it's done.** Only when a named belief breaks: a regulatory break, demand eroding, repeated guidance cuts, a CFO leaving, capital allocation failing. "De-risking", "locking in gains" and "rotating" are not reasons. A give-back from the high is a question (is the reason we bought still true?), never a sale by itself. Expect the business, not the price, to show the thesis working within the first months; if nothing has started, say what you got wrong or what you're waiting for.

**How it sizes, in words.** The highest-conviction themes take the larger size, the rest the smaller. Keep the themes balanced: an empty theme outranks another name in a theme you already hold. If the conviction doesn't justify a real position, the stock waits on the watchlist.

**What it never does.** Take a quick profit on a working thesis. Sell on price alone. Own a name it can't say compounds for years.`,
    watchOutFor: [
      "Themes are obvious in hindsight — avoid paying for narrative premium.",
      "Best-in-class at a bad price still underperforms — valuation discipline matters.",
    ],
  },
];

/**
 * What the builder's suggest_config fills in from a playbook: its setups,
 * hold, confidence and slots, and the sectors or cap band its edge needs.
 * Create saves them through normalizeAnalystPatch like any other field.
 */
export function playbookFields(id: string) {
  const p = getArchetype(id);
  if (!p) return {};
  return {
    setupIds: [...p.setupIds],
    holdDurations: [...p.holdDurations],
    minConfidence: p.minConfidence,
    maxOpenPositions: p.maxOpenPositions,
    ...(p.fence?.sectors ? { sectors: [...p.fence.sectors] } : {}),
    ...(p.fence?.marketCapMin != null ? { marketCapMin: p.fence.marketCapMin } : {}),
    ...(p.fence?.marketCapMax != null ? { marketCapMax: p.fence.marketCapMax } : {}),
  };
}

/** Lookup by ID. */
export function getArchetype(id: string): StrategyArchetype | null {
  return STRATEGY_ARCHETYPES.find((a) => a.id === id) ?? null;
}

/** Filter archetypes by direction bias (useful for long-only analysts). */
export function archetypesByDirection(bias: DirectionBias): StrategyArchetype[] {
  return STRATEGY_ARCHETYPES.filter((a) => a.directionBias === bias || a.directionBias === "BOTH");
}

/** Short list of IDs + taglines for prompt inclusion. */
export function archetypeIndex(): Array<{ id: string; name: string; tagline: string }> {
  return STRATEGY_ARCHETYPES.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline }));
}
