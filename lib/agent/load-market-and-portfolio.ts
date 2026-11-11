/**
 * load-market-and-portfolio.ts — what fills the Market and portfolio block
 * (lib/agent/market-and-portfolio.ts) for one book, read when the request is
 * built. Each part is read only when it is switched on, and gets PART_LIMIT
 * to answer; a part that fails or runs out of time is printed as a line that
 * says it couldn't be read, and the run goes on:
 *   - the market brief (lib/agent/market-digest-slot.ts);
 *   - the market numbers (lib/market-data/load-market-numbers.ts);
 *   - the portfolio brief: the newest PortfolioDigest.brief for the book;
 *   - the portfolio numbers: the broker's cash, prior close and positions,
 *     each holding at the app's own price (lib/portfolio/value-at-quotes.ts),
 *     the transfers; the sales waiting with their history
 *     (load-sale-queue.ts) and the other proposals waiting; the holdings'
 *     report dates, from the calendar call the earnings triggers make;
 *   - the notes to the account or the run's analyst, while they last.
 */
import { prisma } from "@/lib/prisma";
import { getAccount, getAllPositions, getFundingActivities, type AlpacaAccount, type AlpacaCredentials } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { latestMarketBrief, type Brief } from "@/lib/agent/market-digest-slot";
import { EMPTY_BLOCK, freshBrief, isOn, marketAndPortfolioBlock, type BlockPartId, type MarketAndPortfolio, type PortfolioNumbers } from "@/lib/agent/market-and-portfolio";
import { loadMarketNumbers } from "@/lib/market-data/load-market-numbers";
import { runNoteLine, runNotes } from "@/lib/agent/shared-notes";
import { loadSharedNotes } from "@/lib/agent/shared-notes.server";
import { EARNINGS_LOOKAHEAD_DAYS, fetchEarningsWindow, type EarningsWindow } from "@/lib/agent/triggers/earnings";
import { loadSaleQueue } from "@/lib/portfolio/load-sale-queue";
import { getLiveQuotes, type LiveQuoteResult } from "@/lib/market-data/live-quote";
import { isMarketOpen } from "@/lib/market-hours";
import { dayChangeAt, priceBook } from "@/lib/portfolio/value-at-quotes";
import { closedDay } from "@/lib/portfolio/closed-day";

/** How far ahead a holding's report is listed: the earnings triggers' own window. */
export const REPORTING_DAYS = EARNINGS_LOOKAHEAD_DAYS;
/** How long each part may take before the request goes on without it; the report dates get a little less, inside the account's part. */
export const PART_LIMIT = { ms: 3_000, reportsMs: 2_000 };

export interface Book {
  accountId: string | null | undefined;
  environment: string | null | undefined;
  /** Whose broker keys and notes: SharedNote rows are kept by user. */
  userId: string | null | undefined;
  /** The run's analyst: its notes and the account's. None (the chat on the whole account): every analyst's. */
  analystId: string | null | undefined;
  /** The run's broker keys when it already has them. */
  creds?: AlpacaCredentials;
  /** Reads the caller already made, so the block doesn't make them again: the broker's account, and quotes by symbol. */
  preload?: { account?: AlpacaAccount | null; quotes?: Record<string, LiveQuoteResult> };
}

/** A day's change as its 8 PM digest worked it out, given for a day instead of read (the dry-run script). */
export interface ClosedDay {
  day: string;
  dollars: number;
  pct: number;
}

