/**
 * Recovering a chat answer after the browser's connection drops.
 *
 * A dropped connection does not stop the answer: Vercel only cancels a
 * function on disconnect when `supportsCancellation` is set, and it isn't, so
 * the agent route finishes and saves the whole thread (the `role: "thread"`
 * RunMessage). The browser just never hears the end of it. These two checks
 * decide when the chat should go fetch that saved thread, and whether the
 * thread it gets back is the answer to the question that was cut off.
 *
 * 2026-09-16: a principal chat showed Chrome's "network error" 13s in while
 * the server finished the answer at 58s and saved it.
 */

/**
 * The error text browsers give a fetch that lost its connection — before the
 * response (request failed) or partway through it (body cut off). Anything
 * else is the server or the model saying no, and there is no saved answer to
 * wait for.
 *
 *   Chrome  — "network error" (body cut off), "Failed to fetch"
 *   Safari  — "Load failed", "The network connection was lost."
 *   Firefox — "NetworkError when attempting to fetch resource.",
 *             "Error in body stream"
 */
const CONNECTION_ERROR = /network|failed to fetch|load failed|body stream/i;

export function isDroppedConnection(error: unknown): boolean {
  return typeof error === "string" && CONNECTION_ERROR.test(error);
}

/** Clock difference we tolerate between the browser and the server. */
const CLOCK_SLACK_MS = 2_000;

/**
 * True when the saved thread was written after the cut-off question was
 * sent — i.e. it holds that question's answer, not the previous turn's.
 * The thread is rewritten whole at the end of every turn, so its save time
 * is the turn's end time.
 *
 * `serverNow` and `clientNow` are read at the same moment and put the
 * browser's `sentAt` on the server's clock.
 */
export function isSavedAfterSend({
  savedAt,
  sentAt,
  serverNow,
  clientNow,
}: {
  savedAt: number | null;
  sentAt: number;
  serverNow: number;
  clientNow: number;
}): boolean {
  if (savedAt == null || sentAt <= 0) return false;
  const sentAtOnServer = sentAt + (serverNow - clientNow);
  return savedAt >= sentAtOnServer - CLOCK_SLACK_MS;
}
