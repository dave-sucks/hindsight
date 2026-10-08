/**
 * JSON that keeps its Dates, for the live-book fixture the measuring script
 * writes (scripts/measure-situations.ts) and the tests that replay it. A
 * Date is written as `{ "$date": "<ISO>" }`; an ISO string stays a string,
 * as a trigger's `lastFiredAt` is one.
 */
export function toFixtureJson(value: unknown): string {
  return JSON.stringify(
    value,
    function (this: Record<string, unknown>, key: string, v: unknown) {
      const raw = this[key];
      return raw instanceof Date ? { $date: raw.toISOString() } : v;
    },
    1,
  );
}

export function fromFixtureJson<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && typeof (v as { $date?: unknown }).$date === "string" && Object.keys(v).length === 1
      ? new Date((v as { $date: string }).$date)
      : v,
  ) as T;
}
