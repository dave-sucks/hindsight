/**
 * load-snapshot.ts — reads what the portfolio snapshot is made of (snapshot.ts):
 * the broker's cash, shares and average costs; the money put in; the app's
 * prices; the day's fills and the proposals waiting, from the orders; and who
 * holds each stock. Read only.
 */
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getAccount, getAllPositions, getFundingActivities } from "@/lib/alpaca";
import { netContributedTotal } from "@/lib/portfolio/contributions";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { isMarketOpen } from "@/lib/market-hours";
import { buildSnapshot, type PortfolioSnapshot, type SnapshotProposal } from "@/lib/portfolio/snapshot";

/** Paper accounts start at this and have no transfers. */
const PAPER_SEED = 100_000;
/** Every status a proposal ends in: counted to say how many times a stock's proposal has come back. */
const PROPOSAL_STATUSES = ["AWAITING_APPROVAL", "EXPIRED", "REJECTED"];

const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Midnight in New York, as an instant, for the day YYYY-MM-DD. */
export function nyMidnight(day: string): Date {
  const noon = new Date(`${day}T12:00:00Z`);
  const offsetHours = Math.round(
    (new Date(noon.toLocaleString("en-US", { timeZone: "UTC" })).getTime() -
      new Date(noon.toLocaleString("en-US", { timeZone: "America/New_York" })).getTime()) /
      3_600_000,
  );
  return new Date(`${day}T${String(offsetHours).padStart(2, "0")}:00:00Z`);
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
  // The session the prices are from: today while open; outside it, the close's day (read from the quotes below).
  const quotes0 = await getLiveQuotes(held, { caller: "other", creds, now });
  const stamps = Object.values(quotes0).map((q) => q.quote?.t ?? 0);
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
  const history = waiting.length
    ? await prisma.order.findMany({
        where: { positionId: { in: [...new Set(waiting.map((w) => w.positionId))] }, status: { in: PROPOSAL_STATUSES } },
        select: { positionId: true, side: true, createdAt: true },
      })
    : [];

  // A stock sold out that day has no holding: its prior close comes with the rest.
  const soldOut = fills.map((f) => f.symbol.toUpperCase()).filter((t) => !held.includes(t));
  const quotes = soldOut.length ? { ...quotes0, ...(await getLiveQuotes(soldOut, { caller: "other", creds, now })) } : quotes0;

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

  const proposals: SnapshotProposal[] = waiting.map((w) => {
    const same = history.filter((h) => h.positionId === w.positionId && h.side === w.side);
    const first = same.reduce((d, h) => (h.createdAt < d ? h.createdAt : d), w.createdAt);
    return {
      side: w.side === "SELL" ? "SELL" : "BUY",
      ticker: w.symbol.toUpperCase(),
      shares: w.quantity,
      firstProposed: first.toISOString(),
      times: Math.max(1, same.length),
      note: w.rationale?.trim() || null,
      analyst: names.get(w.position.analystId) ?? null,
    };
  });

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
      return {
        ticker: t,
        shares: p.side === "short" ? -size : size,
        avgCost: parseFloat(p.avg_entry_price),
        price: q && q.c > 0 ? q.c : null,
        prevClose: q?.pc ?? null,
        analyst: holderOf.get(t) ?? null,
      };
    }),
    trades: fills.map((f) => {
      const t = f.symbol.toUpperCase();
      return {
        at: f.filledAt!.toISOString(),
        side: f.side === "SELL" ? "SELL" : "BUY",
        ticker: t,
        shares: f.filledQty ?? f.quantity,
        price: f.filledPrice ?? 0,
        prevClose: quotes[t]?.quote?.pc ?? null,
        analyst: names.get(f.position.analystId) ?? null,
      };
    }),
    waiting: proposals,
  });
}
