/**
 * The stock table: every stock we hold and watch, one row each, the same
 * columns for every reader. The morning run gets its analyst's stocks
 * (get_theses), the Portfolio Manager the account's (the `stock_table` fact),
 * and the app draws the same rows column for column
 * (components/domain/stock-table.tsx). Pure: no database, safe in the browser.
 */
import { minutesIntoSession, sessionProgress } from "@/lib/market-hours";

export interface StockTableRow {
  /** The thesis, so the screen can open the stock; not a column. */
  id?: string;
  ticker: string;
  /** held, watch or promoted. */
  status: string;
  /** The stock's analyst; null on one analyst's own read. */
  analyst: string | null;
  /** The situations the stock is in, lead first, each as its one wording: the trigger that raised it, or the name of the check that did (`situationLabels`). */
  situations: string[];
  price: number | null;
  /** The price against the close of the session before it, in %. */
  dayPct: number | null;
  /** Volume so far ÷ the normal volume by this time of day (the note says how far in); after the close, the day's ÷ its 20-session average. */
  volume: number | null;
  move5dPct: number | null;
  move20dPct: number | null;
  /** The stock's month against the S&P's, in points. */
  vsSpy1M: number | null;
  /** The price against its 50-day average, in %. */
  vs50dPct: number | null;
  /** The price against its 52-week high, in %. */
  offHighPct: number | null;
  /** A holding's price against what we paid, in %. */
  sinceBuyPct: number | null;
  /** The analyst's outlook: bullish, neutral or bearish; "not rated" on a stock with a view and no outlook yet. */
  outlook: string | null;
  conviction: string | null;
  /** The next earnings report, YYYY-MM-DD, when it is within the calendar's reach. */
  nextReport: string | null;
  /** A trade on it that waits for the owner: "sell 300". */
  waiting: string | null;
}

export interface StockTable {
  /** When the newest price printed (ISO): the session Day and Volume are of. */
  asOf: string | null;
  rows: StockTableRow[];
}

export type StockColumnKind = "text" | "money" | "pct" | "times";

export interface StockColumn {
  key: keyof StockTableRow;
  label: string;
  kind: StockColumnKind;
}

/** The columns, in order. Analyst is left off one analyst's own read (`columnsOf`). */
export const STOCK_TABLE_COLUMNS: readonly StockColumn[] = [
  { key: "ticker", label: "Stock", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "analyst", label: "Analyst", kind: "text" },
  { key: "situations", label: "Situation", kind: "text" },
  { key: "price", label: "Price", kind: "money" },
  { key: "dayPct", label: "Day", kind: "pct" },
  { key: "volume", label: "Volume", kind: "times" },
  { key: "move5dPct", label: "5-day", kind: "pct" },
  { key: "move20dPct", label: "1-month", kind: "pct" },
  { key: "vsSpy1M", label: "vs S&P, 1-month", kind: "pct" },
  { key: "vs50dPct", label: "vs 50-day", kind: "pct" },
  { key: "offHighPct", label: "Off 52w high", kind: "pct" },
  { key: "sinceBuyPct", label: "Since buy", kind: "pct" },
  { key: "outlook", label: "Outlook", kind: "text" },
  { key: "conviction", label: "Conviction", kind: "text" },
  { key: "nextReport", label: "Next report", kind: "text" },
  { key: "waiting", label: "Waiting for you", kind: "text" },
];

/** The columns a table shows: Analyst only when a row names one. */
export function columnsOf(table: StockTable): StockColumn[] {
  const named = table.rows.some((r) => r.analyst);
  return STOCK_TABLE_COLUMNS.filter((c) => c.key !== "analyst" || named);
}

const NONE = "—";

/** One cell as text: the same words for the agent and the screen. */
export function stockCell(row: StockTableRow, col: StockColumn): string {
  const v = row[col.key];
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return NONE;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string") return col.key === "conviction" || col.key === "outlook" ? v.toLowerCase() : v;
  switch (col.kind) {
    case "money":
      return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "pct":
      return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`;
    case "times":
      return `${v.toFixed(1)}x`;
    default:
      return String(v);
  }
}

/** Held stocks first, then the rest; each by the day's move, biggest rise first, a stock with no move last. */
export function sortStockRows(rows: StockTableRow[]): StockTableRow[] {
  const held = (r: StockTableRow) => (r.status === "held" ? 0 : 1);
  return [...rows].sort(
    (a, b) => held(a) - held(b) || (b.dayPct ?? -Infinity) - (a.dayPct ?? -Infinity) || a.ticker.localeCompare(b.ticker),
  );
}

const ET = { timeZone: "America/New_York" } as const;

/** "Thu, Nov 19, 4:00 PM ET". */
export function sessionStamp(asOf: string | null): string | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString("en-US", { ...ET, weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { ...ET, hour: "numeric", minute: "2-digit" })} ET`;
}

/**
 * What the columns are, said once above the rows. While the session the prices are of is still open,
 * Volume is a count so far against the normal by that time of day (`volumeRatio`), and the note says
 * how far in, in the words get_stock_data uses (`todayVolumeRead`).
 */
export function stockTableNote(table: StockTable): string {
  const at = sessionStamp(table.asOf);
  const progress = table.asOf && at ? sessionProgress(new Date(table.asOf)) : null;
  const soFar = progress && progress.minutes < progress.total ? progress : null;
  return [
    `Every stock we hold and watch, one row each: held stocks first, each group by the day's move.`,
    soFar
      ? `Prices as of ${at}, ${minutesIntoSession(soFar)}; Day and Volume are so far today, Volume against the normal volume by this time of day.`
      : `Prices${at ? ` as of ${at}` : ""}; Day and Volume are that session's, Volume against its 20-day normal.`,
    `Situation: why the stock is in front of its analyst now; ${NONE} is a quiet stock.`,
  ].join(" ");
}

/** The table as the agent reads it: the note, the column names, then a line a stock. */
export function stockTableLines(table: StockTable): string[] {
  const cols = columnsOf(table);
  return [stockTableNote(table), cols.map((c) => c.label).join(" | "), ...table.rows.map((r) => cols.map((c) => stockCell(r, c)).join(" | "))];
}
