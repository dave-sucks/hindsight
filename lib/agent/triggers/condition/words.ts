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

/** A number setting, or undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
