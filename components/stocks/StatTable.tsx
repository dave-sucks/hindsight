/**
 * The Financials tab's statistics: one plain table, a row per stat with its
 * number on the right, each section opened by a header row. The Overview's
 * key stats are the grid (StatGrid); this is the full set, read top to bottom.
 */

import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { StatSection } from "@/lib/stocks/stock-stats";

export function StatTable({ sections }: { sections: StatSection[] }) {
  return (
    <Table>
      {sections.map((section) => (
        <TableBody key={section.label}>
          <TableRow className="hover:bg-transparent">
            <TableHead colSpan={2} className="pt-4">
              {section.label}
            </TableHead>
          </TableRow>
          {section.columns.flat().map((s) => (
            <TableRow key={s.label}>
              <TableCell className="text-muted-foreground">{s.label}</TableCell>
              <TableCell className="text-right tabular-nums">{s.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  );
}
