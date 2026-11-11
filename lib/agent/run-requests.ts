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
 * ends or throws, and brought up to date if a step comes in after that (a
 * stream's error is reported before its failing step finishes). The first
 * request is kept against the run's call before it when that is smaller (a
 * chat's next turn resends the conversation). The stored shape is
 * run-requests-format.ts; the run page reads it through /api/runs/[id]/requests.
 *
 * Not kept: a request that never got its reply (the SDK hands over the body
 * with the reply). A call that throws says so in its record, with the error.
 */
import { prisma } from "@/lib/prisma";
import { decodeCalls, firstAgainst, isObj, parseRecord, RequestEncoder, refsFromStep, type RequestRecord, type SentRef, type SentStep } from "@/lib/agent/run-requests-format";

/** The RunMessage role of a model call's record. The saved thread is "thread". */
export const REQUEST_ROLE = "request";

/** No run started before this (midnight ET, Nov 11 2026) kept what it sent: the records began after it. */
export const REQUESTS_KEPT_SINCE = new Date("2026-11-11T05:00:00Z");

/** Why a call stopped, in words: a provider's error mid-stream arrives as a plain object with a message. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (isObj(error) && typeof error.message === "string" && error.message) return error.message;
  if (typeof error === "string") return error || "Error";
  return JSON.stringify(error) ?? "Error";
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
  /** Keep what was sent so far. A later save adds the steps that came after it; the first error stays. Never throws. */
  save(error?: unknown): Promise<void>;
}

/** The newest call the run has kept, and its last request: what this call's first request is kept against. */
async function lastSentOfRun(runId: string): Promise<{ id: string; body: unknown } | null> {
  const rows = await prisma.runMessage.findMany({ where: { runId, role: REQUEST_ROLE }, orderBy: { createdAt: "asc" }, select: { id: true, content: true } });
  const records = rows.flatMap((r) => {
    const record = parseRecord(r.content);
    return record ? [{ id: r.id, record }] : [];
  });
  const newest = records[records.length - 1];
  const bodies = newest && decodeCalls(records).get(newest.id);
  return bodies?.length ? { id: newest.id, body: bodies[bodies.length - 1] } : null;
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
  // The row, once written, and what it holds; the first error; the first step as kept (against the call before, or whole).
  let rowId: string | null = null;
  let keptSteps = 0;
  let keptError: string | undefined;
  let firstError: string | undefined;
  let first: { step: SentStep; after: string } | null = null;
  let saving: Promise<void> = Promise.resolve();

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

  async function write(error: unknown): Promise<void> {
    if (!runId) return;
    if (error !== undefined) firstError ??= describe(error);
    // Nothing new since the last write: no requests yet and no error, or the row already holds them all.
    if (rowId ? encoder.count === keptSteps && keptError === firstError : encoder.count === 0 && firstError === undefined) return;
    try {
      if (!rowId && encoder.count > 0) {
        const base = await lastSentOfRun(runId);
        const against = base ? firstAgainst(encoder.steps, encoder.list, base.body) : null;
        if (base && against) first = { step: against, after: base.id };
      }
      const record: RequestRecord = {
        v: 1,
        call,
        source,
        provider,
        model,
        list: encoder.list,
        startedAt,
        endedAt: new Date().toISOString(),
        steps: first ? [first.step, ...encoder.steps.slice(1)] : [...encoder.steps],
        ...(first ? { after: first.after } : {}),
        ...(Object.keys(refs).length > 0 ? { refs } : {}),
        ...(firstError !== undefined ? { error: firstError } : {}),
      };
      const content = JSON.stringify(record);
      const count = encoder.count;
      const error = firstError;
      if (rowId) await prisma.runMessage.update({ where: { id: rowId }, data: { content } });
      else rowId = (await prisma.runMessage.create({ data: { runId, role: REQUEST_ROLE, content }, select: { id: true } })).id;
      keptSteps = count;
      keptError = error;
      console.log(`[${source}] kept ${count} requests of "${call}" (${(content.length / 1024).toFixed(0)}KB${first ? ", after the call before" : ""}) for run ${runId}`);
    } catch (err) {
      console.error(`[${source}] failed to keep the requests of "${call}" for run ${runId}:`, err instanceof Error ? err.message : err);
    }
  }

  // One write at a time, in the order they were asked for.
  function save(error?: unknown): Promise<void> {
    saving = saving.then(() => write(error));
    return saving;
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
