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

export interface BriefPost {
  handle: string;
  excerpt: string;
  sentiment: "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL";
  recency: string;
  url: string;
}

export interface BriefSocial {
  /** "loading" while the X search is still out; the brief is saved without it first. */
  status: "ok" | "loading" | "failed";
  posts: BriefPost[];
  seen: number;
  spam: number;
  mostlySpam: boolean;
  summary: string | null;
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

export interface ResearchBriefPayload {
  version: 1;
  ticker: string;
  company: string | null;
  kind: BriefKind;
  builtAt: string;
  numbers: BriefNumbers;
  whyItMoved: BriefClaim[];
  analystActions: BriefAnalystAction[];
  targets: BriefTargets | null;
  ratings: BriefRatings | null;
  companyNews: BriefClaim[];
  fundamentals: BriefClaim[];
  social: BriefSocial | null;
  /** 4–6 plain sentences by a small model, from the facts above only. */
  synthesis: string | null;
  sources: BriefSource[];
  failures: BriefFailure[];
}

/** The card's view: the payload plus when it was built. */
export interface ResearchBriefView {
  id: string;
  createdAt: string;
  payload: ResearchBriefPayload;
}

const PART_LABEL: Record<BriefFailure["part"], string> = {
  web: "Web research",
  x: "X search",
  ratings: "Analyst ratings",
  numbers: "Prices",
  synthesis: "Summary",
};

/** "X search failed: no xAI key is configured" — one line per part that failed. */
export function failureLines(p: ResearchBriefPayload): string[] {
  return p.failures.map((f) => `${PART_LABEL[f.part]} failed: ${f.message}`);
}

/** "10 buy · 4 hold · 0 sell" from Finnhub's counts. */
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

/** What X says, in one line, saying so plainly when it is mostly spam. */
export function socialLine(s: BriefSocial): string {
  if (s.status === "loading") return "X search still running.";
  if (s.status === "failed") return "X search failed.";
  if (s.seen === 0) return "No posts about this stock found on X this week.";
  const spam = s.mostlySpam ? `Mostly spam: ${s.spam} of ${s.seen} posts were promotion, bots or another ticker. ` : "";
  return `${spam}${s.summary ?? `${s.posts.length} genuine posts.`}`.trim();
}

/** The newest "why it moved" fact, dated — one line for the stock's row and the agents. */
export function whyItMovedLine(p: ResearchBriefPayload): string | null {
  const c = [...p.whyItMoved].sort((a, b) => b.date.localeCompare(a.date))[0];
  return c ? `${c.text} (${c.date})` : null;
}

const etStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";

/** The brief as an agent reads it: the read, then each dated fact with its link, then what failed. */
export function briefForModel(v: ResearchBriefView) {
  const b = v.payload;
  const url = (ids: number[]) => b.sources.find((s) => s.id === ids[0])?.url ?? null;
  const facts = (cs: BriefClaim[]) => cs.map((c) => ({ text: c.text, date: c.date, source: url(c.sourceIds) }));
  return {
    builtAt: etStamp(v.createdAt),
    read: b.synthesis,
    whyItMoved: facts(b.whyItMoved),
    wallStreet: {
      ratings: b.ratings ? `${ratingsLine(b.ratings)} (Finnhub, ${b.ratings.period})` : null,
      targets: b.targets ? { text: targetsLine(b.targets), date: b.targets.asOf, source: url(b.targets.sourceIds) } : null,
      actions: b.analystActions.map((a) => ({ text: actionLine(a), date: a.date, source: url(a.sourceIds) })),
    },
    companyNews: facts(b.companyNews),
    fundamentals: facts(b.fundamentals),
    x: b.social ? socialLine(b.social) : null,
    failed: failureLines(b),
  };
}

/** One paragraph for a run's kickoff: when it was built, the read, what failed. */
export function briefKickoffLine(v: ResearchBriefView): string {
  const b = v.payload;
  const why = whyItMovedLine(b);
  const failed = failureLines(b);
  return [
    `Research brief on $${b.ticker} (${etStamp(v.createdAt)}, every fact sourced and dated):`,
    b.synthesis ?? (why ? `Why it moved: ${why}.` : "No company news found."),
    failed.length ? `(${failed.join("; ")}.)` : null,
  ].filter(Boolean).join(" ");
}
