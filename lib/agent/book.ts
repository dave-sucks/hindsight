/**
 * The book: every stock we hold and every stock we watch, a line each with
 * its belief, and a watch with its buy triggers. One read of an agent's
 * context, "the_book" (lib/agent/engine/parts.ts), the same text for every
 * agent given it: the Portfolio Manager and the Market Reviewer get the
 * account's, the chat pinned to an analyst gets that analyst's.
 */
import { firstSentence } from "@/lib/portfolio/snapshot";
import { parseLevelTriggers } from "@/lib/agent/triggers/load-levels";
import { sentenceOf } from "@/lib/agent/triggers/condition/describe";

export interface BookRow {
  ticker: string;
  status: "HOLDING" | "WATCHING";
  /** The analyst that covers it. */
  analyst: string | null;
  belief: string | null;
  /** On a watch: its buy triggers, as their sentences. */
  buyIf?: string[];
}

/** One line a stock: a stock held by one analyst and watched by another is held. */
export function bookText(rows: BookRow[]): string {
  const one = new Map<string, BookRow>();
  for (const r of rows) {
    const k = r.ticker.toUpperCase();
    if (!one.has(k) || (r.status === "HOLDING" && one.get(k)!.status !== "HOLDING")) one.set(k, r);
  }
  const all = [...one.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const line = (r: BookRow) =>
    `- ${r.ticker.toUpperCase()}${r.analyst ? ` · ${r.analyst}` : ""} · ${firstSentence(r.belief) ?? "no belief written"}${r.buyIf?.length ? ` · ${r.buyIf.join("; ")}` : ""}`;
  const list = (title: string, rs: BookRow[]) => [`${title} (${rs.length}):`, ...(rs.length ? rs.map(line) : ["- none"])].join("\n");
  return ["## The book", list("Holding", all.filter((r) => r.status === "HOLDING")), list("Watching", all.filter((r) => r.status === "WATCHING"))].join("\n");
}

/** The book of one account's book (paper or live), or of one analyst. Null when it can't be read. */
export async function loadBook(args: { accountId: string; environment: "PAPER" | "LIVE"; analystId?: string | null }): Promise<string | null> {
  // Imported here so the book's text can be written in the browser and in tests with no database.
  const { prisma } = await import("@/lib/prisma");
  const theses = await prisma.thesis
    .findMany({
      where: {
        status: { in: ["HOLDING", "WATCHING"] },
        researchRun: { agentConfig: { accountId: args.accountId, tradingEnvironment: args.environment, ...(args.analystId ? { id: args.analystId } : {}) } },
      },
      select: { ticker: true, status: true, coreBelief: true, triggers: true, researchRun: { select: { agentConfig: { select: { name: true } } } } },
      orderBy: [{ ticker: "asc" }, { id: "asc" }],
    })
    .catch(() => null);
  if (!theses) return null;
  return bookText(
    theses.map((t) => ({
      ticker: t.ticker,
      status: t.status === "HOLDING" ? "HOLDING" : "WATCHING",
      analyst: t.researchRun?.agentConfig?.name ?? null,
      belief: t.coreBelief,
      ...(t.status === "WATCHING" ? { buyIf: parseLevelTriggers(t.triggers, `watch=${t.ticker}`).filter((x) => x.action === "ENTER").map(sentenceOf) } : {}),
    })),
  );
}
