"use client";

/**
 * StockTable: the stock table as an agent is given it (lib/agent/stock-table.ts),
 * column for column: the same columns, the same order and the same words in
 * every cell. A stock in a situation shows its badge.
 */
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { columnsOf, stockCell, stockTableNote, type StockColumn, type StockTable as StockTableData, type StockTableRow } from "@/lib/agent/stock-table";

function Cell({ row, col }: { row: StockTableRow; col: StockColumn }) {
  const value = row[col.key];
  if (col.key === "situations")
    return row.situations.length ? (
      <span className="flex flex-wrap gap-1">
        {row.situations.map((name) => (
          <Badge key={name} variant="secondary">
            {name}
          </Badge>
        ))}
      </span>
    ) : (
      <span className="text-muted-foreground">{stockCell(row, col)}</span>
    );
  if (col.key === "ticker") return <span className="font-medium">{row.ticker}</span>;
  if (col.kind === "text") return <span className={value == null ? "text-muted-foreground" : undefined}>{stockCell(row, col)}</span>;
  const tone = col.kind !== "pct" || typeof value !== "number" ? (value == null ? "text-muted-foreground" : "") : value > 0 ? "text-positive" : value < 0 ? "text-negative" : "";
  return <span className={`tabular-nums ${tone}`}>{stockCell(row, col)}</span>;
}

export function StockTable({ table }: { table: StockTableData }) {
  const cols = columnsOf(table);
  if (table.rows.length === 0) return <p className="text-sm text-muted-foreground">No stocks held or watched.</p>;
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.key}>{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row) => (
            <TableRow key={`${row.ticker}:${row.analyst ?? ""}`}>
              {cols.map((c) => (
                <TableCell key={c.key}>
                  <Cell row={row} col={c} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-6 text-xs text-muted-foreground">{stockTableNote(table)}</p>
    </Card>
  );
}
