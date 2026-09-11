/**
 * SetupScorecard — the per-setup table on /performance (DAV-248).
 *
 * One row per buy pattern × horizon × analyst: trades, win rate, average R
 * (gain in units of the risk taken at entry), average hold, average
 * give-back from the peak, and how often that setup's sell proposals were
 * declined or left to expire. Rows come from lib/performance — the same
 * numbers the writer and discovery prompts read as data lines.
 *
 * ShadCN Card and Table as-is; classes only on plain elements inside.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SetupRow } from "@/lib/performance/setup-scorecard";

function Num({ value, tone }: { value: string; tone?: "pos" | "neg" | null }) {
  return (
    <span
      className={
        "tabular-nums " +
        (tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-red-500" : "")
      }
    >
      {value}
    </span>
  );
}

export function SetupScorecard({ rows }: { rows: SetupRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-lg font-medium">Scorecard by setup</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No closed trades since 2026-05-27 to score yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setup</TableHead>
                  <TableHead>Horizon</TableHead>
                  <TableHead>Analyst</TableHead>
                  <TableHead>
                    <span className="block text-right">Trades</span>
                  </TableHead>
                  <TableHead>
                    <span className="block text-right">Win</span>
                  </TableHead>
                  <TableHead>
                    <span className="block text-right">Avg R</span>
                  </TableHead>
                  <TableHead>
                    <span className="block text-right">Avg hold</span>
                  </TableHead>
                  <TableHead>
                    <span className="block text-right">Given back</span>
                  </TableHead>
                  <TableHead>
                    <span className="block text-right">Sells declined</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.setupId}|${r.horizon}|${r.analyst}|${r.environment}`}>
                    <TableCell>
                      <span className="text-sm">{r.setupName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{r.horizon}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{r.analyst}</span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-right">
                        <Num value={String(r.trades)} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-right">
                        <Num value={r.trades ? `${r.winRatePct}%` : "—"} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-right">
                        <Num
                          value={r.avgR != null ? `${r.avgR >= 0 ? "+" : ""}${r.avgR.toFixed(2)}R` : "—"}
                          tone={r.avgR == null ? null : r.avgR >= 0 ? "pos" : "neg"}
                        />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-right">
                        <Num value={r.trades ? `${r.avgHoldDays}d` : "—"} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-right">
                        <Num value={r.avgGiveBackPts != null ? `${r.avgGiveBackPts.toFixed(1)} pts` : "—"} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-right">
                        <Num
                          value={
                            r.declineRatePct != null
                              ? `${r.sellDeclined}/${r.sellProposals} (${r.declineRatePct}%)`
                              : "—"
                          }
                        />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="pt-3 text-xs text-muted-foreground">
          R is the gain divided by the risk taken at entry (entry − the stop the trade opened with).
          Given back is the peak gain minus the gain at the sale. Trades before 2026-05-27 are left out.
        </p>
      </CardContent>
    </Card>
  );
}
