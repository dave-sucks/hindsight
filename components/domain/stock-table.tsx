"use client";

/**
 * StockTable: the stock table as an agent is given it (lib/agent/stock-table.ts),
 * column for column: the same columns, the same order and the same words in
 * every cell. A stock in a situation shows its badge; a stock's ticker opens
 * its sheet. Wider than its card on most screens: the table scrolls sideways
 * inside the card.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { columnsOf, stockCell, stockTableNote, type StockColumn, type StockTable as StockTableData, type StockTableRow } from "@/lib/agent/stock-table";

const isNumber = (col: StockColumn) => col.kind !== "text";

function Cell({ row, col, onOpen }: { row: StockTableRow; col: StockColumn; onOpen: (row: StockTableRow) => void }) {
  const value = row[col.key];
  if (col.key === "ticker")
    return row.id ? (
      <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => onOpen(row)}>
        {row.ticker}
      </button>
    ) : (
      <span className="font-medium">{row.ticker}</span>
    );
  if (col.key === "situations" && row.situations.length)
    return (
      <span className="flex gap-1">
        {row.situations.map((name) => (
          <Badge key={name} variant="secondary">
            {name}
          </Badge>
        ))}
      </span>
    );
  const empty = value == null || (Array.isArray(value) && value.length === 0);
  if (!isNumber(col)) return <span className={empty ? "text-muted-foreground" : undefined}>{stockCell(row, col)}</span>;
  const tone = empty ? "text-muted-foreground" : col.kind === "pct" && typeof value === "number" ? (value > 0 ? "text-positive" : value < 0 ? "text-negative" : "") : "";
  return <div className={`text-right tabular-nums ${tone}`}>{stockCell(row, col)}</div>;
}

export function StockTable({ table }: { table: StockTableData }) {
  const [open, setOpen] = useState<StockTableRow | null>(null);
  const cols = columnsOf(table);
  if (table.rows.length === 0) return <p className="text-sm text-muted-foreground">No stocks held or watched.</p>;
  return (
    <>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => (
                  <TableHead key={c.key}>{isNumber(c) ? <div className="text-right">{c.label}</div> : c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => (
                <TableRow key={row.id ?? `${row.ticker}:${row.analyst ?? ""}`}>
                  {cols.map((c) => (
                    <TableCell key={c.key}>
                      <Cell row={row} col={c} onOpen={setOpen} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <CardContent>
          <p className="text-xs text-muted-foreground">{stockTableNote(table)}</p>
        </CardContent>
      </Card>
      {open?.id ? <ThesisSheet open onOpenChange={(o) => !o && setOpen(null)} thesis_id={open.id} ticker={open.ticker} direction={null} /> : null}
    </>
  );
}
