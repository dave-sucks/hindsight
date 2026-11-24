/**
 * A run that something real asked for (a filled buy, a fired trigger) and
 * that failed: the same event is sent again five minutes later, up to three
 * tries in all, then the owner is told. A try whose work got done is never
 * repeated. Each function says what is left (`left`) and how to tell (`tell`).
 */

/** Tries one event gets, the first included. */
export const RUN_TRIES = 3;

export type Left = "done" | "retry" | "tell";

/** What a retried event carries. */
export interface Retried {
  /** How many times this event has been sent again. */
  recoveryTry?: number;
  /** When the first try started. */
  firstTriedAt?: string;
}

interface RetryStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, time: string): Promise<unknown>;
  sendEvent(id: string, event: { name: string; data: unknown }): Promise<unknown>;
}

/** The failure handler: `original` is the failed run's own event (`event.data.event`). */
export async function retryThenTell<D extends object>(
  original: { name: string; data: D & Retried; ts?: number },
  step: RetryStep,
  check: { left: (data: D, triedAt: Date) => Promise<Left>; tell: (data: D) => Promise<void> },
): Promise<{ next: Left }> {
  const triedAt = new Date(original.ts ?? 0);
  let next = await step.run("what-is-left", () => check.left(original.data, triedAt));
  const tries = original.data.recoveryTry ?? 0;
  if (next === "retry" && tries + 1 >= RUN_TRIES) next = "tell";
  if (next === "retry") {
    await step.sleep("wait-before-retry", "5m");
    await step.sendEvent("try-again", {
      name: original.name,
      data: { ...original.data, recoveryTry: tries + 1, firstTriedAt: original.data.firstTriedAt ?? triedAt.toISOString() },
    });
  }
  if (next === "tell") await step.run("tell-owner", () => check.tell(original.data));
  return { next };
}
