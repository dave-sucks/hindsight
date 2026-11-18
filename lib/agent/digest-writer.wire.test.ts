/**
 * The portfolio digest's model call as it goes over the wire: the HTTP body
 * the OpenAI client sends, and what the run keeps about the call (its
 * request record and its thread), from a fixed snapshot. Kept as a golden
 * file, written from today's direct call before the digest moves onto the
 * agent runner: the move must send the same body. `UPDATE_WIRE=1` rewrites it.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { writeDigestNarrative } from "./digest-writer";

const GOLDEN = join(__dirname, "__fixtures__", "portfolio-digest.wire.json");

/** A reply that is the digest. */
const REPLY = {
  id: "chatcmpl_wire",
  object: "chat.completion",
  created: 1_763_000_000,
  model: "gpt-5.4",
  choices: [{ index: 0, message: { role: "assistant", content: "The account rose today.", refusal: null }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

let sent: Array<{ url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENAI_API_KEY = "sk-wire-test";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(REPLY), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  sent = [];
});

it("sends the same body and keeps the same record of it", async () => {
  const out = await writeDigestNarrative(STANDIN_SNAPSHOT);
  expect(out.narrative).toBe("The account rose today.");
  const { startedAt: _s, endedAt: _e, ...request } = out.request as unknown as Record<string, unknown>;
  const wire = { calls: sent, kept: { request, thread: out.thread } };
  if (process.env.UPDATE_WIRE) writeFileSync(GOLDEN, JSON.stringify(wire, null, 1) + "\n");
  expect(wire).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});
