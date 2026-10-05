/**
 * The thesis-writers a chat message dispatched, read out of its tool results.
 *
 * Its own plain module for two reasons: both the renderer and the table need
 * it, and this project's jest setup does not parse JSX, so a collector that
 * lives in a .tsx cannot be tested.
 *
 * It reads results written BEFORE the writing table existed, which is the
 * point. A replayed chat renders the result that was stored, and those rows
 * still carry everything a row needs.
 */

export interface DispatchedWriter {
  childRunId: string;
  ticker: string;
  analystName: string;
  /** mint | refresh | promotion-refresh — what the writer was asked for. */
  mode: string;
}

export function collectDispatched(
  parts: ReadonlyArray<Record<string, unknown>>,
): DispatchedWriter[] {
  const out: DispatchedWriter[] = [];
  for (const p of parts) {
    const res = (p.result ?? p.output) as { data?: Record<string, unknown> } | undefined;
    const d = res?.data;
    if (!d) continue;
    const childRunId = d.childRunId;
    const ticker = d.ticker;
    // A refused dispatch carries childRunId: null — there is no run to watch.
    if (typeof childRunId !== "string" || typeof ticker !== "string") continue;
    out.push({
      childRunId,
      ticker,
      analystName: typeof d.analystName === "string" ? d.analystName : "an analyst",
      mode: typeof d.mode === "string" ? d.mode : "mint",
    });
  }
  return out;
}
