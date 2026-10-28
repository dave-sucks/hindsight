/**
 * The research brief: when a trade is proposed or a sale is sent, one
 * paragraph on what is going on with the company and the stock, the way a
 * research assistant answers "what's going on with GEV?", with its sources.
 *
 * One Sonar request and Finnhub's rating counts gather the facts; one
 * small-model synthesis writes the paragraph from them. Only the paragraph
 * and its sources are stored (2026-10-28: the brief used to store and show
 * ~100 values, an X search that never ran, and the failures).
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { prisma } from "@/lib/prisma";
import { askSonar, type SonarSearchResult } from "@/lib/intelligence/sonar";
import { finnhub } from "@/lib/agent/research-helpers";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { sectorEtfFor } from "@/lib/market-data/price-structure";
import { getAccount } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import {
  actionLine,
  ratingsLine,
  targetsLine,
  type BriefAnalystAction,
  type BriefClaim,
  type BriefFacts,
  type BriefFailure,
  type BriefKind,
  type BriefNumbers,
  type BriefRatings,
  type BriefSource,
  type BriefTargets,
  type ResearchBriefPayload,
} from "@/lib/research/brief-types";

/** A brief for the same stock under this age is reused rather than paid for again. */
export const BRIEF_REUSE_MS = 2 * 60 * 60 * 1000;
export const SYNTHESIS_MODEL = "claude-haiku-4-5";
const HAIKU_PRICE = { in: 1, out: 5 }; // $ per million tokens

// ── Sonar: one question, a fixed answer shape ────────────────────────────────

const dated = (field: string) => ({
  type: "object",
  properties: {
    [field]: { type: "string" },
    date: { type: "string", description: "YYYY-MM-DD the source was published" },
    source_url: { type: "string" },
  },
  required: [field, "date", "source_url"],
});

const SONAR_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    why_it_moved: { type: "array", items: dated("claim") },
    analyst_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          firm: { type: "string" },
          action: { type: "string", enum: ["upgrade", "downgrade", "initiate", "reiterate", "target raised", "target cut"] },
          rating: { type: "string" },
          price_target: { type: "number" },
          prior_target: { type: "number" },
          date: { type: "string" },
          source_url: { type: "string" },
        },
        required: ["firm", "action", "date", "source_url"],
      },
    },
    price_targets: {
      type: "object",
      properties: {
        average: { type: "number" },
        low: { type: "number" },
        low_firm: { type: "string" },
        high: { type: "number" },
        high_firm: { type: "string" },
        analyst_count: { type: "integer" },
        as_of: { type: "string" },
        source_url: { type: "string" },
      },
      required: ["as_of", "source_url"],
    },
    company_news: { type: "array", items: dated("headline") },
    fundamentals: { type: "array", items: dated("fact") },
  },
  required: ["why_it_moved", "analyst_actions", "company_news", "fundamentals"],
};

const SONAR_SYSTEM = `You research one US stock for a portfolio manager. Search the web and answer in JSON matching the schema. Every item cites one source_url taken from the pages you actually searched, and the date that page was published (YYYY-MM-DD). Report only what a source says: never estimate, never fill a gap from memory. Leave a list empty, or leave price_targets out, when you find nothing. Write each item as one plain sentence with the numbers and names in it.`;

function sonarQuestion(ticker: string, company: string | null, today: string, move: string): string {
  return [
    `Stock: ${ticker}${company ? ` (${company})` : ""}. Today is ${today}.${move ? ` ${move}` : ""}`,
    "why_it_moved: why the stock moved over the last five trading days, only as a source states it: list an item only when the source itself ties it to the stock's move. For each, say whether it came from the company, its sector, or the whole market (rates, a sell-off, a rotation). News that no source ties to the move belongs under company_news, not here.",
    "analyst_actions: rating changes, initiations and price-target changes from the last 90 days: firm, action, new rating, new target, prior target, date.",
    "price_targets: the current analyst consensus: average, lowest and highest target with the firm behind each, the number of analysts, and the date of that read.",
    "company_news: notable company news from the last 30 days: results, guidance, products, deals, management changes, filings.",
    "fundamentals: the latest reported growth and profitability (revenue growth, margins, profit or loss, any headline metric the company reports), with the period.",
  ].join("\n");
}

