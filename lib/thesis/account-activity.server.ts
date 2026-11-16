/**
 * account-activity.server.ts — loads the homepage Activity for one book: each
 * stock's Activity list, built by the same activityFeed() from its orders
 * (every order carries its stock since 2026-08-18) and its lines that changed
 * its status, merged newest first and cut by the one filter
 * (account-activity.ts). A stock's other lines (fires, reviews, notes) never
 * pass that filter, so they are not loaded. A stock is on this book when the
 * run that wrote it was, or when it has an order on this book (a watch written
 * on paper and bought live).
 */
// The browser entry: its null markers are the same, and it loads where the server client cannot (jest).
import { Prisma } from "@/lib/generated/prisma/browser";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";
import { prisma } from "@/lib/prisma";
import { activityFeed, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { FEED_ORDER_SELECT } from "@/lib/thesis/activity-feed.server";
import { ACCOUNT_ITEMS, accountActivityLine, type AccountActivityLine } from "@/lib/thesis/account-activity";

export async function loadAccountActivity(book: { accountId: string; environment: AlpacaEnvironment }, limit = ACCOUNT_ITEMS): Promise<AccountActivityLine[]> {
  const orders = await prisma.order.findMany({
    where: { thesisId: { not: null }, position: { accountId: book.accountId, environment: book.environment } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { ...FEED_ORDER_SELECT, thesisId: true },
  });
  const lines = await prisma.thesisUpdate.findMany({
    where: {
      thesis: { accountId: book.accountId },
      OR: [{ thesis: { researchRun: { environment: book.environment } } }, { thesisId: { in: orders.map((o) => o.thesisId!) } }],
      fieldChanges: { path: ["status"], not: Prisma.AnyNull },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { id: true, thesisId: true, timestamp: true, type: true, summary: true, rationale: true, fieldChanges: true, priceAtTime: true, tradeId: true, runId: true, thesis: { select: { ticker: true } } },
  });

  const stocks = new Map<string, { ticker: string; updates: StoredLine[]; orders: ProposalOrder[] }>();
  const stock = (id: string, ticker: string) => stocks.get(id) ?? stocks.set(id, { ticker, updates: [], orders: [] }).get(id)!;
  for (const o of orders) stock(o.thesisId!, o.symbol).orders.push(o as unknown as ProposalOrder);
  for (const l of lines) stock(l.thesisId, l.thesis.ticker).updates.push(l);

  return [...stocks.values()]
    .flatMap((s) => activityFeed(s).flatMap((item) => accountActivityLine(item, s.ticker) ?? []))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
