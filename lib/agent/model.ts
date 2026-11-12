/**
 * model.ts — the one place an agent gets its model.
 *
 * The provider is built with a fetch that keeps the call's first request on
 * its run, exactly as it went over the wire (run-requests.ts), and passes
 * every request through untouched. The run page's Context panel shows it. A
 * call of many steps keeps only its first request: each later step adds to a
 * conversation the run's thread already holds.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { saveRequestRecord } from "@/lib/agent/run-requests";

export interface ModelUse {
  /** The run that keeps the request. With none, nothing is kept. */
  runId?: string | null;
  /** Which call of the run ("Main", "Retry"). */
  call: string;
  /** The code that makes it. */
  source: string;
  /** OpenAI's Chat Completions API instead of Responses. A claude-* model always goes to Anthropic. */
  api?: "chat" | "responses";
  /** The run keeps only the newest record of this call (a chat keeps one, not one per message). */
  replace?: boolean;
}

/** The model for `modelId`, the same one each call site built before, keeping its call's first request on the run. */
export function modelFor(modelId: string, use: ModelUse): LanguageModel {
  let kept = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    let saving: Promise<void> | undefined;
    if (!kept && use.runId && typeof init?.body === "string") {
      kept = true;
      saving = keep(use.runId, modelId, use, init.body);
    }
    // The save runs beside the request and is done before the reply is handed back.
    const res = await globalThis.fetch(input, init);
    await saving;
    return res;
  };
  if (modelId.startsWith("claude")) return createAnthropic({ fetch })(modelId);
  const openai = createOpenAI({ fetch });
  return use.api === "chat" ? openai.chat(modelId) : openai(modelId);
}

/** Save the request on the run. saveRequestRecord logs a failed save and never throws. */
async function keep(runId: string, model: string, use: ModelUse, body: string): Promise<void> {
  let sent: unknown = body;
  try {
    sent = JSON.parse(body);
  } catch {
    // Not JSON: kept as the text it was.
  }
  const at = new Date().toISOString();
  await saveRequestRecord(runId, { v: 1, call: use.call, source: use.source, model, startedAt: at, endedAt: at, requests: [sent] }, { replace: use.replace });
}
