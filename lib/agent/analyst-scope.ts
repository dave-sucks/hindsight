// An analyst's tool settings, book and broker keys: what a write runs with. A pinned
// chat loads them at the route; the Master Chat loads them per stock, for its analyst.
import { prisma } from "@/lib/prisma";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { analystToolSettings, type AnalystToolSettings, type ToolContext } from "@/lib/agent/tool-context";
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

