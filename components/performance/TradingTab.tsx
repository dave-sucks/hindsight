"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { AnalystFilter, Empty, Loading, Section, SimpleTable, Tiles, chartSize, useLoad, type Tile } from "@/components/performance/parts";
import { formatSignedCurrency } from "@/lib/format";
import type { Trading, TradingRange } from "@/lib/performance/trading";

const RANGES: Array<[TradingRange, string]> = [["30", "30D"], ["90", "90D"], ["all", "All"]];
const PNL_CHART = { cumulative: { label: "Realized, running total", color: "var(--positive)" } } satisfies ChartConfig;
const BUCKET_CHART = { n: { label: "Trades", color: "var(--muted-foreground)" } } satisfies ChartConfig;
const PEAK_CHART = { best: { label: "Best while held", color: "var(--muted-foreground)" }, exit: { label: "Where it closed", color: "var(--positive)" } } satisfies ChartConfig;

const pct = (x: number | null, signed = true) => (x == null ? "—" : `${signed && x > 0 ? "+" : ""}${x.toFixed(1)}%`);
const signed = (x: number | null) => <span className={`tabular-nums ${x == null ? "" : x > 0 ? "text-positive" : x < 0 ? "text-negative" : ""}`}>{x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}%`}</span>;
const money = (x: number | null) => (x == null ? "—" : <span className={`tabular-nums ${x > 0 ? "text-positive" : x < 0 ? "text-negative" : ""}`}>{formatSignedCurrency(x)}</span>);
const r = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}R`);
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function TradingTab() {
  const [range, setRange] = useState<TradingRange>("90");
  const [analyst, setAnalyst] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ id: string; ticker: string } | null>(null);
  const q = new URLSearchParams({ range, ...(analyst ? { analyst } : {}) });
  const { data, error, retry } = useLoad<Trading>(`/api/performance/trading?${q}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Closed trades on your {data ? (data.environment === "LIVE" ? "live" : "paper") : ""} book, realized. Your account&apos;s return, net of deposits, is on the Dashboard.
        </p>
        <div className="flex items-center gap-2">
          <Tabs value={range} onValueChange={(v) => setRange(v as TradingRange)}>
            <TabsList size="sm">{RANGES.map(([v, label]) => <TabsTrigger key={v} value={v}>{label}</TabsTrigger>)}</TabsList>
          </Tabs>
          <AnalystFilter analysts={data?.analysts} value={analyst} onChange={setAnalyst} />
        </div>
      </div>
      {!data ? <Loading error={error} what="trading numbers" onRetry={retry} /> : <Body t={data} open={(id, ticker) => setSheet({ id, ticker })} />}
      {sheet && <ThesisSheet open onOpenChange={(o) => !o && setSheet(null)} thesis_id={sheet.id} ticker={sheet.ticker} direction={null} />}
    </div>
  );
}

function Body({ t, open }: { t: Trading; open: (thesisId: string, ticker: string) => void }) {
  const s = t.summary;
  if (!s.trades) return <Empty>No trades closed in this range.</Empty>;
  const tiles: Tile[] = [
    { label: "Realized P&L", value: s.realizedPnl ? formatSignedCurrency(s.realizedPnl) : "$0", tone: s.realizedPnl > 0 ? "positive" : s.realizedPnl < 0 ? "negative" : undefined,
      sub: `${s.pricedTrades} closed trades${s.trimmedTrades ? `, ${s.trimmedTrades} trimmed first (closing leg only)` : ""}` },
    { label: "Win rate", value: `${s.winRatePct}%`, sub: `${s.wins} won, ${s.losses} lost` },
    { label: "Win vs loss size", value: s.avgWinPct != null && s.avgLossPct ? `${(s.avgWinPct / -s.avgLossPct).toFixed(1)}×` : "—", sub: `average win ${pct(s.avgWinPct)}, average loss ${pct(s.avgLossPct)}` },
    { label: "Profit factor", value: s.profitFactor == null ? "—" : s.profitFactor.toFixed(2), sub: "dollars won per dollar lost" },
    { label: "Round trips", value: String(s.roundTrips), sub: "up 5% or more, then closed at a loss" },
    { label: "Days held", value: String(s.avgHoldDays), sub: "on average" },
  ];
  const last = t.curve.at(-1)?.cumulative ?? 0;
  const pnlChart = { cumulative: { ...PNL_CHART.cumulative, color: last < 0 ? "var(--negative)" : "var(--positive)" } } satisfies ChartConfig;

  return (
    <div className="space-y-6">
      <Tiles tiles={tiles} />

      <Section title="Realized P&L over time" description="The running total of what closed trades made, by the day they closed. Only the closing leg of a trimmed trade is counted.">
        <ChartContainer config={pnlChart} style={chartSize(260)}>
          <AreaChart data={t.curve} margin={{ left: 8, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="fill-pnl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-cumulative)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="var(--color-cumulative)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} minTickGap={32} tickFormatter={shortDate} />
            <YAxis axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatSignedCurrency(v).replace(/\.\d\d$/, "")} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" labelFormatter={(d) => shortDate(String(d))}
              formatter={(v, _n, item) => `${formatSignedCurrency(Number(v))} (that day ${formatSignedCurrency(item.payload.realized)})`} />} />
            <Area dataKey="cumulative" type="stepAfter" fill="url(#fill-pnl)" stroke="var(--color-cumulative)" strokeWidth={2} />
          </AreaChart>
        </ChartContainer>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Each trade's result" description="How many trades closed in each band, by the gain or loss on what we paid.">
          <ChartContainer config={BUCKET_CHART} style={chartSize(240)}>
            <BarChart data={t.distribution} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={2} angle={-30} textAnchor="end" height={56} />
              <YAxis axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
              <Bar dataKey="n" radius={4}>
                {t.distribution.map((b) => <Cell key={b.label} fill={b.winning ? "var(--positive)" : "var(--negative)"} />)}
              </Bar>
            </BarChart>
          </ChartContainer>
        </Section>
        <Section title="How trades ended" description="Stop: a sale line fired. Target: the target was reached. Manual: sold by hand or by an analyst's call.">
          <SimpleTable head={["Ended by", ["Trades", "num"], ["Win rate", "num"], ["Avg result", "num"], ["Realized", "num"]]} empty="No trades in this range."
            rows={t.exits.map((e) => [e.reason, e.trades, `${e.winRatePct}%`, signed(e.avgGainPct), money(e.realizedPnl)])} />
        </Section>
      </div>

      <Section title="Best gain vs where it closed" description={`The last ${t.peaks.length} closed trades: the most each was up while we held it, beside its result. ${s.avgGiveBackPts == null ? "" : `On average a trade gave back ${s.avgGiveBackPts} points from its best.`}`}>
        <ChartContainer config={PEAK_CHART} style={chartSize(280)}>
          <BarChart data={t.peaks} margin={{ left: 16, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={4} angle={-40} textAnchor="end" height={64} />
            <YAxis axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v, n) => `${PEAK_CHART[n as keyof typeof PEAK_CHART]?.label ?? n}: ${pct(Number(v))}`} />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="best" fill="var(--color-best)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="exit" fill="var(--color-exit)" radius={4}>
              {t.peaks.map((p) => <Cell key={p.label} fill={p.exit < 0 ? "var(--negative)" : "var(--positive)"} />)}
            </Bar>
          </BarChart>
        </ChartContainer>
      </Section>

      <div className="space-y-6">
        <Section title="By analyst">
          <SimpleTable head={["Analyst", ["Trades", "num"], ["Win rate", "num"], ["Avg result", "num"], ["Avg R", "num"], ["Realized", "num"], ["Days", "num"]]} empty="No trades in this range."
            rows={t.byAnalyst.map((a) => [a.analyst, a.trades, `${a.winRatePct}%`, signed(a.avgGainPct), r(a.avgR), money(a.realizedPnl), a.avgHoldDays])} />
        </Section>
        <Section title="By setup" description="Avg R needs the stop the trade opened with; trades without one count everywhere else.">
          <SimpleTable head={["Setup", ["Trades", "num"], ["Win rate", "num"], ["Avg R", "num"], ["Days", "num"], ["Gave back", "num"]]} empty="No trades in this range."
            rows={t.bySetup.map((x) => [x.setup, x.trades, `${x.winRatePct}%`, r(x.avgR), x.avgHoldDays, x.avgGiveBackPts == null ? "—" : `${x.avgGiveBackPts} pts`])} />
        </Section>
      </div>

      <Section title="Recent closed trades">
        <SimpleTable head={["Stock", "Analyst", "Setup", "Closed", ["Result", "num"], ["Best", "num"], ["R", "num"], ["Days", "num"], "Ended by", ["Realized", "num"]]} empty="No trades in this range."
          rows={t.recent.map((x) => [
            x.thesisId ? <Button key="s" variant="link" size="sm" onClick={() => open(x.thesisId as string, x.symbol)}>{x.symbol}</Button> : x.symbol,
            x.analyst, x.setup, <span key="d" className="tabular-nums">{shortDate(x.closedOn)}</span>,
            signed(x.gainPct), pct(x.bestPct), r(x.r), x.days, x.reason, money(x.realizedPnl),
          ])} />
      </Section>
    </div>
  );
}
