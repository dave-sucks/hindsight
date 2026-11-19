/**
 * The rows a run's facts are read from, once per run: the analyst, and on a
 * thesis the thesis itself. The database is imported when a fact is read,
 * so a fact's text can be written in tests with no database.
 */
import { once, type ContextRun } from "./fact";

/** The analyst the run works for, with the account's playbook numbers over the catalog. Null when it can't be read. */
export function analystOf(run: ContextRun, analystId: string) {
  return once(run, `analyst:${analystId}`, async () => {
    const { prisma } = await import("@/lib/prisma");
    const { loadSetupOverrides } = await import("@/lib/agent/knowledge/load-setup-overrides");
    const ac = await prisma.agentConfig.findUnique({ where: { id: analystId } }).catch(() => null);
    if (!ac) return null;
    return { ...ac, setupOverrides: await loadSetupOverrides(ac.accountId) };
  });
}

/** An analyst's room: its slots, counted as place_trade counts them. Null when they can't be counted: no line is better than no run. */
export async function roomOf(a: { id: string; maxOpenPositions: number | null }) {
  const { analystRoom } = await import("@/lib/agent/analyst-scope");
  return analystRoom(a).catch((err) => {
    console.warn(`[context] the room of analyst ${a.id} couldn't be counted:`, err instanceof Error ? err.message : err);
    return null;
  });
}

/** The thesis a run is about: its playbook and status. Null when it has none yet or it can't be read. */
export function thesisOf(run: ContextRun, thesisId: string | null) {
  if (!thesisId) return Promise.resolve(null);
  return once(run, `thesis:${thesisId}`, async () => {
    const { prisma } = await import("@/lib/prisma");
    return prisma.thesis.findUnique({ where: { id: thesisId }, select: { id: true, ticker: true, status: true, setupId: true } }).catch(() => null);
  });
}

/** The stocks an analyst holds and watches, upper-case: the earnings and filings on its book are read for these. */
export function bookTickersOf(run: ContextRun, analystId: string) {
  return once(run, `book-tickers:${analystId}`, async () => {
    const { prisma } = await import("@/lib/prisma");
    const [theses, open] = await Promise.all([
      prisma.thesis.findMany({ where: { status: { in: ["HOLDING", "WATCHING"] }, researchRun: { agentConfigId: analystId } }, select: { ticker: true } }),
      prisma.position.findMany({ where: { analystId, status: "OPEN" }, select: { symbol: true } }),
    ]);
    return [...new Set([...open.map((p) => p.symbol.toUpperCase()), ...theses.map((t) => t.ticker.toUpperCase())])];
  });
}
