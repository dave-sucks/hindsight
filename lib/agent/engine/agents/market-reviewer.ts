/**
 * The Market Reviewer's record (docs/plans/AGENT_ENGINE.md): one run per
 * traded book at 7:30 AM ET (lib/agent/market-reviewer/run.ts,
 * lib/inngest/functions/market-reviewer.ts). One call with OpenAI's own web
 * search; its reply is the digest and its notes on our stocks. Its
 * instructions are its own text, the same on every run. Its context: the
 * market numbers, the portfolio, the book, what each thesis rests on, and its
 * own last digest and notes.
 * The schedule writes it no message: the date line is its start.
 */
import { MODES } from "@/lib/agent/modes";
import type { RunnableRecord } from "../types";

/** The six sections together, the links not counted; each section gets a sixth. */
export const DIGEST_CHARS = 3_000;

/** "Tue Nov 17" for an ET date. */
export const reviewDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");

/** Its reply: the digest and the notes, each note naming only stocks from this run's book. */
const replySchema = (tickers: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["digest", "notes"],
  properties: {
    digest: { type: "string" },
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tickers", "text", "impact", "effect"],
        properties: {
          tickers: { type: "array", minItems: 1, items: tickers.length ? { type: "string", enum: [...tickers] } : { type: "string" } },
          text: { type: "string" },
          impact: { type: "string", enum: ["low", "medium", "high"] },
          effect: { type: "string", enum: ["stronger", "weaker", "neutral"] },
        },
      },
    },
  },
});

export const MARKET_REVIEWER: RunnableRecord = {
  id: "market_reviewer",
  name: "Market Reviewer",
  does: "Researches the market's day and writes the morning digest, and notes on our stocks its research touches.",
  runsWhen: "7:30 AM ET on market days, one run per traded book.",
  messageFrom: "The schedule (lib/inngest/functions/market-reviewer.ts), which writes it no message: the date line is its start.",
  subject: "account",
  // The morning runs' model.
  model: MODES["research-run"].model,
  maxSteps: 1,
  timeoutMs: 600_000,
  // Its thinking and its searches count against it.
  maxOutputTokens: 20_000,
  reply: { name: "market_review", schema: (input) => replySchema(input.stocks ?? []) },
  instructions: ["market-reviewer.md"],
  context: ["market_numbers", "portfolio", "the_book", "the_cases", "last_output", "message"],
  tools: [],
  providerTools: ["web_search"],
  output: "One reply (JSON): the digest, saved for the day, and its notes (tickers: one of the stocks in this run's book), each saved on the stocks it names. A high note starts a look on a stock only through a trigger the owner saved for it (Review on a high note).",
};
