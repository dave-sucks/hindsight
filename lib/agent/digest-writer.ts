/**
 * digest-writer.ts — writes the 8 PM Portfolio Digest: the owner's summary of
 * the account's day, from the portfolio snapshot (lib/portfolio/snapshot.ts)
 * and nothing else. Every number it uses is the snapshot's; it narrates and
 * gives a view on the proposals waiting.
 *
 * Model: GPT-5.4 (the morning runs' model) through the OpenAI SDK's
 * chat.completions, one call. GPT-4o ignored "never suggest what to do with
 * the cash" and skipped a waiting proposal on the Nov 11 book.
 */

import OpenAI from "openai";
import { snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import type { RequestRecord } from "@/lib/agent/run-requests";

const DIGEST_MODEL = "gpt-5.4";

export interface DigestWriterResult {
  narrative: string;
  model: string;
  /** The model call as it was sent, for the digest's run page (lib/agent/run-requests.ts). */
  request: RequestRecord;
  /** The run's thread: the snapshot as the first message, then the digest. */
  thread: unknown[];
}

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
}

const SYSTEM_PROMPT = `You write the owner's end-of-day summary of their stock account. The owner reads it on the home page.

You are given the account as code wrote it: its value and cash, the day's change and the change since the owner started, every holding with its price, its move that day and since it was bought, the day's buys and sells, and the proposals waiting for the owner's approval, each with its reason. Every number you write comes from it. Never invent a number, a reason or a stock.

Write 3 to 5 short paragraphs of plain prose, with no headings and no lists:
1. How the account did that day, and which holdings moved it most.
2. What was bought or sold that day. If nothing was, say so in a few words.
3. Every proposal waiting, each one, none left out. For each: what it would do, then your own view, in plain words: would you approve it or not, and why, from what the snapshot shows (the stock's move, how long it has been proposed, its reason). Don't just repeat the reason. A proposal is not a trade until the owner approves it. When one has been proposed many times, say how many and since when. Never name a new price level for a stock.
4. What stands out about the account as a whole: the biggest gains and losses since bought, a holding that has grown large. State the cash and its share of the account; never suggest what to do with it.

Name stocks by their ticker, as the snapshot does; never write out a company name it doesn't give. Write the way you would say it to a friend: short sentences, everyday words, and only the two or three numbers that matter in each paragraph.`;

/**
 * Write the digest from the snapshot. When the model writes nothing, the
 * digest is the snapshot's first lines, so the job always saves one.
 */
export async function writeDigestNarrative(
  snapshot: PortfolioSnapshot,
): Promise<DigestWriterResult> {
  const input = snapshotText(snapshot);
  // The request body, kept as it goes to OpenAI.
  const body = {
    model: DIGEST_MODEL,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: input },
    ],
    // A reasoning model: its thinking counts against this, and it takes no temperature.
    max_completion_tokens: 6000,
  };
  const startedAt = new Date().toISOString();
  const done = (narrative: string, model: string, error?: string): DigestWriterResult => ({
    narrative,
    model,
    request: { v: 1, call: "Main", source: "portfolio-digest", model: DIGEST_MODEL, startedAt, endedAt: new Date().toISOString(), requests: [body], ...(error ? { error } : {}) },
    thread: [body.messages[1], { role: "assistant", content: [{ type: "text", text: narrative }] }],
  });

  try {
    const resp = await getOpenAI().chat.completions.create(body);
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    if (resp.choices[0]?.finish_reason === "length") return done(fallbackNarrative(snapshot), "fallback", "The model's reply was cut off at its limit.");
    if (text) return done(text, DIGEST_MODEL);
    return done(fallbackNarrative(snapshot), "fallback", "The model replied with no text.");
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`[digest-writer] model call failed: ${why}`);
    return done(fallbackNarrative(snapshot), "fallback", why);
  }
}

/** The digest when the model wrote nothing: the snapshot's account lines and the count of proposals waiting. */
export function fallbackNarrative(snapshot: PortfolioSnapshot): string {
  const [, value, day] = snapshotText(snapshot).split("\n");
  const waiting = snapshot.waiting.length;
  return [value, day, waiting ? `${waiting} proposal${waiting === 1 ? " is" : "s are"} waiting for your approval.` : "Nothing is waiting for your approval."].join("\n\n");
}