// ── Keeping only what a vendor can back ──────────────────────────────────────

const normUrl = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "");

/** Sources numbered in the order they are first cited; only pages the vendor read. */
export function sourceBook(read: SonarSearchResult[]) {
  const known = new Map(read.map((r) => [normUrl(r.url), r]));
  const sources: BriefSource[] = [];
  const add = (url: string, title: string | null, date: string | null): number => {
    const have = sources.find((s) => normUrl(s.url) === normUrl(url));
    if (have) return have.id;
    sources.push({ id: sources.length + 1, url, title, date });
    return sources.length;
  };
  return {
    sources,
    add,
    /** The cited page and its date, or null when the vendor never read that URL. */
    cite(url: unknown): { id: number; date: string | null } | null {
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
      const page = known.get(normUrl(url));
      if (!page) return null;
      const date = isoDay(page.date);
      return { id: add(page.url, page.title, date), date };
    },
  };
}

/** YYYY-MM-DD, or null for anything that isn't a plausible publication day. */
function isoDay(v: unknown, now = new Date()): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  const t = m ? Date.parse(`${m[1]}T00:00:00Z`) : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  if (t > now.getTime() + 86_400_000 || t < now.getTime() - 400 * 86_400_000) return null;
  return new Date(t).toISOString().slice(0, 10);
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

export interface WebResearch {
  company: string | null;
  whyItMoved: BriefClaim[];
  analystActions: BriefAnalystAction[];
  targets: BriefTargets | null;
  companyNews: BriefClaim[];
  fundamentals: BriefClaim[];
  /** Items the vendor sent without a page it read or a date. */
  dropped: number;
}

/** Sonar's JSON, cut down to the items that carry a page it read and a date. */
export function cleanWebResearch(json: unknown, book: ReturnType<typeof sourceBook>, now = new Date()): WebResearch {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  let dropped = 0;
  const backed = (item: Record<string, unknown>) => {
    const src = book.cite(item.source_url);
    const date = isoDay(item.date, now) ?? src?.date ?? null;
    if (!src || !date) {
      dropped++;
      return null;
    }
    return { date, sourceIds: [src.id] };
  };
  const claims = (items: unknown, field: string): BriefClaim[] =>
    list(items).flatMap((it) => {
      const text = str(it[field]);
      const b = text ? backed(it) : null;
      if (!text) dropped++;
      return text && b ? [{ text, ...b }] : [];
    });

  const analystActions = list(j.analyst_actions).flatMap((it) => {
    const firm = str(it.firm);
    const action = str(it.action);
    const b = firm && action ? backed(it) : null;
    if (!firm || !action) dropped++;
    return firm && action && b
      ? [{ firm, action, rating: str(it.rating), priceTarget: num(it.price_target), priorTarget: num(it.prior_target), ...b }]
      : [];
  });

  let targets: BriefTargets | null = null;
  const pt = j.price_targets && typeof j.price_targets === "object" ? (j.price_targets as Record<string, unknown>) : null;
  if (pt) {
    const b = backed({ ...pt, date: pt.as_of });
    const [average, low, high] = [num(pt.average), num(pt.low), num(pt.high)];
    // A low above the high, or an average outside them, is not a real consensus.
    const coherent = !(low != null && high != null && low > high) && !(average != null && low != null && high != null && (average < low || average > high));
    if (b && coherent && (average ?? low ?? high) != null) {
      targets = {
        average, low, high,
        lowFirm: str(pt.low_firm),
        highFirm: str(pt.high_firm),
        analysts: typeof pt.analyst_count === "number" ? pt.analyst_count : null,
        asOf: b.date,
        sourceIds: b.sourceIds,
      };
    } else if (b && !coherent) dropped++;
  }

  return {
    company: str(j.company_name),
    whyItMoved: claims(j.why_it_moved, "claim"),
    analystActions,
    targets,
    companyNews: claims(j.company_news, "headline"),
    fundamentals: claims(j.fundamentals, "fact"),
    dropped,
  };
}

