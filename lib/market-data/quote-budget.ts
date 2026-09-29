/**
 * Who gets a quote when a vendor's per-minute allowance runs low.
 *
 * One rule: the trigger check is never slowed or refused; chat, writers,
 * reviews and pages are. On 2026-09-15 the pages' quote polling spent the
 * shared key and ~29 stocks went unpriced on the 10:00 trigger pass — stops
 * included.
 *
 * Every vendor reply says how many calls the key has left this minute. The
 * vendor counts them, so the number is the same on every server instance —
 * which an in-memory counter here could never be. Once it falls to the
 * reserve, every caller but the trigger check is refused until the minute
 * turns over; they fall to the next source or say in words that the price is
 * unavailable. Before the first reply of a minute nothing is known and
 * nothing is refused.
 */

export type QuoteCaller = "trigger-check" | "other";

/** The share of each minute's calls only the trigger check may spend. */
export const RESERVED_SHARE = { alpaca: 0.2, finnhub: 0.75 } as const;

interface Allowance {
  limit: number;
  remaining: number;
  resetAtMs: number;
}

const seen = new Map<string, Allowance>();
const inFlight = new Map<string, number>();

const vendorOf = (bucket: string) => (bucket.startsWith("finnhub") ? "finnhub" : "alpaca");

/** Record what the vendor said is left. Headers: x-ratelimit-limit / -remaining / -reset (unix seconds). */
export function noteAllowance(
  bucket: string,
  headers: { get(name: string): string | null } | undefined,
  now = Date.now(),
): void {
  const num = (name: string) => {
    const v = Number(headers?.get?.(name));
    return Number.isFinite(v) ? v : null;
  };
  const limit = num("x-ratelimit-limit");
  const remaining = num("x-ratelimit-remaining");
  const reset = num("x-ratelimit-reset");
  if (limit == null || remaining == null || limit <= 0) return;
  seen.set(bucket, {
    limit,
    remaining,
    resetAtMs: reset != null && reset * 1000 > now ? reset * 1000 : now + 60_000,
  });
}

/** May this caller spend a call now? The trigger check always may. */
export function mayCall(bucket: string, caller: QuoteCaller, now = Date.now()): boolean {
  if (caller === "trigger-check") return true;
  const a = seen.get(bucket);
  if (!a || now >= a.resetAtMs) return true;
  const reserve = Math.ceil(a.limit * RESERVED_SHARE[vendorOf(bucket)]);
  return a.remaining - (inFlight.get(bucket) ?? 0) > reserve;
}

/** Run one vendor call, counted while it is in flight. Throws `QuoteHeldError` when the caller must yield. */
export async function withAllowance<T>(
  bucket: string,
  caller: QuoteCaller,
  call: () => Promise<T>,
): Promise<T> {
  if (!mayCall(bucket, caller)) throw new QuoteHeldError(bucket);
  inFlight.set(bucket, (inFlight.get(bucket) ?? 0) + 1);
  try {
    return await call();
  } finally {
    inFlight.set(bucket, Math.max(0, (inFlight.get(bucket) ?? 1) - 1));
  }
}

/** The allowance is down to the trigger check's share. Reads as rate-limited to `readPrice`. */
export class QuoteHeldError extends Error {
  constructor(bucket: string) {
    super(`${vendorOf(bucket)} quote held for the trigger check (rate limit reserve)`);
    this.name = "QuoteHeldError";
  }
}

/** Tests only. */
export function resetQuoteBudget(): void {
  seen.clear();
  inFlight.clear();
}
