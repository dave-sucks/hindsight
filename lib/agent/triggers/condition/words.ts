/** Small helpers the measures' words share. Pure and client-safe. */

export function money(n: number): string {
  return `$${n % 1 === 0 ? n : n.toFixed(2)}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function days(n: number): string {
  return `${n} ${plural(n, "day", "days")}`;
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A whole number between lo and hi, inclusive. */
export function wholeIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

/** A finite number. */
/** A number as a refusal shows it: "0.5", "60", or what was sent instead. */
export function shown(v: unknown): string {
  return isNum(v) ? String(Math.round(v * 10000) / 10000) : v == null ? "nothing" : JSON.stringify(v);
}

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A number setting, or undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