/** No answer within `ms`: the read is given up on, and its caller says it couldn't be read. */
function within<T>(ms: number, load: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve().then(load),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function portfolioBrief(book: Book, environment: string): Promise<Brief | null> {
  if (!book.accountId) return null;
  const row = await prisma.portfolioDigest.findFirst({
    where: { accountId: book.accountId, environment, brief: { not: null } },
    orderBy: { date: "desc" },
    select: { date: true, brief: true, createdAt: true },
  });
  // The date column is midnight UTC of the New York day (etTradingDayDate).
  return row?.brief ? { date: row.date.toISOString().slice(0, 10), brief: row.brief, writtenAt: row.createdAt.toISOString() } : null;
}

async function portfolioNumbers(book: Book, environment: "PAPER" | "LIVE", creds: AlpacaCredentials | undefined, now: Date, given?: ClosedDay): Promise<PortfolioNumbers | null> {
  if (!book.accountId) return null;
  const accountId = book.accountId;
  // Each read starts inside a promise, so one that throws at once can't leave another unwatched.
  const [broker, transfers, positions, pending] = await Promise.all([
    Promise.resolve().then(() => book.preload?.account ?? getAccount(creds)),
    Promise.resolve().then(() => getFundingActivities(creds)).catch(() => null),
    Promise.resolve().then(() => getAllPositions(creds)),
    Promise.resolve().then(() =>
      prisma.order.findMany({
        where: { status: "AWAITING_APPROVAL", environment, side: "BUY", position: { accountId } },
        select: { symbol: true, intent: true },
        orderBy: { createdAt: "asc" },
      }),
    ),
  ]);
  const cash = parseFloat(broker.cash);
  if (!Number.isFinite(cash)) throw new Error("the broker gave no cash figure");
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const open = isMarketOpen(now);
  // Each holding at the app's own price: the broker marks them at after-hours prints.
  const have = book.preload?.quotes ?? {};
  const missing = positions.map((p) => p.symbol.toUpperCase()).filter((s) => !have[s]?.quote);
  const quotes = { ...have, ...(missing.length ? await getLiveQuotes(missing, { caller: "other", creds, now }) : {}) };
  const priced = priceBook(cash, positions, quotes, open);
  const held = priced.held;
  const priceOf = (t: string) => {
    const price = held.find((h) => h.ticker === t)?.price;
    return price != null && Number.isFinite(price) && price > 0 ? price : null;
  };
  const tickers = new Set(held.map((h) => h.ticker));
  // The broker's prior close, and the day it is: once that is the close these prices are at, the day's figure is its digest's.
  const prior = { equity: broker.last_equity != null ? parseFloat(broker.last_equity) : null, asOf: broker.balance_asof ?? null };
  const session = priced.closeOf ?? today;
  const rolled = prior.asOf != null && prior.asOf >= session;
  const [sales, reports, closed] = await Promise.all([
    loadSaleQueue({ accountId, environment, priceOf }).catch((err) => {
      console.warn("[market-and-portfolio] the sales waiting couldn't be read:", err instanceof Error ? err.message : err);
      return null;
    }),
    tickers.size ? within(PART_LIMIT.reportsMs, () => reportDates(now)).catch(() => null) : Promise.resolve(null),
    rolled ? (given?.day === session ? Promise.resolve(given) : closedDay(accountId, environment, session).catch(() => null)) : Promise.resolve(null),
  ]);
  return {
    at: now,
    close: priced.closeOf,
    open,
    equity: priced.value,
    // Without the transfers a deposit would read as a gain, so the change can't be read.
    today: transfers ? dayChangeAt(priced, prior, transfers, today, closed) : null,
    cash,
    holdings: tickers.size,
    biggest: priced.value > 0 ? [...held].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3).map((h) => ({ ticker: h.ticker, share: Math.abs(h.value) / priced.value })) : [],
    sales,
    pending: pending.map((o) => ({ ticker: o.symbol, kind: o.intent === "ADD" ? ("add" as const) : ("buy" as const) })),
    // Null when the dates couldn't be read: the block says so rather than leaving the line out.
    reporting: !tickers.size
      ? []
      : reports
        ? [...reports.upcoming.values()]
            .filter((r) => tickers.has(r.symbol) && r.reportDate >= today)
            .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
            .map((r) => ({ ticker: r.symbol, date: r.reportDate, hour: r.hour }))
        : null,
  };
}

/**
 * The scheduled reports, from the same calendar call the earnings triggers
 * make, so it shares that call's 5-minute cache. The client tries a rate
 * limit once more itself; null when it still can't be read.
 */
async function reportDates(now: Date): Promise<EarningsWindow | null> {
  const w = await fetchEarningsWindow({ now, lookaheadDays: EARNINGS_LOOKAHEAD_DAYS });
  return w.error ? null : w;
}

