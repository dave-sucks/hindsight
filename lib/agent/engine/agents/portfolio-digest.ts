/**
 * The portfolio digest's record (docs/plans/AGENT_ENGINE.md): the owner's
 * evening summary of the account (lib/agent/digest-writer.ts runs it,
 * lib/inngest/functions/portfolio-digest.ts at 8 PM ET). Its instructions are
 * its own text, the same on every run; its context is the portfolio snapshot
 * and, on a day the Portfolio Manager ran, that day's write-up. It may search
 * the web. The schedule writes it no message.
 */
import type { RunnableRecord } from "../types";

export const PORTFOLIO_DIGEST: RunnableRecord = {
  id: "portfolio_digest",
  name: "Portfolio digest",
  does: "Writes your evening summary of the account: the day, each proposal waiting for you with its proposer's reason, and what the Portfolio Manager did.",
  runsWhen: "8:00 PM ET on market days, one run per traded book.",
  messageFrom: "The schedule (lib/inngest/functions/portfolio-digest.ts), which writes it no message.",
  subject: "account",
  // GPT-4o ignored "never suggest what to do with the cash" and skipped a waiting proposal on the Nov 11 book.
  model: "gpt-5.4",
  // Its searches, then its reply.
  maxSteps: 6,
  timeoutMs: 300_000,
  api: "chat",
  // A reasoning model: its thinking counts against this.
  maxOutputTokens: 6000,
  instructions: ["portfolio-digest.md"],
  context: ["portfolio", "manager_writeup", "message"],
  tools: ["web_search"],
  output: "One reply: 3 to 6 paragraphs of plain prose, saved as the digest on the home page.",
};
