/**
 * The Framework page's sample read: CRWD as the read section's sheet shows
 * it, as one row shaped the way get_theses saves a real one, built through
 * the one builder (lib/agent/row-for-model.ts) for each of the reads the
 * page explains. The page never hand-writes what the model reads; when the
 * builder changes, the page follows. Server-side: the page computes it in
 * buildFrameworkData and hands the strings to the demo.
 */

import { rowForModel } from "@/lib/agent/row-for-model";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";

type Row = Record<string, unknown>;

const T = (id: string, says: string, extra: Row = {}): Row => ({ id, says, setBy: "AGENT", cooldownDays: 1, ...extra });

/** CRWD, held, in two situations: the same facts the sheet on the page shows. */
export const CRWD_ROW: Row = {
  id: "th_8f2c",
  ticker: "CRWD",
  status: "HOLDING",
  direction: "LONG",
  horizon: "TARGET",
  setupId: "PEAD",
  conviction: "MEDIUM",
  company: "CrowdStrike sells cloud-delivered endpoint and identity security on one agent; revenue is subscription, growing about 30% a year.",
  coreBelief: "The platform keeps taking share as security budgets consolidate; what has to stay true is net new ARR above $200M a quarter.",
  keyAssumptions: ["Net new ARR above $200M, checked at the Q3 report on December 2", "Gross margin holds above 78%"],
  invalidationConds: ["Net new ARR under $180M at the Q3 report", "A second outage with customer churn named on the call"],
  bullCase: { bullets: [{ text: "The beat and raise" }, { text: "Falcon Flex adoption" }, { text: "Module attach" }, { text: "The margin step-up" }, { text: "The buyback" }] },
  bearCase: { bullets: [{ text: "Valuation at 90× earnings" }, { text: "The July outage's legal tail" }, { text: "A slowing net new ARR cohort" }, { text: "Insider selling" }] },
  convictionRationale: "MEDIUM: the business is compounding, but the stock is extended 18% above its 50-day and estimates have not moved in a month.",
  variantView: "The Street models 25% growth; I think Flex pulls it to 30% because attach is running ahead of plan.",
  setup: {
    id: "PEAD",
    name: "Post-earnings drift",
    failureSigns: ["The gap day's low breaks", "Revisions stall"],
    manage: "A 3 ATR trail after +10%.",
    time: "60 days from the buy.",
    lines: ["Entry: the gap day's close, confirmed by a close above it.", "Stop: under the gap day's low, at least 1.5 ATR.", "Failure looks like: the gap day's low breaks; revisions stall.", "Manage: a 3 ATR trail after +10%.", "Time: 60 days from the buy."],
  },
  entryPrice: 404.1,
  targetPrice: null,
  stopLoss: 384,
  reviewDueAt: "2026-10-14T12:00:00.000Z",
  catalystDate: "2026-12-02T00:00:00.000Z",
  snapshot: { text: "A clean beat and raise; four targets raised after the call. The first paragraph on a short row, the whole text on a full one." },
  recentCatalysts: "The Q2 report on August 27: a beat and raise, with four targets raised after the call.",
  fundamentals: "Revenue growing about 30% a year, 78% gross margin, free cash flow margin in the high twenties.",
  latestEarnings: "Q2 FY27: revenue and EPS above the Street; net new ARR $221M.",
  catalystsAndEvents: "The Q3 report on December 2; Fal.Con in September.",
  analystConsensus: "23 buy, 7 hold, 0 sell; the average target $451.",
  insiderTechnical: "Insider selling under 10b5-1 plans; the stock above every average.",
  researchData: "Market cap $105B; forward P/E 90×.",
  researchWritten: { on: "2026-10-05", price: 397.8, daysAgo: 11 },
  context: "WHAT'S BEEN SAID ON $CRWD\nToday · Trigger: Review if above 10% from our entry\nThis week · Review: the beat held and the floor was raised to $384.",
  situations: ["ADD_OR_WINNER", "REVIEW_DUE"],
  needsAction: { kind: "TRIGGER_FIRED", action: "REVIEW", repeatLine: "This has fired 3 days running." },
  position: { quantity: 14, avgCost: 404.1, openedAt: "2026-10-15T14:31:00.000Z", peakPrice: 420.5 },
  proposals: [{ side: "SELL", intent: "CLOSE", quantity: 14, createdAt: "2026-10-16T13:31:00.000Z", expiresAt: "2026-10-17T13:31:00.000Z" }],
  price: { current: 418.2, dayChangePct: 6.8, asOf: "2026-10-16T15:40:00.000Z" },
  chart: { asOf: "2026-10-15", sma20: 402, sma50: 388, sma200: 351, rsi14: 64, low20: 371, high20: 421, high52w: 421, atr14: 9.8, rsVsSpy1M: 4, rsVsSpy3M: 9, volumeAvg20: 4_200_000, move5dPct: 3.1, move20dPct: 7.9 },
  street: { ticker: "CRWD", asOf: "2026-10-16", targetLow: 380, targetAvg: 451, targetHigh: 520, analysts: 30, buy: 23, hold: 7, sell: 0, epsNextQuarter: 1.04, epsNextQuarterUp: 6, epsNextQuarterDown: 1 },
  streetMonthAgo: { targetAvg: 432 },
  resolved: {
    currentPrice: 418.2,
    planSanity: [{ kind: "BUY_FIRED_UNANSWERED", text: "The buy fired 3 days ago, unanswered." }],
    floorRisk: { line: "At the $384 floor, 14 shares lose $281 — 0.3% of the account." },
  },
  triggers: [
    T("t_floor", "Sell if below $384 on the close", { rationale: "Under the gap day's low.", setBy: "PRINCIPAL" }),
    T("t_gain", "Review if above 10% from our entry", { rationale: "Press or take: the setup's first checkpoint.", lastFiredAt: "2026-10-16T14:30:00.000Z" }),
    T("t_street", "Review if above the Street's average target", { rationale: "Past the Street's average the easy part is done." }),
    T("t_report", "Review if within 5 days before earnings", { setBy: "DEFAULT" }),
    T("t_clock", "Review every 30 days", { setBy: "DEFAULT" }),
  ],
  inheritedTriggers: [{ id: "a_trail", says: "Sell if below 6% from the high since we bought", level: "ACCOUNT" }],
  history: [
    { id: "u_2", type: "TRIGGER_FIRED", summary: "Trigger: Review if above 10% from our entry", timestamp: "2026-10-16T14:30:00.000Z" },
    { id: "u_1", type: "REVIEWED", summary: "Review: the beat held and the floor was raised to $384.", timestamp: "2026-10-13T12:05:00.000Z" },
  ],
};

/** One read as the model gets it, as text: the one line as is; a row as `key: value` lines, a list's items joined. */
function asText(read: string | Row): string {
  if (typeof read === "string") return read;
  return Object.entries(read)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ") : typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}

/** Each read as the model gets it, built through rowForModel from the one CRWD row: the line, the review clock's row, the row by name, and one row per situation. The Writer's case is its own prompt block and is not built here. */
export function buildReadSamples(): { line: string; review: string; named: string; bySituation: Record<string, string> } {
  const bySituation: Record<string, string> = {};
  for (const code of Object.keys(SITUATIONS) as SituationCode[]) bySituation[code] = asText(rowForModel({ ...CRWD_ROW, situations: [code] }, { named: false, size: "short" }));
  return {
    line: asText(rowForModel(CRWD_ROW, { named: false, size: "line" })),
    review: asText(rowForModel({ ...CRWD_ROW, situations: ["REVIEW_DUE"] }, { named: false, size: "short" })),
    named: asText(rowForModel(CRWD_ROW, { named: true, size: "full" })),
    bySituation,
  };
}
