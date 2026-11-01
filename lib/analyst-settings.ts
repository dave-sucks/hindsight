/**
 * An analyst is saved one way. A new one starts from NEW_ANALYST_DEFAULTS,
 * and Create, the editor's Apply and Settings all send their change through
 * normalizeAnalystPatch, so no door can store a value another would refuse.
 *
 * Pure and safe in the browser: the panel and the card read the defaults.
 */
import { normalizeSectors } from "@/lib/universe/canonical";
import { isNamedSetup } from "@/lib/agent/knowledge/setups";
import { boundRiskPct, DEFAULT_RISK_PCT } from "@/lib/agent/position-sizing";

/** A new analyst's numbers. Change them here. */
export const NEW_ANALYST_NUMBERS = { minPositionSize: 3000, maxPositionSize: 8000, minConfidence: 60, maxOpenPositions: 5 };

export const NEW_ANALYST_DEFAULTS = {
  ...NEW_ANALYST_NUMBERS,
  directionBias: "LONG" as const,
  holdDurations: ["SWING"] as Array<"DAY" | "SWING" | "POSITION">,
  /** 0 = twice the largest trade, read live, so raising the largest raises it too. */
  maxPositionTotal: 0,
  riskPct: DEFAULT_RISK_PCT,
  tradingEnvironment: "PAPER" as const,
  runDaysOfWeek: [1, 2, 3, 4, 5],
  emailAlerts: true,
};

/** The smallest a largest trade can be (suggest_config's own bound). */
export const MIN_LARGEST_TRADE = 100;

/** A market cap at or above this is the model's "no bound" sentinel. */
const CAP_SENTINEL = 5e12;

/** Tickers as stored: no "$" or spaces, upper case, each once. */
export function normalizeTickers(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const symbols = list.map((t) => {
    const raw = t && typeof t === "object" ? (t as { symbol?: unknown }).symbol : t;
    return String(raw ?? "").replace(/[\s$]/g, "").toUpperCase();
  });
  return Array.from(new Set(symbols.filter(Boolean)));
}

/**
 * What a proposal adds to the watchlist: its names, cleaned and each once,
 * less what the analyst already holds or watches. Create, Apply and the
 * editor's change list all use it, so what the list shows is what is saved.
 */
export function watchlistAdds(proposed: unknown, heldOrWatched: string[]): string[] {
  const have = new Set(heldOrWatched);
  return normalizeTickers(proposed).filter((s) => !have.has(s));
}

/** Each proposed name's reason, by its cleaned ticker (the first one given wins). */
export function watchlistReasons(proposed: unknown): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const item of Array.isArray(proposed) ? proposed : []) {
    const [symbol] = normalizeTickers([item]);
    const reason = item && typeof item === "object" ? (item as { reason?: unknown }).reason : undefined;
    if (symbol && !reasons.has(symbol) && typeof reason === "string" && reason.trim()) reasons.set(symbol, reason);
  }
  return reasons;
}

