/**
 * get_sec_filings — SEC filings, any way you need to ask.
 *
 * One tool over one search (lib/market-data/sec-filings → searchFilings):
 *   WHERE  one company, several, your book (holdings + watches), the whole
 *          market, or the whole market minus your book (discovery);
 *   WHAT   any EDGAR form, any 8-K item code, or a tier (serious / material);
 *   WHEN   any window up to a year.
 * Each filing comes back with what it IS in plain words, a tier and a link.
 * New activist stakes (13D) across the market come back grouped by company
 * with who took the stake; everything else is a plain list. A search that
 * hit its page cap, or failed, says so in words — never "nothing filed".
 *
 * The trigger evaluator reads the same search (`SEC_EVENT`). Insider buying
 * is get_insider_activity (Form 4), not this tool.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import {
  searchFilings,
  SYMBOL_FILING_FORMS,
  type FilingResults,
  type FoundFiling,
} from "@/lib/market-data/sec-filings";
import { describeFilingEvent, FORM_NAMES, ITEM_NAMES, type SecFiling } from "@/lib/market-data/sec-events";

const TIER_WORD: Record<SecFiling["tier"], string> = {
  RED: "serious",
  MATERIAL: "material",
  CONTEXT: "routine",
};

type Scope = "company" | "coverage" | "universe" | "all";

/** Exchanges worth a look in a market-wide search — OTC shells file a lot. */
const LISTED = new Set(["Nasdaq", "NYSE", "CBOE"]);
const VISIBLE_CAP = 25;
const DATA_CAP = 300;