// ── Our own numbers ──────────────────────────────────────────────────────────

export interface OrderForBrief {
  id: string;
  symbol: string;
  intent: string | null;
  quantity: number;
  thesisId: string | null;
  position: {
    id: string;
    userId: string;
    accountId: string;
    environment: string;
    direction: string;
    quantity: number;
    avgCost: number;
    stopLoss: number | null;
    targetPrice: number | null;
  };
}

function occasion(kind: BriefKind, o: OrderForBrief): string {
  const n = o.quantity.toLocaleString("en-US");
  if (kind === "SALE") return `Sale of ${n} shares, sent`;
  switch (o.intent) {
    case "ADD": return `Proposed add of ${n} shares`;
    case "CLOSE": return `Proposed sale of all ${n} shares`;
    case "PARTIAL_CLOSE": return `Proposed sale of ${n} of ${o.position.quantity.toLocaleString("en-US")} shares`;
    default: return `Proposed buy of ${n} shares`;
  }
}

const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

async function loadNumbers(kind: BriefKind, order: OrderForBrief, sectorEtf: string | null, stop: number | null, target: number | null): Promise<BriefNumbers> {
  const ticker = order.symbol.toUpperCase();
  const pos = order.position;
  const env = pos.environment === "LIVE" ? "LIVE" : "PAPER";
  const creds = (await resolveAlpacaCredentials(pos.userId, env).catch(() => null)) ?? undefined;
  const [quotes, account] = await Promise.all([
    getLiveQuotes([ticker, "SPY", ...(sectorEtf ? [sectorEtf] : [])], { caller: "other", creds }),
    getAccount(creds).catch(() => null),
  ]);
  const q = quotes[ticker]?.quote ?? null;
  const price = q?.c ?? null;
  const isBuy = kind === "PROPOSAL" && (order.intent ?? "OPEN") === "OPEN";
  const shares = isBuy ? order.quantity : pos.quantity;
  const dir = pos.direction === "SHORT" ? -1 : 1;
  const marketValue = price != null ? shares * price : null;
  const pnlUsd = !isBuy && price != null ? (price - pos.avgCost) * shares * dir : null;
  const equity = account ? parseFloat(account.equity) : NaN;
  return {
    price,
    dayPct: pct(q?.dp),
    spyPct: pct(quotes.SPY?.quote?.dp),
    sectorEtf,
    sectorPct: sectorEtf ? pct(quotes[sectorEtf]?.quote?.dp) : null,
    position: {
      occasion: occasion(kind, order),
      shares,
      avgCost: pos.avgCost > 0 ? pos.avgCost : null,
      marketValue: marketValue != null ? Math.round(marketValue) : null,
      pnlUsd: pnlUsd != null ? Math.round(pnlUsd) : null,
      pnlPct: pnlUsd != null && pos.avgCost > 0 ? pct(((price! - pos.avgCost) / pos.avgCost) * 100 * dir) : null,
      pctOfAccount: marketValue != null && equity > 0 ? pct((marketValue / equity) * 100) : null,
      pastStop: !isBuy && price != null && stop != null && (price - stop) * dir < 0 ? Math.round(Math.abs(price - stop) * 100) / 100 : null,
      stop,
      target,
    },
  };
}

async function loadRatings(ticker: string): Promise<BriefRatings | null> {
  const r = await finnhub(`/stock/recommendation?symbol=${encodeURIComponent(ticker)}`, 1);
  if (r.error) throw new Error(r.error);
  const latest = Array.isArray(r.data) ? (r.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!latest) return null;
  const n = (k: string) => (typeof latest[k] === "number" ? (latest[k] as number) : 0);
  return { strongBuy: n("strongBuy"), buy: n("buy"), hold: n("hold"), sell: n("sell"), strongSell: n("strongSell"), period: String(latest.period ?? "") };
}