/** Every note to the account or the run's analyst until its own end date (runNotes), newest first. */
async function notes(book: Book, now: Date): Promise<MarketAndPortfolio["notes"]> {
  const live = runNotes(await loadSharedNotes(book.userId ?? undefined, now), book.analystId, now).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const ids = [...new Set(live.flatMap((n) => (n.audience === "ANALYST" && n.analystId ? [n.analystId] : [])))];
  const names = new Map(
    ids.length ? (await prisma.agentConfig.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((a) => [a.id, a.name] as const) : [],
  );
  return live.map((n) => ({ author: n.author, line: runNoteLine(n, names.get(n.analystId ?? "") ?? null) }));
}

export async function loadMarketAndPortfolio(book: Book, now: Date = new Date(), opts: { closedDay?: ClosedDay } = {}): Promise<MarketAndPortfolio> {
  const environment = book.environment === "LIVE" ? "LIVE" : "PAPER";
  const unread: BlockPartId[] = [];
  const read = async <T,>(id: BlockPartId, load: () => Promise<T>, none: T): Promise<T> => {
    if (!isOn(id)) return none;
    try {
      return await within(PART_LIMIT.ms, load);
    } catch (err) {
      console.error(`[market-and-portfolio] the ${id} part couldn't be read:`, err instanceof Error ? err.message : err);
      unread.push(id);
      return none;
    }
  };
  let looked: Promise<AlpacaCredentials | undefined> | null = null;
  const creds = () =>
    (looked ??= book.creds ? Promise.resolve(book.creds) : book.userId ? resolveAlpacaCredentials(book.userId, environment).then((c) => c ?? undefined) : Promise.resolve(undefined));
  const [marketBrief, marketNumbers, pBrief, pNumbers, n] = await Promise.all([
    read("marketBrief", async () => (book.accountId ? latestMarketBrief({ accountId: book.accountId, environment }) : null), null),
    read("marketNumbers", async () => loadMarketNumbers({ now, creds: await creds() }), null),
    read("portfolioBrief", () => portfolioBrief(book, environment), null),
    read("portfolioNumbers", async () => portfolioNumbers(book, environment, await creds(), now, opts.closedDay), null),
    read("notes", () => notes(book, now), [] as MarketAndPortfolio["notes"]),
  ]);
  return { ...EMPTY_BLOCK, marketBrief: freshBrief(marketBrief, now), marketNumbers, portfolioBrief: freshBrief(pBrief, now), portfolioNumbers: pNumbers, notes: n, unread, at: now };
}

/** How long the chat keeps the block it loaded. */
export const CHAT_BLOCK_FOR_MS = 30 * 60_000;

/** The book as the chat's kept block must match it: the orders awaiting approval, and how many positions are open. */
async function bookPrint(book: Book): Promise<string> {
  if (!book.accountId) return "";
  const environment = book.environment === "LIVE" ? "LIVE" : "PAPER";
  const [waiting, open] = await Promise.all([
    prisma.order.findMany({ where: { status: "AWAITING_APPROVAL", environment, position: { accountId: book.accountId } }, select: { id: true } }),
    prisma.position.count({ where: { accountId: book.accountId, environment, status: "OPEN" } }),
  ]);
  return `${waiting.map((o) => o.id).sort().join(",")}|${open}`;
}

/**
 * The chat's block: loaded once per conversation and kept for 30 minutes, so
 * the chat's prompt stays the same from one message to the next and the
 * provider's cache holds. Kept on the conversation's run row
 * (parameters.marketAndPortfolio), for the same book and analyst only. Its
 * account line says when it was read.
 */
export async function blockForConversation(runId: string | undefined, book: Book, now: Date = new Date()): Promise<string> {
  // The book's state is in the key, so an approval, a decline or a trade reads the block again.
  const print = await bookPrint(book).catch(() => null);
  const key = `${book.environment === "LIVE" ? "LIVE" : "PAPER"}:${book.analystId ?? ""}:${print ?? `unread ${now.getTime()}`}`;
  const params = async () => {
    const row = runId ? await prisma.researchRun.findUnique({ where: { id: runId }, select: { parameters: true } }) : null;
    return (row?.parameters && typeof row.parameters === "object" ? row.parameters : {}) as Record<string, unknown>;
  };
  if (runId) {
    const kept = (await params().catch(() => ({}) as Record<string, unknown>)).marketAndPortfolio as { block?: string; at?: string; key?: string } | undefined;
    if (typeof kept?.block === "string" && kept.key === key && kept.at && now.getTime() - Date.parse(kept.at) < CHAT_BLOCK_FOR_MS) return kept.block;
  }
  const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(book, now), now);
  if (runId) {
    try {
      // Read again and merge: the turn's own save writes other keys on the same row.
      await prisma.researchRun.update({ where: { id: runId }, data: { parameters: { ...(await params()), marketAndPortfolio: { block, at: now.toISOString(), key } } as object } });
    } catch (err) {
      console.warn("[market-and-portfolio] the chat's block couldn't be kept:", err instanceof Error ? err.message : err);
    }
  }
  return block;
}
