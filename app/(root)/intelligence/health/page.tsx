import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NoveltyHistogram, FunnelChart } from "@/components/intelligence/health-charts";

// Force dynamic — this is a live ops dashboard, never cache.
export const dynamic = "force-dynamic";

// ── Helpers ────────────────────────────────────────────────────────────────

function ageFromNow(d: Date | null | undefined): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 1) return `${Math.floor(ms / 60_000)}m ago`;
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Data loaders ───────────────────────────────────────────────────────────

async function loadDeadCrons() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return prisma.monitor.findMany({
    where: {
      enabled: true,
      OR: [{ lastRunAt: null }, { lastRunAt: { lt: cutoff } }],
    },
    select: { id: true, name: true, type: true, scope: true, lastRunAt: true },
    orderBy: [{ lastRunAt: "asc" }],
  });
}

async function loadSignalFunnel(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const analysts = await prisma.agentConfig.findMany({
    where: { userId, enabled: true },
    select: { id: true, name: true },
  });

  const out: { analyst: string; routed: number; read: number; cited: number }[] = [];

  for (const a of analysts) {
    const [routed, read] = await Promise.all([
      prisma.analystSignalRoute.count({
        where: { analystId: a.id, routedAt: { gte: since } },
      }),
      prisma.analystSignalRoute.count({
        where: {
          analystId: a.id,
          routedAt: { gte: since },
          status: { in: ["READ", "ACTED_ON"] },
        },
      }),
    ]);

    // Cited = theses in last 24h for this analyst whose sourceSignalIds
    // overlap the routes we emitted. sourceSignalIds is a Session 3 column —
    // defensive raw-SQL read so this page still renders if the column hasn't
    // been added yet. Counts theses whose array is non-empty; good enough as
    // a routing→citation funnel signal without resolving the specific overlap.
    let cited = 0;
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*)::bigint AS c
           FROM "Thesis" t
           JOIN "ResearchRun" r ON r."id" = t."researchRunId"
          WHERE r."agentConfigId" = $1
            AND t."createdAt" >= $2
            AND COALESCE(array_length(t."sourceSignalIds", 1), 0) > 0`,
        a.id,
        since,
      );
      cited = Number(rows?.[0]?.c ?? 0);
    } catch {
      cited = 0;
    }

    out.push({ analyst: a.name, routed, read, cited });
  }

  return out;
}

async function loadTickerConcentration() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // Unnest signal.tickers[] for signals attached to routes in the last 7d.
  const rows = await prisma.$queryRawUnsafe<Array<{ ticker: string; routes: bigint }>>(
    `SELECT t AS ticker, COUNT(*)::bigint AS routes
       FROM "AnalystSignalRoute" r
       JOIN "Signal" s ON s."id" = r."signalId"
       CROSS JOIN LATERAL unnest(s."tickers") AS t
      WHERE r."routedAt" >= $1
      GROUP BY t
      ORDER BY routes DESC
      LIMIT 20`,
    since,
  );
  return rows.map((r) => ({ ticker: r.ticker, routes: Number(r.routes) }));
}

async function loadNoveltyBuckets() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRawUnsafe<Array<{ bucket: string; c: bigint }>>(
    `SELECT
        CASE
          WHEN COALESCE("noveltyScore", 0) <= 20 THEN '0-20'
          WHEN COALESCE("noveltyScore", 0) <= 40 THEN '21-40'
          WHEN COALESCE("noveltyScore", 0) <= 60 THEN '41-60'
          WHEN COALESCE("noveltyScore", 0) <= 80 THEN '61-80'
          ELSE '81-100'
        END AS bucket,
        COUNT(*)::bigint AS c
      FROM "AnalystSignalRoute"
     WHERE "routedAt" >= $1
     GROUP BY bucket`,
    since,
  );
  const lookup = new Map(rows.map((r) => [r.bucket, Number(r.c)]));
  return ["0-20", "21-40", "41-60", "61-80", "81-100"].map((b) => ({
    bucket: b,
    count: lookup.get(b) ?? 0,
  }));
}

interface MonitorRoiRow {
  id: string;
  name: string;
  scope: string;
  tradesSourced: number | null;
  winsSourced: number | null;
  lossesSourced: number | null;
  successScore: number | null;
}

async function loadMonitorRoi(): Promise<MonitorRoiRow[]> {
  // Session 3 adds tradesSourced / winsSourced / lossesSourced / successScore
  // to Monitor. Read raw so this compiles + renders before Session 3 merges.
  // If any column is missing, Postgres throws and we show "no data yet".
  try {
    const rows = await prisma.$queryRawUnsafe<MonitorRoiRow[]>(
      `SELECT "id", "name", "scope",
              "tradesSourced", "winsSourced", "lossesSourced", "successScore"
         FROM "Monitor"
        WHERE "enabled" = true
        ORDER BY COALESCE("successScore", -1) DESC, "name" ASC
        LIMIT 50`,
    );
    return rows;
  } catch {
    return [];
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function IntelligenceHealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [deadCrons, funnel, tickers, novelty, monitorRoi] = await Promise.all([
    loadDeadCrons(),
    loadSignalFunnel(user.id),
    loadTickerConcentration(),
    loadNoveltyBuckets(),
    loadMonitorRoi(),
  ]);

  const hasMonitorRoi = monitorRoi.some(
    (m) => m.successScore != null || m.tradesSourced != null,
  );

  return (
    <div className="p-6 space-y-4">
      {/* Sub-nav — keeps /intelligence as the main view; Health is a sibling */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Intelligence Health</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline state, signal funnel, routing diagnostics.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/intelligence" />}>
          Back to Intelligence
        </Button>
      </div>

      {/* Panel 1 — Dead Crons */}
      <Card>
        <CardHeader>
          <CardTitle>Dead or stale monitors</CardTitle>
          <CardDescription>
            Enabled monitors with no run in the last 48h. If this list is
            long, a cron is probably broken.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deadCrons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No stale monitors — every enabled monitor ran in the last 48h.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deadCrons.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.type}</TableCell>
                    <TableCell>{m.scope}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {m.lastRunAt
                        ? new Date(m.lastRunAt).toLocaleString()
                        : "never"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {ageFromNow(m.lastRunAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Panel 2 — Signal Funnel */}
      <Card>
        <CardHeader>
          <CardTitle>Signal funnel — last 24h</CardTitle>
          <CardDescription>
            Per-analyst: signals routed → read → cited in theses. Big drop-off
            between routed and read means the analyst ignored the inbox;
            between read and cited means the evidence didn&apos;t make it into a
            thesis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnel.length === 0 || funnel.every((f) => f.routed === 0) ? (
            <p className="text-sm text-muted-foreground">
              No routed signals in the last 24h.
            </p>
          ) : (
            <FunnelChart data={funnel} />
          )}
        </CardContent>
      </Card>

      {/* Panel 3 — Ticker Concentration */}
      <Card>
        <CardHeader>
          <CardTitle>Ticker concentration — last 7d</CardTitle>
          <CardDescription>
            Top 20 tickers by route count. If the same 5 names dominate, the
            pipeline is surfacing the same tape every morning.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tickers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No routed signals in the last 7 days.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead className="text-right">Routes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickers.map((t) => (
                  <TableRow key={t.ticker}>
                    <TableCell className="font-medium">{t.ticker}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.routes}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Panel 4 — Monitor ROI (Session 3 dependency) */}
      <Card>
        <CardHeader>
          <CardTitle>Monitor ROI</CardTitle>
          <CardDescription>
            Which monitors surfaced the signals that ended up behind real
            trades. Sorted by success score. Depends on Session 3&apos;s Monitor
            success-score columns — shows &ldquo;no data yet&rdquo; until that ships.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasMonitorRoi ? (
            <p className="text-sm text-muted-foreground">
              No data yet — waiting on Monitor success-score columns.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monitor</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead className="text-right">Losses</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monitorRoi.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.scope}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m?.tradesSourced ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m?.winsSourced ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m?.lossesSourced ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m?.successScore != null
                        ? m.successScore.toFixed(2)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Panel 5 — Novelty histogram */}
      <Card>
        <CardHeader>
          <CardTitle>Route novelty distribution — last 24h</CardTitle>
          <CardDescription>
            Distribution of novelty scores across routed signals. A stack at
            0–20 means routing collapsed onto the same stale names; a healthy
            run spreads across all buckets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {novelty.every((n) => n.count === 0) ? (
            <p className="text-sm text-muted-foreground">
              No routed signals in the last 24h.
            </p>
          ) : (
            <NoveltyHistogram data={novelty} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
