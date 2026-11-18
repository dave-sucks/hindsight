/**
 * digest-writer.ts — writes the 8 PM Portfolio Digest: the owner's summary of
 * the account's day, from the portfolio snapshot (lib/portfolio/snapshot.ts)
 * and nothing else. Every number it uses is the snapshot's; it narrates and
 * gives a view on the proposals waiting.
 *
 * Model: GPT-5.4 (the morning runs' model) through the OpenAI SDK's
 * chat.completions, one call. Its instructions and the snapshot as its first
 * message are built by the agent engine from its record
 * (lib/agent/engine/agents/portfolio-digest.ts).
 */

import OpenAI from "openai";
import { portfolioPieceText, snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import type { RequestRecord } from "@/lib/agent/run-requests";
import { buildAgentRequest } from "@/lib/agent/engine/engine";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";

const DIGEST_MODEL = PORTFOLIO_DIGEST.model;

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

/**
 * Write the digest from the snapshot. When the model writes nothing, the
 * digest is the snapshot's first lines, so the job always saves one.
 */
export async function writeDigestNarrative(
  snapshot: PortfolioSnapshot,
): Promise<DigestWriterResult> {
  const built = await buildAgentRequest(PORTFOLIO_DIGEST, { now: new Date(snapshot.at), environment: snapshot.live ? "LIVE" : "PAPER" }, {
    portfolioPieces: async () => [{ id: "portfolio_snapshot", text: portfolioPieceText(snapshot) }],
  });
  // The request body, kept as it goes to OpenAI.
  const body = {
    model: DIGEST_MODEL,
    messages: [
      { role: "system" as const, content: built.instructions },
      { role: "user" as const, content: built.message },
    ],
    // A reasoning model: its thinking counts against this, and it takes no temperature.
    max_completion_tokens: 6000,
  };
  const startedAt = new Date().toISOString();
  const done = (narrative: string, model: string, error?: string): DigestWriterResult => ({
    narrative,
    model,
    request: { v: 1, call: "Main", agent: built.agent, source: "portfolio-digest", model: DIGEST_MODEL, startedAt, endedAt: new Date().toISOString(), requests: [body], parts: built.parts, ...(error ? { error } : {}) },
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
