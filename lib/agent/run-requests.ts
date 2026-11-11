/**
 * run-requests.ts — every model call in a run keeps exactly what it sent.
 *
 * The saved thread (run-thread.ts) is the conversation as the screen shows
 * it, with each tool result in its screen version. This is the model's side:
 * each request the call made, as the SDK sent it to the provider. Nothing
 * here is rebuilt or guessed; it is `step.request.body`, the same JSON that
 * went over the wire, kept step by step as each reply comes back.
 *
 * One RunMessage row per model call, role "request", written when the call
 * ends or throws. The stored shape is run-requests-format.ts; the run page
 * reads it through /api/runs/[id]/requests.
 *
 * Not kept: a request that never got its reply (the SDK hands over the body
 * with the reply). A call that throws says so in its record, with the error.
 */
import { prisma } from "@/lib/prisma";
import { RequestEncoder, refsFromStep, type RequestRecord, type SentRef } from "@/lib/agent/run-requests-format";

/** The RunMessage role of a model call's record. The saved thread is "thread". */
export const REQUEST_ROLE = "request";

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  return String(error) || "Error";
}

interface StepLike {
  request?: { body?: unknown };
  content?: unknown;
  model?: { provider?: string; modelId?: string };
}

export interface RequestRecorder {
  /** Hand every finished step here, from onStepFinish. */
  step(step: unknown): void;
  /** Await a model call and keep what it sent, whether it finished or threw. */
  around<T>(call: Promise<T>): Promise<T>;
  /** Keep what was sent so far. Once per call; a later save writes nothing. Never throws. */
  save(error?: unknown): Promise<void>;
}

/**
 * Start the record of one model call. `call` names it on the run page
 * ("Main", "Retry"); `source` is the code that made it. With no run id
 * (the builder, an unscoped chat) nothing is kept.
 */
export function recordRequests(runId: string | null | undefined, call: string, source: string): RequestRecorder {
  const startedAt = new Date().toISOString();
  const encoder = new RequestEncoder();
  const refs: Record<string, SentRef> = {};
  let provider: string | null = null;
  let model: string | null = null;
  let saved = false;

  function step(raw: unknown): void {
    try {
      const s = (raw ?? {}) as StepLike;
      provider ??= s.model?.provider ?? null;
      model ??= s.model?.modelId ?? null;
      encoder.push(s.request?.body);
      Object.assign(refs, refsFromStep(s.content, encoder.count));
    } catch (err) {
      console.warn(`[${source}] could not keep request ${encoder.count + 1} of run ${runId}:`, err instanceof Error ? err.message : err);
    }
  }

  async function save(error?: unknown): Promise<void> {
    if (saved || !runId) return;
    if (encoder.count === 0 && error === undefined) return;
    saved = true;
    try {
      const record: RequestRecord = {
        v: 1,
        call,
        source,
        provider,
        model,
        list: encoder.list,
        startedAt,
        endedAt: new Date().toISOString(),
        steps: encoder.steps,
        ...(Object.keys(refs).length > 0 ? { refs } : {}),
        ...(error !== undefined ? { error: describe(error) } : {}),
      };
      const content = JSON.stringify(record);
      await prisma.runMessage.create({ data: { runId, role: REQUEST_ROLE, content } });
      console.log(`[${source}] kept ${encoder.count} requests of "${call}" (${(content.length / 1024).toFixed(0)}KB) for run ${runId}`);
    } catch (err) {
      console.error(`[${source}] failed to keep the requests of "${call}" for run ${runId}:`, err instanceof Error ? err.message : err);
    }
  }

  async function around<T>(callPromise: Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await callPromise;
    } catch (err) {
      await save(err);
      throw err;
    }
    await save();
    return result;
  }

  return { step, around, save };
}