/** The stored values a change is checked against. */
export interface StoredAnalyst {
  name?: string | null;
  analystPrompt?: string | null;
  minPositionSize?: unknown;
  maxPositionSize?: unknown;
  maxPositionTotal?: unknown;
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A market-cap bound: undefined keeps it; null, 0, a negative or the sentinel clears it. */
function capBound(v: unknown): bigint | null | undefined {
  if (v === undefined) return undefined;
  const n = num(v);
  return n == null || n <= 0 || n >= CAP_SENTINEL ? null : BigInt(Math.round(n));
}

/**
 * The three money settings, kept in order: smallest ≤ largest, largest at
 * least $100, most in one stock 0 or at least the largest. When two
 * disagree, the one just changed stands and the other moves to fit it.
 */
function moneyFields(stored: StoredAnalyst, patch: Record<string, unknown>): Record<string, number> {
  const was = { min: num(stored.minPositionSize) ?? 0, max: num(stored.maxPositionSize) ?? 0, total: num(stored.maxPositionTotal) ?? 0 };
  // A value no column can hold is not sent: a largest trade under $100 (a
  // fat-fingered 0 would make every buy $100), a negative smallest or total.
  const atLeast = (v: number | undefined, floor: number) => (v !== undefined && v >= floor ? v : undefined);
  const sent = {
    min: atLeast(num(patch.minPositionSize), 0),
    max: atLeast(num(patch.maxPositionSize), MIN_LARGEST_TRADE),
    total: atLeast(num(patch.maxPositionTotal), 0),
  };
  if (sent.min === undefined && sent.max === undefined && sent.total === undefined) return {};
  const changed = (k: keyof typeof was) => sent[k] !== undefined && sent[k] !== was[k];

  let min = sent.min ?? was.min;
  let max = sent.max ?? was.max;
  let total = sent.total ?? was.total;
  if (changed("min") && !changed("max") && min > max) max = min;
  if (changed("total") && !changed("max") && total > 0 && total < max) max = total;
  max = Math.max(MIN_LARGEST_TRADE, max);
  min = Math.min(min, max);
  if (total > 0 && total < max) total = max;

  const out: Record<string, number> = {};
  if (sent.min !== undefined || min !== was.min) out.minPositionSize = min;
  if (sent.max !== undefined || max !== was.max) out.maxPositionSize = max;
  if (sent.total !== undefined || total !== was.total) out.maxPositionTotal = total;
  return out;
}

/**
 * One change to an analyst, as the columns to write. A field left undefined
 * keeps its value; null clears a market-cap bound. A value the column can't
 * hold is dropped, not refused, and the rest of the change lands.
 */
export function normalizeAnalystPatch(stored: StoredAnalyst, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => patch[k] !== undefined;

  if (text(patch.name)) out.name = text(patch.name);
  if (has("description")) out.description = typeof patch.description === "string" ? patch.description : "";
  // An empty strategy keeps the stored one.
  if (text(patch.analystPrompt)) out.analystPrompt = patch.analystPrompt;
  if (["LONG", "SHORT", "BOTH"].includes(patch.directionBias as string)) out.directionBias = patch.directionBias;
  if (Array.isArray(patch.holdDurations)) {
    const holds = Array.from(new Set(patch.holdDurations.filter((h) => h === "DAY" || h === "SWING" || h === "POSITION")));
    if (holds.length) out.holdDurations = holds;
  }
  if (Array.isArray(patch.setupIds)) {
    out.setupIds = Array.from(new Set(patch.setupIds.filter((v): v is string => typeof v === "string" && isNamedSetup(v))));
  }

  if (Array.isArray(patch.sectors)) out.sectors = normalizeSectors(patch.sectors as string[]);
  for (const k of ["marketCapMin", "marketCapMax"] as const) {
    const bound = capBound(patch[k]);
    if (bound !== undefined) out[k] = bound;
  }
  if (Array.isArray(patch.exclusionList)) out.exclusionList = normalizeTickers(patch.exclusionList);

  const confidence = num(patch.minConfidence);
  if (confidence !== undefined) out.minConfidence = Math.min(100, Math.max(0, Math.round(confidence)));
  const slots = num(patch.maxOpenPositions);
  if (slots !== undefined) out.maxOpenPositions = Math.min(20, Math.max(1, Math.round(slots)));
  Object.assign(out, moneyFields(stored, patch));
  if (has("riskPct")) out.riskPct = boundRiskPct(patch.riskPct);

  if (Array.isArray(patch.runDaysOfWeek)) {
    // ISO weekdays, Mon–Fri. Empty is allowed: the cron reads it as every weekday.
    const days = patch.runDaysOfWeek.map((d) => Math.trunc(Number(d))).filter((d) => d >= 1 && d <= 5);
    out.runDaysOfWeek = Array.from(new Set(days)).sort((a, b) => a - b);
  }
  if (typeof patch.emailAlerts === "boolean") out.emailAlerts = patch.emailAlerts;
  return out;
}
