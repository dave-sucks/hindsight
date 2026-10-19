// An analyst's tool settings, book and broker keys: what a write runs with. A pinned
// chat loads them at the route; the Master Chat loads them per stock, for its analyst.
import { prisma } from "@/lib/prisma";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { analystToolSettings, type AnalystToolSettings, type ToolContext } from "@/lib/agent/tool-context";
import { positionBand, positionTotalCap } from "@/lib/agent/position-sizing";
import { capacityLine, type AnalystCapacity } from "@/lib/agent/capacity";
import type { AlpacaCredentials } from "@/lib/alpaca";

type Book = "PAPER" | "LIVE";

/** A thesis's analyst: the pinned one, else the analyst of the run that wrote it. */
export const analystOf = (t: { researchRun?: { agentConfigId?: string | null } | null }, pinned?: string | null): string | null =>
  pinned ?? t.researchRun?.agentConfigId ?? null;

export type AnalystScope = AnalystToolSettings & { analystId: string; runEnvironment: Book; alpacaCreds?: AlpacaCredentials };

export async function analystScope(
  ac: Parameters<typeof analystToolSettings>[0] & { id: string; tradingEnvironment: string | null },
  userId: string,
  book?: Book,
): Promise<AnalystScope> {
  const runEnvironment = book ?? ((ac.tradingEnvironment as Book | null) || "PAPER");
  const [watchlist, creds] = await Promise.all([getWatchlistSymbols(ac.id), resolveAlpacaCredentials(userId, runEnvironment)]);
  return { ...analystToolSettings(ac, watchlist), analystId: ac.id, runEnvironment, alpacaCreds: creds ?? undefined };
}

/** The chat acting for this analyst (in this book, else the analyst's). Any other run, or the same analyst, is unchanged. */
export async function forTheStock(ctx: ToolContext, analystId: string | null, book?: Book): Promise<ToolContext> {
  if (ctx.runMode !== "PRINCIPAL_CHAT" || !analystId || analystId === ctx.analystId) return ctx;
  const ac = await prisma.agentConfig.findFirst({ where: { id: analystId, accountId: ctx.accountId } });
  return ac ? { ...ctx, ...(await analystScope(ac, ctx.userId, book)) } : ctx;
}

// The Master Chat sells for the stock's holder: the one open position's analyst, in
// that position's book. Two holders: a question naming both.
export async function forHeldStock(ctx: ToolContext, ticker: string): Promise<{ ctx: ToolContext; question?: string }> {
  if (ctx.runMode !== "PRINCIPAL_CHAT" || ctx.analystId) return { ctx };
  const open = await prisma.position.findMany({
    where: { accountId: ctx.accountId, symbol: ticker, status: "OPEN" },
    select: { analystId: true, environment: true, analyst: { select: { name: true } } },
  });
  const books = [...new Map(open.map((p) => [`${p.analystId}:${p.environment}`, p])).values()];
  if (books.length > 1) {
    const who = books.map((p) => `${p.analyst?.name ?? p.analystId} (${p.environment})`).join(" and ");
    return { ctx, question: `$${ticker} is held by ${who}. Which one? Pin the chat to that analyst and ask again.` };
  }
  return { ctx: books[0] ? await forTheStock(ctx, books[0].analystId, books[0].environment as Book) : ctx };
}

type RoomAnalyst = Parameters<typeof analystToolSettings>[0] & { id: string; name: string; enabled: boolean };

/** Each analyst's slots, counted as place_trade counts them: open plus buys awaiting approval. */
async function slotsOf(ids: string[]): Promise<(a: { id: string; maxOpenPositions: number | null }) => AnalystCapacity> {
  const rows = await prisma.position.findMany({ where: { analystId: { in: ids }, status: { in: ["OPEN", "PENDING_APPROVAL"] } }, select: { analystId: true, symbol: true, status: true } });
  return (a) => {
    const mine = rows.filter((r) => r.analystId === a.id);
    const held = mine.filter((r) => r.status === "OPEN").map((r) => r.symbol);
    return { open: mine.length, max: a.maxOpenPositions, held, awaitingApproval: mine.length - held.length };
  };
}

/** One analyst's room, for the chat pinned to it. */
export async function analystRoom(a: { id: string; maxOpenPositions: number | null }): Promise<AnalystCapacity> {
  return (await slotsOf([a.id]))(a);
}

/** "Secular Compounder: Positions: 8 of 8 — this analyst is FULL. … Largest trade $10,000; most in one stock $20,000." */
export async function analystRoomLines(accountId: string, holders: string[]): Promise<string[]> {
  const analysts: RoomAnalyst[] = await prisma.agentConfig.findMany({ where: { accountId, OR: [{ enabled: true }, { id: { in: holders } }] }, orderBy: { createdAt: "asc" } });
  const room = await slotsOf(analysts.map((a) => a.id));
  const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return analysts.map((a) => {
    // The numbers the gates use: the row as the tools read it, the band, the cap and the slot count.
    const s = analystToolSettings(a, []);
    const { ceiling } = positionBand(s);
    return `${a.name}${a.enabled ? "" : " (paused: no new buys)"}: ${capacityLine({ ...room(a), held: [] }) ?? "No position limit."} Largest trade ${ceiling != null ? $(ceiling) : "not set"}; most in one stock ${$(positionTotalCap(s))}.`;
  });
}
