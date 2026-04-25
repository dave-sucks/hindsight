// Trading-day helpers — Phase 1 today-scoping foundation.
//
// Every Signal and AnalystSignalRoute carries a `tradingDay` (Date, no time).
// Consumers (router, brief, read_signals) default-filter on this so today's
// run never sees yesterday's signal residue.
//
// We delegate the actual "what's today in ET" computation to
// lib/market-hours.ts:etTradingDayDate so there's one source of truth across
// the brief, the router, EOD snapshots, etc.

export { etTradingDayDate as currentTradingDay } from "@/lib/market-hours";
import { etTradingDayDate } from "@/lib/market-hours";

/**
 * Returns the trading day for an arbitrary timestamp (ET calendar date,
 * materialized as UTC midnight). Used by backfills and for tagging signals
 * with the correct day even if the producer ran late.
 */
export function tradingDayFor(ts: Date): Date {
  return etTradingDayDate(ts);
}

/**
 * How long signals of each type stay actionable. Matches the migration
 * backfill defaults — keep in sync with prisma migration phase1_today_scoping.
 */
const FRESHNESS_WINDOW_HOURS: Record<string, number> = {
  NEWS: 24,
  EARNINGS: 72,
  FILING: 72,
  MACRO: 24,
  SECTOR: 48,
  SOCIAL: 12,
  PRICE_ACTION: 4,
  OPTIONS: 8,
  ANALYST_NOTE: 48,
};

export function freshnessWindowForType(type: string): number {
  return FRESHNESS_WINDOW_HOURS[type] ?? 24;
}
