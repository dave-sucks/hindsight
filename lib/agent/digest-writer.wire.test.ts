/**
 * The portfolio digest's model call as it goes over the wire: the HTTP body
 * its run sends, and what the run keeps about the call, from a fixed
 * snapshot. Kept as a golden file. `UPDATE_WIRE=1` rewrites it.
 *
 * Written first from the direct OpenAI call, then rewritten when the digest
 * moved onto the agent runner. The text the model reads is the same; the
 * body differs from the direct call in two places:
 *   1. The instructions go as role "developer", not "system": the AI SDK's
 *      role for a gpt-5 model, and what every agent on the runner sends.
 *   2. `prompt_cache_key` is the run's id, as on every run on the runner.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";

const saved: string[] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: { runMessage: { create: async ({ data }: { data: { content: string } }) => void saved.push(data.content), deleteMany: async () => ({}) } },
}));

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
  saved.length = 0;
});

/** What the run keeps about the call, without the clock. */
const keptOf = (content: string) => {
  const { startedAt: _s, endedAt: _e, ...rest } = JSON.parse(content) as Record<string, unknown>;
  return rest;
};

it("sends the same body and keeps the same record of it", async () => {
  const out = await writeDigestNarrative(STANDIN_SNAPSHOT, "run_digest_wire");
  expect(out.narrative).toBe("The account rose today.");
  const wire = { calls: sent, kept: saved.map(keptOf) };
  if (process.env.UPDATE_WIRE) writeFileSync(GOLDEN, JSON.stringify(wire, null, 1) + "\n");
  expect(wire).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});
