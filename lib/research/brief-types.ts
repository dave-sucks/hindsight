/**
 * The research brief's shape — what the proposal card, the email and the
 * agents read. Client-safe: types and pure helpers only.
 */

export type BriefKind = "DAILY" | "PROPOSAL" | "SALE";

export interface BriefSource {
  id: number;
  url: string;
  title: string | null;
  /** YYYY-MM-DD when the page or post is dated. */
  date: string | null;
}

/** One sourced, dated fact. */
export interface BriefClaim {
  text: string;
  date: string;
  sourceIds: number[];
}

export interface BriefAnalystAction {
  firm: string;
  /** "upgrade" | "downgrade" | "initiate" | "reiterate" | "target raised" | "target cut" */
  action: string;
  rating: string | null;
  priceTarget: number | null;
  priorTarget: number | null;
  date: string;
  sourceIds: number[];
}

export interface BriefTargets {
  average: number | null;
  low: number | null;
  lowFirm: string | null;
  high: number | null;
  highFirm: string | null;
  analysts: number | null;
  asOf: string;
  sourceIds: number[];
}

/** Finnhub's buy / hold / sell counts for the latest month. */
export interface BriefRatings {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  period: string;
}

export interface BriefPosition {
  /** What the order does: a proposed buy, a proposed sale, a sale already sent. */
  occasion: string;
  shares: number;
  avgCost: number | null;
  marketValue: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  pctOfAccount: number | null;
  /** Dollars the price already sits past the stop, on the losing side; null when it doesn't. */
  pastStop: number | null;
  stop: number | null;
  target: number | null;
}

export interface BriefNumbers {
  price: number | null;
  dayPct: number | null;
  spyPct: number | null;
  sectorEtf: string | null;
  sectorPct: number | null;
  position: BriefPosition | null;
}

export interface BriefFailure {
  part: "web" | "x" | "ratings" | "numbers" | "synthesis";
  message: string;
}

/** What the research gathered, the paragraph's input. Not stored: only the paragraph and its sources are. */
export interface BriefFacts {
  ticker: string;
  company: string | null;
  kind: BriefKind;
  numbers: BriefNumbers;
  whyItMoved: BriefClaim[];
  analystActions: BriefAnalystAction[];
  targets: BriefTargets | null;
  ratings: BriefRatings | null;
  companyNews: BriefClaim[];
  fundamentals: BriefClaim[];
  /** The parts that could not be read, for the paragraph to say "not found". */
  missing: BriefFailure["part"][];
}

/**
 * What a brief stores and every reader shows: one paragraph and its sources.
 * Briefs before 2026-10-28 (version 1) stored ~100 values; their paragraph
 * and sources are read the same way and the rest is ignored.
 */
export interface ResearchBriefPayload {
  version: 1 | 2;
  ticker: string;
  company: string | null;
  kind: BriefKind;
  builtAt: string;
  /** Four to six plain sentences by a small model, from the facts only. */
  synthesis: string | null;
  sources: BriefSource[];
}

export interface ResearchBriefView {
  id: string;
  createdAt: string;
  payload: ResearchBriefPayload;
}

export function ratingsLine(r: BriefRatings): string {
  return `${r.strongBuy + r.buy} buy · ${r.hold} hold · ${r.sell + r.strongSell} sell`;
}

const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

/** "Average $52, low $46 (Piper Sandler), high $58 (Wells Fargo)". */
export function targetsLine(t: BriefTargets): string {
  const parts: string[] = [];
  if (t.average != null) parts.push(`average ${usd(t.average)}`);
  if (t.low != null) parts.push(`low ${usd(t.low)}${t.lowFirm ? ` (${t.lowFirm})` : ""}`);
  if (t.high != null) parts.push(`high ${usd(t.high)}${t.highFirm ? ` (${t.highFirm})` : ""}`);
  const s = parts.join(", ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** "Cantor Fitzgerald initiated at Overweight, target $55". */
export function actionLine(a: BriefAnalystAction): string {
  const verb: Record<string, string> = {
    upgrade: "upgraded to",
    downgrade: "downgraded to",
    initiate: "initiated at",
    reiterate: "reiterated",
    "target raised": "raised its target",
    "target cut": "cut its target",
  };
  const v = verb[a.action] ?? a.action;
  const rating = a.rating && !a.action.startsWith("target") ? ` ${a.rating}` : "";
  const target =
    a.priceTarget != null
      ? a.priorTarget != null
        ? `, target ${usd(a.priorTarget)} → ${usd(a.priceTarget)}`
        : `, target ${usd(a.priceTarget)}`
      : "";
  return `${a.firm} ${v}${rating}${target}`;
}

/** The paragraph's first sentence: the stock's row and the run's kickoff carry it as "why it moved". */
export function whyItMovedLine(p: ResearchBriefPayload): string | null {
  const text = p.synthesis?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.split(/(?<=[.!?])\s+/)[0];
}

const etStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";

/** The web pages behind a paragraph, the ones a reader can open. */
export function briefLinks(p: ResearchBriefPayload): BriefSource[] {
  return (p.sources ?? []).filter((x) => /^https?:\/\//.test(x.url));
}

/** The brief as an agent reads it: when it was built, the paragraph, and its links. */
export function briefForModel(v: ResearchBriefView) {
  const b = v.payload;
  return {
    builtAt: etStamp(v.createdAt),
    read: b.synthesis,
    sources: briefLinks(b).slice(0, 6).map((x) => ({ title: x.title, date: x.date, url: x.url })),
  };
}

/** One paragraph for a run's kickoff: when it was built, then the read. */
export function briefKickoffLine(v: ResearchBriefView): string | null {
  const b = v.payload;
  return b.synthesis ? `Today's research on $${b.ticker} (${etStamp(v.createdAt)}): ${b.synthesis}` : null;
}
