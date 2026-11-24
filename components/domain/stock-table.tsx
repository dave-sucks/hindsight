"use client";

/**
 * StockTable: the stock table as an agent is given it (lib/agent/stock-table.ts),
 * column for column: the same columns, the same order and the same words in
 * every cell. Drawn as the app's stock rows (logo, ticker, status, then the
 * stock's tag), with the numbers in columns beside them. A row opens the
 * stock's sheet. Wider than its card on most screens: the rows scroll sideways
 * inside it. The note that tells an agent how to read the columns is not drawn.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/StockLogo";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { getThesisStatusDisplay } from "@/lib/thesis-status";
import { columnsOf, stockCell, type StockColumn, type StockTable as StockTableData, type StockTableRow } from "@/lib/agent/stock-table";

/** Each column's width; the tag takes what is left. */
const WIDTH: Partial<Record<keyof StockTableRow, string>> = {
  ticker: "7rem",
  status: "7rem",
  analyst: "11rem",
  situations: "minmax(18rem, 1fr)",
  price: "6rem",
  vsSpy1M: "7.5rem",
  offHighPct: "7rem",
  nextReport: "7rem",
  waiting: "7rem",
  outlook: "5.5rem",
  conviction: "6rem",
};
const STATUS: Record<string, string> = { held: "HOLDING", watch: "WATCHING", promoted: "PROMOTED" };
const isNumber = (col: StockColumn) => col.kind !== "text";

function Cell({ row, col, opened }: { row: StockTableRow; col: StockColumn; opened: boolean }) {
  const value = row[col.key];
  if (col.key === "ticker")
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <StockLogo ticker={row.ticker} size="sm" />
        <span className="font-brand text-sm font-semibold">{row.ticker}</span>
      </span>
    );
  if (col.key === "status") {
    const status = getThesisStatusDisplay(STATUS[row.status] ?? row.status.toUpperCase());
    return (
      <span>
        <Badge variant="secondary">
          <span className={`size-1.5 shrink-0 rounded-full ${status.dotClass}`} />
          {status.label}
        </Badge>
      </span>
    );
  }
  if (col.key === "situations")
    return (
      <span className="flex min-w-0 items-center gap-3 text-xs">
        {row.situations.map((tag) => (
          <span key={tag} className="flex min-w-0 items-center gap-1.5">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
            <span className="truncate font-medium text-foreground">{tag}</span>
          </span>
        ))}
        {opened ? <Badge variant="outline">Opened</Badge> : null}
        {!row.situations.length && !opened ? <span className="text-muted-foreground">—</span> : null}
      </span>
    );
  const empty = value == null || (Array.isArray(value) && value.length === 0);
  if (!isNumber(col)) return <span className={`truncate text-xs ${empty ? "text-muted-foreground" : "text-foreground"}`}>{stockCell(row, col)}</span>;
  const tone = empty ? "text-muted-foreground" : col.kind === "pct" && typeof value === "number" ? (value > 0 ? "text-positive" : value < 0 ? "text-negative" : "") : "";
  return <span className={`text-right text-sm tabular-nums ${tone}`}>{stockCell(row, col)}</span>;
}

/** `opened`: the thesis ids the run went on to open by name, marked on their rows. */
export function StockTable({ table, opened }: { table: StockTableData; opened?: ReadonlySet<string> }) {
  const [open, setOpen] = useState<StockTableRow | null>(null);
  const cols = columnsOf(table);
  if (table.rows.length === 0) return <p className="text-sm text-muted-foreground">No stocks held or watched.</p>;
  const grid = { gridTemplateColumns: cols.map((c) => WIDTH[c.key] ?? "5rem").join(" ") };
  return (
    <>
      <div className="not-prose w-full overflow-x-auto rounded-xl border bg-card p-1">
        <div className="flex min-w-max flex-col gap-1">
          <div className="grid items-center gap-3 px-2 pb-1 pt-2" style={grid}>
            {cols.map((c) => (
              <span key={c.key} className={`text-xs font-medium uppercase tracking-wide text-muted-foreground ${isNumber(c) ? "text-right" : ""}`}>
                {c.label}
              </span>
            ))}
          </div>
          {table.rows.map((row) => (
            <div
              key={row.id ?? `${row.ticker}:${row.analyst ?? ""}`}
              role={row.id ? "button" : undefined}
              tabIndex={row.id ? 0 : undefined}
              onClick={row.id ? () => setOpen(row) : undefined}
              onKeyDown={
                row.id
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen(row);
                      }
                    }
                  : undefined
              }
              className={`grid items-center gap-3 rounded-md p-2 transition-colors ${row.id ? "cursor-pointer hover:bg-muted/70" : ""}`}
              style={grid}
            >
              {cols.map((c) => (
                <Cell key={c.key} row={row} col={c} opened={c.key === "situations" && row.id != null && (opened?.has(row.id) ?? false)} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {open?.id ? <ThesisSheet open onOpenChange={(o) => !o && setOpen(null)} thesis_id={open.id} ticker={open.ticker} direction={null} /> : null}
    </>
  );
}
