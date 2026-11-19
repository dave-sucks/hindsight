/**
 * last_output: what the agent wrote on its last run in this book, read where
 * its run keeps it: the Portfolio Manager's write-up; the Market Reviewer's
 * notes of the last 5 days and its last digest.
 */
import type { Fact } from "./fact";

export const lastOutput: Fact = {
  account: async (run) => {
    if (run.agent === "portfolio_manager") {
      const { lastWriteup } = await import("@/lib/agent/portfolio-manager/run");
      return `## Your last write-up\n${await lastWriteup(run.subject)}`;
    }
    if (run.agent === "market_reviewer") {
      const { reviewerLastOutput } = await import("@/lib/agent/market-reviewer/run");
      return reviewerLastOutput(run.subject, run.now);
    }
    throw new Error(`${run.agent} keeps no last output`);
  },
};
