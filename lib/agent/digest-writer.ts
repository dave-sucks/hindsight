/**
 * digest-writer.ts — the 8 PM Portfolio Digest: the owner's summary of the
 * account's day, from the portfolio snapshot (lib/portfolio/snapshot.ts) and,
 * on a day the Portfolio Manager ran, its write-up. Every number it uses is
 * the snapshot's; it narrates, and reports each waiting proposal's reason.
 *
 * Its record (lib/agent/engine/agents/portfolio-digest.ts) runs through the
 * agent runner (lib/agent/engine/run.ts): GPT-5.4 on OpenAI's Chat
 * Completions API, the snapshot in its first message, with web search. The job
 * (lib/inngest/functions/portfolio-digest.ts) saves the digest.
 */
import { snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";
import type { ToolSet } from "ai";
import { runAgent, type AgentRun, type AgentToRun, type RunAgentArgs } from "@/lib/agent/engine/run";
import { createResearchTools } from "@/lib/agent/tools";

export const DIGEST_MODEL = PORTFOLIO_DIGEST.model;
export const DIGEST_RUN_MODE = "PORTFOLIO_DIGEST";

/** What its run is given: its subject, the account, the snapshot its job saves with the digest, and the run's tools (its record lists web search). */
export function digestArgs(snapshot: PortfolioSnapshot, book: { userId?: string; accountId?: string; environment?: "PAPER" | "LIVE" } = {}, runId: string | null = null): Omit<RunAgentArgs, "runId"> {
  const environment = book.environment ?? "PAPER";
  return {
    input: { now: new Date(snapshot.at), environment },
    subject: { kind: "account", userId: book.userId ?? "", accountId: book.accountId ?? "", environment },
    given: { snapshot },
    toolset: createResearchTools({ runId: runId ?? "", userId: book.userId ?? "", accountId: book.accountId ?? "", runMode: DIGEST_RUN_MODE, runEnvironment: environment }) as ToolSet,
    source: "portfolio-digest",
  };
}

/** The digest as the runner runs it for one snapshot: one saved run, read only. */
export const digestRun = (snapshot: PortfolioSnapshot): AgentToRun => ({ record: PORTFOLIO_DIGEST, mode: DIGEST_RUN_MODE, args: (target, runId) => digestArgs(snapshot, target, runId) });

/** The digest the job saves: its reply, or, when the run wrote none, the snapshot's own lines. */
export function narrativeOf(run: Pick<AgentRun, "text" | "error">, snapshot: PortfolioSnapshot): { narrative: string; model: string } {
  return run.text && !run.error ? { narrative: run.text, model: DIGEST_MODEL } : { narrative: fallbackNarrative(snapshot), model: "fallback" };
}

/** The digest with no run of its own (an account with no owner, a dry run, the wire test). Never throws. */
export async function writeDigestNarrative(snapshot: PortfolioSnapshot, runId: string | null = null, book: Parameters<typeof digestArgs>[1] = {}): Promise<{ narrative: string; model: string; run: AgentRun }> {
  const run = await runAgent(PORTFOLIO_DIGEST, { ...digestArgs(snapshot, book, runId), runId });
  return { ...narrativeOf(run, snapshot), run };
}

/** The digest when the model wrote nothing: the snapshot's account lines and the count of proposals waiting. */
export function fallbackNarrative(snapshot: PortfolioSnapshot): string {
  const [, value, day] = snapshotText(snapshot).split("\n");
  const waiting = snapshot.waiting.length;
  return [value, day, waiting ? `${waiting} proposal${waiting === 1 ? " is" : "s are"} waiting for your approval.` : "Nothing is waiting for your approval."].join("\n\n");
}
