/**
 * load-snapshot.ts — reads what the portfolio snapshot is made of (snapshot.ts):
 * the broker's cash, shares and average costs; the money put in; the app's
 * prices; the day's fills and the proposals waiting, from the orders; and who
 * holds each stock. Read only. A broker read that fails throws: the caller
 * says the snapshot couldn't be read.
 */
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getAccount, getAllPositions, getFundingActivities } from "@/lib/alpaca";
import { netContributedTotal } from "@/lib/portfolio/contributions";
import { getLiveQuotes, type LiveQuoteResult } from "@/lib/market-data/live-quote";
import { isMarketOpen } from "@/lib/market-hours";
import { buildSnapshot, type PortfolioSnapshot, type SnapshotProposal } from "@/lib/portfolio/snapshot";

/** Paper accounts start at this and have no transfers. */
const PAPER_SEED = 100_000;
/**
 * The statuses a proposal ends in, counted to say how many times a stock's
 * proposal has come back. Only orders that were proposals (they carry an
 * expiry): a broker's rejection of an order that was never proposed is
 * REJECTED too.
 */
const PROPOSAL_STATUSES = ["AWAITING_APPROVAL", "EXPIRED", "REJECTED"];

const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const nyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));

/** Midnight in New York, as an instant, for the day YYYY-MM-DD (4 AM UTC in summer, 5 AM in winter). */
export function nyMidnight(day: string): Date {
  for (const utcHour of [4, 5]) {
    const at = new Date(`${day}T0${utcHour}:00:00Z`);
    if (nyDay(at) === day && nyHour(at) === 0) return at;
  }
  return new Date(`${day}T05:00:00Z`);
}