// ── The synthesis ────────────────────────────────────────────────────────────

const JARGON = /\b(PEAD|drift|trend template|R\/R|risk[- ]reward|ATR|pivot|VCP|setup|breakout shelf|in the money)\b/i;

const SYNTHESIS_SYSTEM = `You write the paragraph a sharp analyst hands the person deciding on this trade right now, the way a good research assistant answers "what's going on with this stock?". Four to six plain sentences, one paragraph, no headings or bullets. In order: what is going on with the company and the stock and why, with dates (its own news, its sector, the market; say plainly when the move was the whole market or the sector rather than the company, and when there is no clear reason in the news); whether the business looks intact (growth, profits, guidance); what Wall Street thinks, in one sentence with a firm or two, the average target and the buy, hold and sell counts as numbers; then one short sentence on this position: the shares and the gain or loss in dollars and percent. Use only the facts given. When a part has no facts, say so in a few words. Never mention a stop, a floor, a target, a trigger or a rule: the card already says why this trade was proposed. Never use trading jargon or internal labels: no setup names, "PEAD", "drift", "Trend Template", "R/R", "ATR", "pivot", no chart talk like support or resistance. Call something the reason for a move only when it is listed under "Why it moved"; company news is news that happened, never the cause. Do not tell the reader what to do or predict what the stock will do. Keep each sentence under 35 words.`;

