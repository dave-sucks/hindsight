/**
 * digest-writer.ts — the 8 PM Portfolio Digest: the owner's summary of the
 * account's day, from the portfolio snapshot (lib/portfolio/snapshot.ts) and
 * nothing else. Every number it uses is the snapshot's; it narrates and gives
 * a view on the proposals waiting.
 *
 * Its record (lib/agent/engine/agents/portfolio-digest.ts) runs through the
 * agent runner (lib/agent/engine/run.ts): GPT-5.4 on OpenAI's Chat
 * Completions API, one call, the snapshot as its first message. The job
 * (lib/inngest/functions/portfolio-digest.ts) saves the digest.
 */
import { snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";
import { runAgent, type AgentRun, type AgentToRun, type RunAgentArgs } from "@/lib/agent/engine/run";

export const DIGEST_MODEL = PORTFOLIO_DIGEST.model;
export const DIGEST_RUN_MODE = "PORTFOLIO_DIGEST";

/** What its run is given: its subject, the account, and the snapshot its job saves with the digest. No tools. */
export function digestArgs(snapshot: PortfolioSnapshot, book: { userId?: string; accountId?: string } = {}): Omit<RunAgentArgs, "runId"> {
  const environment = snapshot.live ? "LIVE" : "PAPER";
  return {
    input: { now: new Date(snapshot.at), environment },
    subject: { kind: "account", userId: book.userId ?? "", accountId: book.accountId ?? "", environment },
    given: { snapshot },
    toolset: {},
    source: "portfolio-digest",
  };
}

/** The digest as the runner runs it for one snapshot: one saved run, read only. */
export const digestRun = (snapshot: PortfolioSnapshot): AgentToRun => ({ record: PORTFOLIO_DIGEST, mode: DIGEST_RUN_MODE, args: (target) => digestArgs(snapshot, target) });

/** The digest the job saves: its reply, or, when the run wrote none, the snapshot's own lines. */
export function narrativeOf(run: Pick<AgentRun, "text" | "error">, snapshot: PortfolioSnapshot): { narrative: string; model: string } {
  return run.text && !run.error ? { narrative: run.text, model: DIGEST_MODEL } : { narrative: fallbackNarrative(snapshot), model: "fallback" };
}

/** The digest with no run of its own (an account with no owner, the wire test). Never throws. */
export async function writeDigestNarrative(snapshot: PortfolioSnapshot, runId: string | null = null): Promise<{ narrative: string; model: string; run: AgentRun }> {
  const run = await runAgent(PORTFOLIO_DIGEST, { ...digestArgs(snapshot), runId });
  return { ...narrativeOf(run, snapshot), run };
}

/** The digest when the model wrote nothing: the snapshot's account lines and the count of proposals waiting. */
export function fallbackNarrative(snapshot: PortfolioSnapshot): string {
  const [, value, day] = snapshotText(snapshot).split("\n");
  const waiting = snapshot.waiting.length;
  return [value, day, waiting ? `${waiting} proposal${waiting === 1 ? " is" : "s are"} waiting for your approval.` : "Nothing is waiting for your approval."].join("\n\n");
}