export async function loadPortfolioSnapshot(args: { accountId: string; environment: "PAPER" | "LIVE"; now?: Date }): Promise<PortfolioSnapshot | null> {
  const { accountId, environment } = args;
  const now = args.now ?? new Date();
  const userId = await getOwnerUserId(accountId);
  if (!userId) return null;
  const creds = (await resolveAlpacaCredentials(userId, environment).catch(() => null)) ?? undefined;
  if (!creds) return null;

  const [account, positions, contributed, open] = await Promise.all([
    getAccount(creds),
    getAllPositions(creds),
    environment === "LIVE"
      ? getFundingActivities(creds).then(netContributedTotal, (err) => {
          console.warn(`[snapshot] the transfers couldn't be read: ${err instanceof Error ? err.message : err}`);
          return null;
        })
      : Promise.resolve(PAPER_SEED),
    prisma.position.findMany({ where: { accountId, environment, status: "OPEN" }, select: { symbol: true, analystId: true } }),
  ]);

  const live = isMarketOpen(now);
  const held = positions.map((p) => p.symbol.toUpperCase());
  // The session the prices are from: today while open; outside it, the newest close's day.
  const heldQuotes = await getLiveQuotes(held, { caller: "other", creds, now });
  const stamps = Object.values(heldQuotes).map((q) => q.quote?.t ?? 0);
  const day = live || !stamps.some((t) => t > 0) ? nyDay(now) : nyDay(new Date(Math.max(...stamps) * 1000));
  const from = nyMidnight(day);
  const to = new Date(from.getTime() + 24 * 3_600_000);

  const [fills, waiting] = await Promise.all([
    prisma.order.findMany({
      where: { environment, status: "FILLED", filledAt: { gte: from, lt: to }, position: { accountId } },
      select: { symbol: true, side: true, quantity: true, filledQty: true, filledPrice: true, filledAt: true, position: { select: { analystId: true } } },
      orderBy: { filledAt: "asc" },
    }),
    prisma.order.findMany({
      where: { environment, status: "AWAITING_APPROVAL", position: { accountId } },
      select: { symbol: true, side: true, quantity: true, rationale: true, positionId: true, createdAt: true, position: { select: { analystId: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // A stock sold out that day has no holding: its prior close comes with the rest.
  const soldOut = [...new Set(fills.map((f) => f.symbol.toUpperCase()).filter((t) => !held.includes(t)))];
  const quotes: Record<string, LiveQuoteResult> = soldOut.length ? { ...heldQuotes, ...(await getLiveQuotes(soldOut, { caller: "other", creds, now })) } : heldQuotes;

  const analystIds = [...new Set([...open.map((p) => p.analystId), ...fills.map((f) => f.position.analystId), ...waiting.map((w) => w.position.analystId)])];
  const names = new Map(
    (await prisma.agentConfig.findMany({ where: { id: { in: analystIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]),
  );
  const holderOf = new Map<string, string>();
  for (const p of open) {
    const name = names.get(p.analystId);
    const t = p.symbol.toUpperCase();
    if (name) holderOf.set(t, holderOf.has(t) && holderOf.get(t) !== name ? `${holderOf.get(t)}, ${name}` : name);
  }

  const proposals: SnapshotProposal[] = [];
  for (const w of waiting) proposals.push(await proposalHistory(w, { accountId, environment }, names));

  const unrecordedFills = [...new Set(fills.filter((f) => f.filledPrice == null).map((f) => f.symbol.toUpperCase()))];

  return buildSnapshot({
    day,
    live,
    at: now.toISOString(),
    cash: parseFloat(account.cash),
    contributed,
    holdings: positions.map((p) => {
      const t = p.symbol.toUpperCase();
      const q = quotes[t]?.quote;
      const size = Math.abs(parseFloat(p.qty)) || 0;
      const price = q && q.c > 0 ? q.c : null;
      // A quote from before the snapshot's day: the stock didn't trade that day, so its day is flat.
      const stale = price != null && q!.t > 0 && nyDay(new Date(q!.t * 1000)) < day;
      return {
        ticker: t,
        shares: p.side === "short" ? -size : size,
        avgCost: parseFloat(p.avg_entry_price),
        price,
        prevClose: stale ? price : q?.pc ?? null,
        noTradeThatDay: stale || undefined,
        brokerValue: Number.isFinite(parseFloat(p.market_value)) ? parseFloat(p.market_value) : null,
        analyst: holderOf.get(t) ?? null,
      };
    }),
    trades: fills
      .filter((f) => f.filledPrice != null)
      .map((f) => {
        const t = f.symbol.toUpperCase();
        return {
          at: f.filledAt!.toISOString(),
          side: f.side === "SELL" ? ("SELL" as const) : ("BUY" as const),
          ticker: t,
          shares: f.filledQty ?? f.quantity,
          price: f.filledPrice!,
          prevClose: quotes[t]?.quote?.pc ?? null,
          analyst: names.get(f.position.analystId) ?? null,
        };
      }),
    unrecordedFills,
    waiting: proposals,
  });
}

type Waiting = { symbol: string; side: string; quantity: number; rationale: string | null; positionId: string; createdAt: Date; position: { analystId: string } };

/**
 * How many times this proposal has been made, and since when. A sale is the
 * same position each time. A buy makes a new position each time (an expired
 * one is set aside), so a buy is matched by its analyst, stock and side, since
 * the stock's last fill.
 */
async function proposalHistory(w: Waiting, book: { accountId: string; environment: string }, names: Map<string, string>): Promise<SnapshotProposal> {
  const ticker = w.symbol.toUpperCase();
  let since: Date | null = null;
  if (w.side !== "SELL") {
    const lastFill = await prisma.order.findFirst({
      where: { environment: book.environment, symbol: w.symbol, status: "FILLED", position: { accountId: book.accountId } },
      orderBy: { filledAt: "desc" },
      select: { filledAt: true },
    });
    since = lastFill?.filledAt ?? null;
  }
  const history = await prisma.order.findMany({
    where:
      w.side === "SELL"
        ? { positionId: w.positionId, side: "SELL", status: { in: PROPOSAL_STATUSES }, expiresAt: { not: null } }
        : {
            environment: book.environment,
            symbol: w.symbol,
            side: w.side,
            status: { in: PROPOSAL_STATUSES },
            expiresAt: { not: null },
            position: { accountId: book.accountId, analystId: w.position.analystId },
            ...(since ? { createdAt: { gt: since } } : {}),
          },
    select: { createdAt: true },
  });
  const first = history.reduce((d, h) => (h.createdAt < d ? h.createdAt : d), w.createdAt);
  return {
    side: w.side === "SELL" ? "SELL" : "BUY",
    ticker,
    shares: w.quantity,
    firstProposed: first.toISOString(),
    times: Math.max(1, history.length),
    note: w.rationale?.trim() || null,
    analyst: names.get(w.position.analystId) ?? null,
  };
}
