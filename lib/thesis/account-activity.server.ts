/**
 * account-activity.server.ts — loads the homepage Activity for one book, from
 * two sources:
 *
 *  1. Each stock's Activity list, built by the same activityFeed() from its
 *     orders (every order carries its stock since 2026-08-18) and its lines
 *     that changed its status, cut by the one filter (account-activity.ts).
 *     A stock's other lines (fires, reviews, notes) never pass that filter, so
 *     they are not loaded. A stock is on this book when the run that wrote it
 *     was, or when it has an order on this book (a watch written on paper and
 *     bought live).
 *  2. The attempts that never became a proposal, classified by
 *     attemptOutcomes (lib/portfolio/attempt-outcomes.ts), and the other
 *     refusals still open. A refusal and a run that broke are not Activity
 *     lines, so a stock's list cannot carry them.
 *
 * Merged newest first.
 */
// The browser entry: its null markers are the same, and it loads where the server client cannot (jest).
import { Prisma } from "@/lib/generated/prisma/browser";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";
import { prisma } from "@/lib/prisma";
import { activityFeed, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { FEED_ORDER_SELECT } from "@/lib/thesis/activity-feed.server";
import { ACCOUNT_ITEMS, accountActivityLine, attemptActivityLine, type AccountActivityLine } from "@/lib/thesis/account-activity";
import { attemptOutcomes, refusalReason, TRADE_TOOLS } from "@/lib/portfolio/attempt-outcomes";
import { describeRefusalTool, NO_LONGER_OWED } from "@/lib/agent/refusal-carryover";

type Book = { accountId: string; environment: AlpacaEnvironment };

export async function loadAccountActivity(book: Book, limit = ACCOUNT_ITEMS): Promise<AccountActivityLine[]> {
  const [stocks, attempts] = await Promise.all([
    loadStockLines(book, limit),
    loadAttempts(book).catch((err) => {
      // The record of what did not happen: its absence must not break the page.
      console.warn("[activity] attempts failed to load:", err);
      return [] as AccountActivityLine[];
    }),
  ]);
  return [...stocks, ...attempts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

/** Source 1: each stock's Activity list, cut to trades and watch status. */
async function loadStockLines(book: Book, limit: number): Promise<AccountActivityLine[]> {
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
  return [...stocks.values()].flatMap((s) => activityFeed(s).flatMap((item) => accountActivityLine(item, s.ticker) ?? []));
}

/**
 * Source 2, over the last 30 days: what attemptOutcomes reads (the book's
 * trigger runs and the runs a trade tool was refused in, the orders around
 * them, those refusals, and the notes those trigger runs wrote), and the
 * refusals of any other tool still open after 14 days at most.
 */
async function loadAttempts(book: Book): Promise<AccountActivityLine[]> {
  const analystIds = (await prisma.agentConfig.findMany({ where: { accountId: book.accountId }, select: { id: true } })).map((a) => a.id);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const refusals = await prisma.gateRejection.findMany({
    where: { tool: { in: TRADE_TOOLS }, analystId: { in: analystIds }, createdAt: { gte: since } },
    select: { runId: true, tool: true, ticker: true, summary: true, detail: true, createdAt: true },
  });
  const refusedRunIds = Array.from(new Set(refusals.map((r) => r.runId).filter((x): x is string => !!x)));
  const runs = await prisma.researchRun.findMany({
    where: {
      agentConfigId: { in: analystIds },
      environment: book.environment,
      startedAt: { gte: since },
      OR: [{ mode: "INTRADAY_TACTICAL" }, { id: { in: refusedRunIds } }],
    },
    select: { id: true, mode: true, status: true, startedAt: true, completedAt: true, agentConfigId: true, parameters: true },
  });
  const [orders, notes, blocked] = await Promise.all([
    prisma.order.findMany({
      // Three days more than the window: a proposal written before it can still have been waiting for an answer inside it.
      where: { position: { accountId: book.accountId, environment: book.environment }, createdAt: { gte: new Date(since.getTime() - 3 * 86_400_000) } },
      select: { symbol: true, intent: true, status: true, createdAt: true, updatedAt: true },
    }),
    prisma.thesisUpdate.findMany({
      where: { runId: { in: runs.filter((r) => r.mode === "INTRADAY_TACTICAL").map((r) => r.id) }, NOT: { type: "TRIGGER_FIRED" } },
      select: { runId: true, rationale: true, timestamp: true, thesis: { select: { ticker: true } } },
    }),
    // Every other refusal still open (a thesis edit, a thesis save, the Writer's research). A refusal the analyst
    // answered (the same tool landed on the stock) is the app working; a gate that refuses a field writes no row now.
    prisma.gateRejection.findMany({
      where: {
        tool: { notIn: [...TRADE_TOOLS, "complete_run"] },
        analystId: { in: analystIds },
        resolvedAt: null,
        createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
        OR: [{ gateCode: null }, { gateCode: { notIn: [...NO_LONGER_OWED] } }],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, tool: true, ticker: true, summary: true, detail: true, createdAt: true },
    }),
  ]);

  const attempts = attemptOutcomes({
    runs: runs.map((r) => {
      const p = (r.parameters ?? {}) as Record<string, unknown>;
      return {
        id: r.id, mode: r.mode, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt, analystId: r.agentConfigId,
        ticker: typeof p.ticker === "string" ? p.ticker : null,
        action: typeof p.action === "string" ? p.action : null,
        error: typeof p.error === "string" ? p.error : null,
      };
    }),
    orders: orders.map((o) => ({ ...o, intent: String(o.intent), status: String(o.status) })),
    refusals,
    notes: notes.filter((n) => n.runId != null).map((n) => ({ runId: n.runId!, ticker: n.thesis.ticker, rationale: n.rationale, timestamp: n.timestamp })),
  });
  return [
    ...attempts.map(attemptActivityLine),
    ...blocked.flatMap((b) =>
      b.ticker
        ? [attemptActivityLine({ id: `blocked-${b.id}`, kind: "BLOCKED", ticker: b.ticker, label: `${describeRefusalTool(b.tool)} blocked`, reason: refusalReason(b), at: b.createdAt, runId: null })]
        : [],
    ),
  ];
}