const money = (n: number) => {
  const d = Math.abs(n) >= 1000 ? 0 : 2;
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
const signed = (n: number | null, unit = "%") => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}${unit}`);


/** The facts, as the lines the synthesis model reads. Exported for the tests. */
export function factsText(p: BriefFacts): string {
  const n = p.numbers;
  const out: string[] = [];
  out.push(
    `Stock: ${p.ticker}${p.company ? ` (${p.company})` : ""}${n.price != null ? ` at ${money(n.price)}` : ""}, ${signed(n.dayPct)} today; S&P 500 ${signed(n.spyPct)}${n.sectorEtf ? `; sector fund ${n.sectorEtf} ${signed(n.sectorPct)}` : ""}.`,
  );
  const pos = n.position;
  if (pos) {
    const bits = [`${pos.occasion}.`];
    if (pos.avgCost != null) bits.push(`Cost ${money(pos.avgCost)} a share.`);
    if (pos.marketValue != null) bits.push(`Worth ${money(pos.marketValue)}${pos.pctOfAccount != null ? `, ${pos.pctOfAccount.toFixed(1)}% of the account` : ""}.`);
    if (pos.pnlUsd != null) bits.push(`${pos.pnlUsd >= 0 ? "Up" : "Down"} ${money(pos.pnlUsd)} (${signed(pos.pnlPct)}).`);
    out.push(`Position: ${bits.join(" ")}`);
  }
  const section = (title: string, lines: string[], empty: string) =>
    out.push(`${title}:${lines.length ? `\n${lines.map((l) => `- ${l}`).join("\n")}` : ` ${empty}`}`);
  section("Why it moved (reasons a dated source ties to the move)", p.whyItMoved.map((c) => `[${c.date}] ${c.text}`), "no source gives a reason");
  section(
    "Wall Street",
    [
      ...(p.ratings ? [`Ratings (${p.ratings.period}): ${ratingsLine(p.ratings)}`] : []),
      ...(p.targets ? [`Price targets [${p.targets.asOf}]: ${targetsLine(p.targets)}${p.targets.analysts ? `, ${p.targets.analysts} analysts` : ""}`] : []),
      ...p.analystActions.map((a) => `[${a.date}] ${actionLine(a)}`),
    ],
    "nothing found",
  );
  section("Company news (things that happened; no source ties them to the move)", p.companyNews.map((c) => `[${c.date}] ${c.text}`), "no company news found");
  section("Fundamentals", p.fundamentals.map((c) => `[${c.date}] ${c.text}`), "nothing found");
  if (p.missing.length) out.push(`Not available: ${p.missing.join(", ")}.`);
  return out.join("\n");
}

async function synthesize(p: BriefFacts): Promise<{ text: string; costUsd: number }> {
  let cost = 0;
  const ask = async (extra: string) => {
    const r = await generateText({
      model: anthropic(SYNTHESIS_MODEL),
      system: SYNTHESIS_SYSTEM,
      prompt: factsText(p) + extra,
      maxOutputTokens: 450,
      temperature: 0.3,
      abortSignal: AbortSignal.timeout(25_000),
    });
    cost += ((r.usage?.inputTokens ?? 0) * HAIKU_PRICE.in + (r.usage?.outputTokens ?? 0) * HAIKU_PRICE.out) / 1e6;
    return r.text.trim();
  };
  let text = await ask("");
  const hit = text.match(JARGON);
  // One rewrite when a banned word slips through; the facts don't change.
  if (hit) text = await ask(`\n\nYour last draft used "${hit[0]}". Write it again without that word or any other jargon.`);
  return { text, costUsd: cost };
}

// ── Building, saving, reusing ────────────────────────────────────────────────

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
function track<T>(p: Promise<T>) {
  const t: { done: boolean; promise: Promise<Settled<T>> } = { done: false, promise: undefined as never };
  t.promise = p.then(
    (value) => ({ ok: true as const, value }),
    (e) => ({ ok: false as const, error: errText(e) }),
  ).then((r) => {
    t.done = true;
    return r;
  });
  return t;
}

const ORDER_SELECT = {
  id: true, symbol: true, intent: true, quantity: true, thesisId: true,
  position: { select: { id: true, userId: true, accountId: true, environment: true, direction: true, quantity: true, avgCost: true, stopLoss: true, targetPrice: true } },
} as const;

async function save(orderId: string, accountId: string, p: ResearchBriefPayload, costs: BriefCosts, failures: BriefFailure[], reusedFromId: string | null, now: Date) {
  const data = {
    ticker: p.ticker,
    kind: p.kind,
    accountId,
    payload: p as object,
    sources: p.sources as object,
    costs: { ...costs, totalUsd: Math.round((costs.webUsd + costs.synthesisUsd) * 10_000) / 10_000 } as object,
    error: failures.length ? failures.map((f) => `${f.part}: ${f.message}`).join("; ") : null,
    reusedFromId,
  };
  return prisma.researchBrief.upsert({
    where: { orderId },
    create: { ...data, orderId, createdAt: now },
    update: data,
    select: { id: true },
  });
}

export type BriefCosts = { webUsd: number; synthesisUsd: number };

/**
 * Build one brief, touching no table: our numbers, then Sonar and Finnhub in
 * parallel, then the paragraph. With `reuse` (a brief on the same stock under
 * two hours old) its paragraph and sources are copied and nothing is paid
 * for. Never throws on a vendor failure: the paragraph says what wasn't found.
 */
export async function buildBriefPayload(input: {
  kind: BriefKind;
  order: OrderForBrief;
  stop: number | null;
  target: number | null;
  reuse?: ResearchBriefPayload | null;
  now?: Date;
}): Promise<{ payload: ResearchBriefPayload; costs: BriefCosts; failures: BriefFailure[] }> {
  const { kind, order, stop, target, reuse } = input;
  const now = input.now ?? new Date();
  const ticker = order.symbol.toUpperCase();
  const failures: BriefFailure[] = [];
  const costs: BriefCosts = { webUsd: 0, synthesisUsd: 0 };
  const stored = (company: string | null, synthesis: string | null, sources: BriefSource[]): ResearchBriefPayload => ({
    version: 2, ticker, company, kind, builtAt: now.toISOString(), synthesis, sources,
  });
  if (reuse?.synthesis) return { payload: stored(reuse.company, reuse.synthesis, reuse.sources ?? []), costs, failures };

  const profile = (await finnhub(`/stock/profile2?symbol=${encodeURIComponent(ticker)}`, 1).catch(() => null))?.data as
    | { name?: string; finnhubIndustry?: string }
    | null;
  const sectorEtf = sectorEtfFor(profile?.finnhubIndustry ?? null);
  const numbers = await loadNumbers(kind, order, sectorEtf, stop, target).catch((e) => {
    failures.push({ part: "numbers", message: errText(e) });
    return { price: null, dayPct: null, spyPct: null, sectorEtf, sectorPct: null, position: null } as BriefNumbers;
  });
  const facts: BriefFacts = {
    ticker, company: str(profile?.name) ?? null, kind, numbers,
    whyItMoved: [], analystActions: [], targets: null, ratings: null, companyNews: [], fundamentals: [], missing: [],
  };

  const today = now.toISOString().slice(0, 10);
  const move = numbers.dayPct != null ? `Today it is ${signed(numbers.dayPct)}; the S&P 500 is ${signed(numbers.spyPct)}.` : "";
  const after = new Date(now.getTime() - 120 * 86_400_000);
  const [web, ratings] = await Promise.all([
    track(askSonar({
      system: SONAR_SYSTEM,
      user: sonarQuestion(ticker, facts.company, today, move),
      schema: SONAR_SCHEMA,
      schemaName: "research_brief",
      afterDate: `${after.getUTCMonth() + 1}/${after.getUTCDate()}/${after.getUTCFullYear()}`,
    })).promise,
    track(loadRatings(ticker)).promise,
  ]);
  const book = sourceBook(web.ok ? web.value.searchResults : []);
  if (web.ok) {
    costs.webUsd = web.value.costUsd;
    const r = cleanWebResearch(web.value.json, book, now);
    Object.assign(facts, { whyItMoved: r.whyItMoved, analystActions: r.analystActions, targets: r.targets, companyNews: r.companyNews, fundamentals: r.fundamentals });
    facts.company = facts.company ?? r.company;
  } else failures.push({ part: "web", message: web.error });
  if (ratings.ok) facts.ratings = ratings.value;
  else failures.push({ part: "ratings", message: ratings.error });
  facts.missing = failures.map((f) => f.part);

  let synthesis: string | null = null;
  try {
    const s = await synthesize(facts);
    synthesis = s.text || null;
    costs.synthesisUsd += s.costUsd;
  } catch (e) {
    failures.push({ part: "synthesis", message: errText(e) });
  }
  return { payload: stored(facts.company, synthesis, book.sources), costs, failures };
}

/**
 * Build the brief for one order and attach it (one row per order). Reuses the
 * paragraph of a brief on the same stock under two hours old.
 */
export async function briefForOrder(orderId: string, kind: BriefKind, now: Date = new Date()): Promise<{ briefId: string; reused: boolean } | null> {
  const existing = await prisma.researchBrief.findUnique({ where: { orderId }, select: { id: true } });
  if (existing) return { briefId: existing.id, reused: false };

  const order = (await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT })) as OrderForBrief | null;
  if (!order) return null;
  const ticker = order.symbol.toUpperCase();
  const thesis = order.thesisId
    ? await prisma.thesis.findUnique({ where: { id: order.thesisId }, select: { stopLoss: true, targetPrice: true } })
    : null;

  // Only an original counts: a reused copy would stretch two-hour-old research past two hours.
  const recent = (await prisma.researchBrief.findMany({
    where: { ticker, reusedFromId: null, createdAt: { gte: new Date(now.getTime() - BRIEF_REUSE_MS) } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, orderId: true, payload: true },
  })).find((r) => r.orderId !== orderId && !!(r.payload as unknown as ResearchBriefPayload | null)?.synthesis);

  const { payload, costs, failures } = await buildBriefPayload({
    kind,
    order,
    stop: thesis?.stopLoss ?? order.position.stopLoss ?? null,
    target: thesis?.targetPrice ?? order.position.targetPrice ?? null,
    reuse: recent ? (recent.payload as unknown as ResearchBriefPayload) : null,
    now,
  });
  const row = await save(orderId, order.position.accountId, payload, costs, failures, recent?.id ?? null, now);
  return { briefId: row.id, reused: !!recent };
}
