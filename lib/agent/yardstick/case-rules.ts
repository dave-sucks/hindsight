/**
 * A case's rules graded on one run (./rules.ts), with what the rules read
 * taken from the case: the portfolio and market numbers it was sent, its book,
 * and which thesis is which stock from the rows it read. The runner
 * (scripts/hero-case.ts) and the regrader (scripts/yardstick-regrade.ts) both
 * call it, so a saved run is graded again the way it was graded.
 */
import type { AgentId } from "@/lib/agent/engine/types";
import type { GradedCall } from "./grade";
import type { StoredContext } from "./context";
import { brokenRules, holdingsOf, reviewerInvented, RULES, type Broken, type RuleRun } from "./rules";

/** A stored block's text, by today's block id. */
export const contextText = (context: StoredContext[] | undefined, block: string) => context?.find((x) => x.block === block)?.text ?? null;

/** The stocks a Market Reviewer's first message lists, held and watched ("- NVDA · …"), and the snapshot's holdings. */
export function bookOf(context: StoredContext[] | undefined): string[] {
  const lines = [contextText(context, "held_beliefs"), contextText(context, "watched_beliefs")].flatMap((t) => (t ?? "").split("\n"));
  return [...new Set([...lines.flatMap((l) => l.match(/^- ([A-Z][A-Z.\-]*) ·/)?.[1] ?? []), ...holdingsOf(contextText(context, "portfolio_snapshot"))])];
}

/** Thesis id to ticker, from the rows a recorded get_theses returned. */
export function thesisTickersOf(messages: unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages as Array<{ role?: string; content?: unknown }>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type?: string; toolName?: string; output?: { value?: { data?: { theses?: Array<{ id?: string; ticker?: string }> } } } }>) {
      if (p.type !== "tool-result" || p.toolName !== "get_theses") continue;
      for (const row of p.output?.value?.data?.theses ?? []) if (row.id && row.ticker) out.set(row.id, row.ticker.toUpperCase());
    }
  }
  return out;
}

/**
 * The rules an agent's run broke, and for the Market Reviewer its numbers
 * from nowhere (a number in a sentence with its link counts as sourced). Null
 * for an agent with no rules.
 */
export function caseRules(
  agent: AgentId,
  c: { context?: StoredContext[]; messages: unknown[] },
  run: { calls: GradedCall[]; reply: string; notes?: RuleRun["notes"]; shown: string },
): { rules: Broken[]; invented?: string[] } | null {
  if (!RULES.some((r) => r.agent === agent)) return null;
  const ruleRun: RuleRun = {
    ...run,
    portfolio: contextText(c.context, "portfolio_snapshot"),
    marketNumbers: contextText(c.context, "market_numbers"),
    book: bookOf(c.context),
    thesisTickers: thesisTickersOf(c.messages),
  };
  return { rules: brokenRules(agent, ruleRun), ...(agent === "market_reviewer" ? { invented: reviewerInvented(ruleRun) } : {}) };
}
