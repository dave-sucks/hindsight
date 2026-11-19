/**
 * The portfolio digest's record (docs/plans/AGENT_ENGINE.md): the owner's
 * evening summary of the account, from the portfolio snapshot and nothing
 * else (lib/agent/digest-writer.ts runs it, lib/inngest/functions/portfolio-digest.ts
 * at 8 PM ET). Its instructions are its own text, the same on every run;
 * its context is the portfolio. The schedule writes it no message.
 */
import type { RunnableRecord } from "../types";

export const PORTFOLIO_DIGEST: RunnableRecord = {
  id: "portfolio_digest",
  name: "Portfolio digest",
  does: "Writes your evening summary of the account, with its view on each proposal waiting for you.",
  runsWhen: "8:00 PM ET on market days, one run per traded book.",
  messageFrom: "The schedule (lib/inngest/functions/portfolio-digest.ts), which writes it no message.",
  // GPT-4o ignored "never suggest what to do with the cash" and skipped a waiting proposal on the Nov 11 book.
  model: "gpt-5.4",
  maxSteps: 1,
  timeoutMs: 120_000,
  api: "chat",
  // A reasoning model: its thinking counts against this.
  maxOutputTokens: 6000,
  instructions: ["portfolio-digest.md"],
  context: ["portfolio", "message"],
  tools: [],
  output: "One reply: 3 to 5 paragraphs of plain prose, saved as the digest on the home page.",
};