export const getSecFilings = defineTool({
  description:
    "SEC filings from EDGAR, searchable any way: WHERE — one company (`symbol`), several (`symbols`), your book " +
    "(`scope: \"coverage\"` = holdings + watches), the whole market (`scope: \"all\"`), or the whole market minus " +
    "your book (`scope: \"universe\"`, for discovery). WHAT — any EDGAR form (`forms`: \"8-K\", \"SCHEDULE 13D\", " +
    "\"NT 10-Q\", \"424B5\", \"S-3\", \"10-K\", \"10-Q\"…), 8-K item codes (`items`: \"5.02\" officer change, " +
    "\"4.02\" past financials unreliable, \"1.01\" major agreement, \"2.01\" acquisition completed, \"2.05\" layoffs, " +
    "\"8.01\"/\"7.01\" other events / press release — where FDA outcomes land), or a `tier` (\"RED\" = serious only, " +
    "\"MATERIAL\" = material or serious). WHEN — `days`, 1–365. Each filing comes with what it is in plain words, " +
    "its tier and a link. New activist stakes (13D) across the market come back grouped with who took the stake. " +
    "Examples: review the book — {scope:\"coverage\", tier:\"MATERIAL\", days:7}; one name — {symbol:\"MU\", days:30}; " +
    "discovery — {scope:\"universe\", forms:[\"SCHEDULE 13D\"], days:30}; every restatement this month — " +
    "{scope:\"all\", items:[\"4.02\"], days:30}. The code says what KIND of event it was, not whether it's good: " +
    "read the document before acting. Market-wide results carry no company size — check it with get_stock_data " +
    "before researching a name. For insider buying use get_insider_activity.",
  schema: z.object({
    symbol: z.string().optional().describe("One company, e.g. MU."),
    symbols: z.array(z.string()).max(50).optional().describe("Several companies at once."),
    scope: z
      .enum(["company", "coverage", "universe", "all"])
      .optional()
      .describe(
        "'company' = the symbol(s) given (the default when a symbol is given). 'coverage' = your holdings + watches (the default otherwise). 'universe' = the whole market minus your coverage. 'all' = the whole market.",
      ),
    forms: z
      .array(z.string().min(1).max(20))
      .max(15)
      .optional()
      .describe('EDGAR form names, e.g. ["8-K"], ["SCHEDULE 13D"], ["NT 10-K","NT 10-Q"], ["424B5","S-3"].'),
    items: z
      .array(z.string().min(4).max(5))
      .max(20)
      .optional()
      .describe('8-K item codes, e.g. ["5.02"] or ["4.02","4.01"]. Implies 8-K.'),
    tier: z
      .enum(["RED", "MATERIAL"])
      .optional()
      .describe("RED = serious filings only; MATERIAL = material or serious. Alone, it is the search; next to forms/items it filters them."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("How far back. Defaults: 90 for a company, 30 otherwise."),
    include_amendments: z
      .boolean()
      .optional()
      .describe("Keep amended 13Ds / offerings (amended 8-Ks are always kept). Default false."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => {
    const scope = resolveScope(args);
    if (scope === "company") {
      const names = args.symbols?.length ? args.symbols : [args.symbol ?? ""];
      return `Pulling SEC filings for ${names.map((n) => `$${n.toUpperCase()}`).join(", ")}`;
    }
    return scope === "coverage"
      ? "Pulling SEC filings on your book"
      : scope === "universe"
        ? "Searching SEC filings across the market, outside your coverage"
        : "Searching SEC filings across the market";
  },

  execute: async (args, ctx) => {
    const scope = resolveScope(args);
    const covered = coveredTickers(ctx);
    const market = scope === "universe" || scope === "all";
    const days = args.days ?? (scope === "company" ? 90 : 30);

    let tickers: string[] | undefined;
    if (scope === "company") {
      tickers = [...(args.symbols ?? []), ...(args.symbol ? [args.symbol] : [])];
      if (tickers.length === 0) {
        return words('get_sec_filings with scope "company" needs a symbol or symbols.');
      }
    } else if (scope === "coverage") {
      tickers = [...covered];
      if (tickers.length === 0) return words("No holdings or watches to search — your coverage is empty.");
    }

    // A market-wide search with nothing named would be every filing in
    // America; it defaults to the material-or-serious ones.
    const namedNothing = !args.forms?.length && !args.items?.length && !args.tier;
    const tier = args.tier ?? (market && namedNothing ? "MATERIAL" : undefined);

    const res = await searchFilings({
      tickers,
      forms: args.forms,
      items: args.items,
      tier,
      defaultForms: SYMBOL_FILING_FORMS,
      days,
      now: new Date(),
      includeAmendments: args.include_amendments,
    });

    const what = describeSearch({ forms: args.forms, items: args.items, tier });
    const where =
      scope === "company"
        ? tickers!.map((t) => `$${t.toUpperCase()}`).join(", ")
        : scope === "coverage"
          ? `your ${tickers!.length} holdings and watches`
          : scope === "universe"
            ? "the whole market (listed companies, outside your coverage)"
            : "the whole market (listed companies)";

    if (res.error) {
      return words(
        `SEC filings unavailable — ${res.error}. This is not "nothing filed". (Asked for ${what} on ${where}, last ${days} days.)`,
        { error: res.error },
      );
    }

    // Market-wide: listed companies only; universe also drops your book.
    let filings = res.filings;
    let unlisted = 0;
    let alreadyCovered = 0;
    if (market) {
      filings = filings.filter((f) => {
        if (!f.exchange || !LISTED.has(f.exchange)) {
          unlisted++;
          return false;
        }
        if (scope === "universe" && covered.has(f.ticker)) {
          alreadyCovered++;
          return false;
        }
        return true;
      });
    }

    const notes = searchNotes(res, { unlisted, alreadyCovered });
    const onlyStakes =
      market && (args.forms ?? []).length > 0 && args.forms!.every((f) => f.toUpperCase() === "SCHEDULE 13D");

    return onlyStakes
      ? stakeResult(filings, { days, where, notes })
      : listResult(filings, { days, where, what, notes, scope });
  },
});

// ── Pieces ──────────────────────────────────────────────────────────────────

function resolveScope(args: { scope?: Scope; symbol?: string; symbols?: string[] }): Scope {
  if (args.scope) return args.scope;
  return args.symbol || args.symbols?.length ? "company" : "coverage";
}

/** The analyst's book — the same coverage the earnings calendar uses. */
function coveredTickers(ctx: unknown): Set<string> {
  const c = ctx as { coveredTickers?: string[]; watchlist?: string[]; positionTickers?: string[] } | undefined;
  const list = c?.coveredTickers?.length ? c.coveredTickers : [...(c?.watchlist ?? []), ...(c?.positionTickers ?? [])];
  return new Set(list.map((t) => t.toUpperCase()));
}

/** "officer or director leaving or joining (5.02) filings" / "material or serious filings". */
export function describeSearch(q: { forms?: string[]; items?: string[]; tier?: "RED" | "MATERIAL" }): string {
  const parts = [
    ...(q.items ?? []).map((i) => `${ITEM_NAMES[i] ?? "item"} (${i})`),
    ...(q.forms ?? []).map((f) => {
      const F = f.toUpperCase();
      return FORM_NAMES[F] ? `${F} (${FORM_NAMES[F]})` : F;
    }),
  ];
  const tier = q.tier === "RED" ? "serious" : q.tier === "MATERIAL" ? "material or serious" : null;
  if (parts.length === 0) return tier ? `${tier} filings` : "watched filings and periodic reports";
  return `${parts.join(" or ")} filings${tier ? `, ${tier} only` : ""}`;
}

/** "1 watched filings…" → "1 watched filing…" (the first "filings" only). */
const counted = (n: number, what: string) => `${n} ${n === 1 ? what.replace(/\bfilings\b/, "filing") : what}`;

function searchNotes(res: FilingResults, market: { unlisted: number; alreadyCovered: number }): string[] {
  const notes: string[] = [];
  const left: string[] = [];
  if (res.dropped.amended) left.push(`${res.dropped.amended} amendments`);
  if (res.dropped.notTheItem) left.push(`${res.dropped.notTheItem} that only mentioned the item`);
  if (res.dropped.belowTier) left.push(`${res.dropped.belowTier} below the tier`);
  if (market.unlisted) left.push(`${market.unlisted} OTC or unlisted`);
  if (market.alreadyCovered) left.push(`${market.alreadyCovered} you already cover`);
  if (left.length) notes.push(`EDGAR matched ${res.matched}; left out ${left.join(", ")}.`);
  if (res.truncated) {
    notes.push(
      "EDGAR had more than this search reads — the oldest filings in the window weren't seen. Narrow the window or the forms to see them.",
    );
  }
  if (res.unknownTickers.length) notes.push(`Not on SEC's company list: ${res.unknownTickers.join(", ")}.`);
  return notes;
}

function words(text: string, extra: Record<string, unknown> = {}) {
  return {
    summary: text,
    data: { items: [{ kind: "generic" as const, text }], filings: [] as FilingRow[], count: 0, ...extra },
    sources: [] as Array<{ provider: string; title: string; url: string }>,
  };
}

interface FilingRow {
  ticker: string;
  company: string;
  exchange: string | null;
  type: string;
  date: string;
  description: string;
  items: string[];
  tier: SecFiling["tier"];
  /** Others named on the filing — for a 13D, who took the stake. */
  filers: string[];
  url: string;
}

const toRow = (f: FoundFiling): FilingRow => ({
  ticker: f.ticker,
  company: f.companyName,
  exchange: f.exchange,
  type: f.form,
  date: f.filedDate,
  description: describeFilingEvent(f),
  items: f.items,
  tier: f.tier,
  filers: f.filers,
  url: f.url,
});

type Item = { kind: "generic"; text: string } | { kind: "ticker"; ticker: string; tag: string; text: string };

function listResult(
  filings: FoundFiling[],
  o: { days: number; where: string; what: string; notes: string[]; scope: Scope },
) {
  const serious = filings.filter((f) => f.tier !== "CONTEXT");
  const header = filings.length
    ? `${counted(filings.length, o.what)} on ${o.where} in the last ${o.days} days` +
      (serious.length && serious.length < filings.length ? `, ${serious.length} serious or material.` : ".")
    : `No ${o.what} on ${o.where} in the last ${o.days} days.`;
  const oneCompany = o.scope === "company" && new Set(filings.map((f) => f.ticker)).size <= 1;
  const items: Item[] = [
    { kind: "generic", text: header },
    ...o.notes.map((text) => ({ kind: "generic" as const, text })),
    ...filings.slice(0, VISIBLE_CAP).map((f) => ({
      kind: "ticker" as const,
      ticker: f.ticker,
      tag: f.filedDate,
      text:
        `${describeFilingEvent(f)} · ${TIER_WORD[f.tier]}` +
        (f.rootForm === "SCHEDULE 13D" && f.filers.length ? ` · ${f.filers.join(", ")}` : "") +
        (oneCompany ? "" : ` — ${f.companyName}`),
    })),
  ];
  if (filings.length > VISIBLE_CAP) {
    items.push({ kind: "generic", text: `… and ${filings.length - VISIBLE_CAP} more (data.filings has up to ${DATA_CAP}).` });
  }
  return {
    summary: [header, ...o.notes].join(" "),
    data: { items, filings: filings.slice(0, DATA_CAP).map(toRow), count: filings.length },
    sources: [
      { provider: "SEC EDGAR", title: "EDGAR full-text search", url: "https://efts.sec.gov/LATEST/search-index" },
      ...serious.slice(0, 5).map((f) => ({ provider: "SEC EDGAR", title: `${f.ticker} ${describeFilingEvent(f)}`, url: f.url })),
    ],
  };
}

interface StakeRow {
  ticker: string;
  company: string;
  exchange: string | null;
  /** Newest first. */
  stakes: Array<{ date: string; holders: string[]; url: string; accession: string }>;
}

/**
 * New activist stakes, one row per company — two holders arriving in the
 * same window rank above one — then newest first.
 */
export function groupStakes(filings: FoundFiling[]): StakeRow[] {
  const byTicker = new Map<string, StakeRow>();
  for (const f of filings) {
    if (f.rootForm !== "SCHEDULE 13D") continue;
    const row = byTicker.get(f.ticker) ?? { ticker: f.ticker, company: f.companyName, exchange: f.exchange, stakes: [] };
    row.stakes.push({ date: f.filedDate, holders: f.filers, url: f.url, accession: f.accession });
    byTicker.set(f.ticker, row);
  }
  return [...byTicker.values()].sort(
    (a, b) => b.stakes.length - a.stakes.length || b.stakes[0].date.localeCompare(a.stakes[0].date),
  );
}

function stakeResult(filings: FoundFiling[], o: { days: number; where: string; notes: string[] }) {
  const rows = groupStakes(filings);
  const header =
    `${rows.length} compan${rows.length === 1 ? "y" : "ies"} with a new activist stake (13D) in the last ${o.days} days, ` +
    `on ${o.where}.`;
  const items: Item[] = [
    { kind: "generic", text: header },
    ...o.notes.map((text) => ({ kind: "generic" as const, text })),
  ];
  for (const r of rows.slice(0, VISIBLE_CAP)) {
    const holders = [...new Set(r.stakes.flatMap((s) => s.holders))];
    items.push({
      kind: "ticker",
      ticker: r.ticker,
      tag: r.stakes[0].date,
      text:
        `${holders.length ? holders.join(", ") : "A holder"} took a 5%+ stake` +
        `${r.stakes.length > 1 ? ` (${r.stakes.length} new stakes)` : ""} — ${r.company}, ${r.exchange}`,
    });
  }
  if (rows.length > VISIBLE_CAP) {
    items.push({ kind: "generic", text: `… and ${rows.length - VISIBLE_CAP} more (data.rows has them all).` });
  }
  return {
    summary: [header, ...o.notes].join(" "),
    data: { items, rows, filings: filings.slice(0, DATA_CAP).map(toRow), count: rows.length },
    sources: [
      {
        provider: "SEC EDGAR",
        title: "EDGAR full-text search — SCHEDULE 13D",
        url: "https://efts.sec.gov/LATEST/search-index?forms=SCHEDULE%2013D",
      },
    ],
  };
}
