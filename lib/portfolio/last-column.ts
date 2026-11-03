/**
 * What the coverage table's last column shows. On desktop it is the Lifetime
 * column and it is ALWAYS the lifetime gain. On a phone that one column is
 * the whole table, so a toggle picks which of the desktop's columns it shows:
 * 1D, 5D, 30D or Lifetime. The two
 * are decided here, apart, so the phone's toggle can never reach the
 * desktop's column — on 2026-11-03 it did, and every desktop Lifetime cell
 * showed the day's move (V read −0.88% against a +14% holding).
 */

import { moveDollar } from "@/lib/portfolio/move-dollar";

export type LastColumnWindow = "1d" | "5d" | "30d" | "lifetime";

export type LastColumnRow = {
  sincePct: number | null;
  sinceDollar: number | null;
  oneDayPct: number | null;
  fiveDayPct: number | null;
  thirtyDayPct: number | null;
  shares: number | null;
  currentPrice: number | null;
  /** null = a watched or passed name: no shares, so a percent only. */
  tradeState: "OPEN" | "CLOSED" | null;
};

export type LastColumnGain = { pct: number | null; dollar: number | null };

/** The gain over one window: realized-or-unrealized for lifetime, the move on today's shares otherwise. */
export function gainOver(row: LastColumnRow, window: LastColumnWindow): LastColumnGain {
  if (window === "lifetime") {
    return { pct: row.sincePct, dollar: row.tradeState == null ? null : row.sinceDollar };
  }
  const pct = window === "5d" ? row.fiveDayPct : window === "30d" ? row.thirtyDayPct : row.oneDayPct;
  const dollar =
    row.tradeState == null ? null : moveDollar({ shares: row.shares, currentPrice: row.currentPrice, pct });
  return { pct, dollar };
}

/** Desktop is lifetime whatever the phone's toggle says; the phone is its toggle's window. */
export function lastColumn(row: LastColumnRow, phoneWindow: LastColumnWindow): { desktop: LastColumnGain; phone: LastColumnGain } {
  return { desktop: gainOver(row, "lifetime"), phone: gainOver(row, phoneWindow) };
}
