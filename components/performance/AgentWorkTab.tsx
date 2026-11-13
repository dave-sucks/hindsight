"use client";

import { useState, type ReactNode } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { AnalystFilter, Empty, Loading, Num, Section, SimpleTable, Tiles, chartSize, useLoad, type Tile } from "@/components/performance/parts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { AgentWork } from "@/lib/performance/agent-work";
import { OUTCOMES, OUTCOME_LABEL, RANGES, type Outcome, type RangeDays } from "@/lib/performance/agent-work-terms";

const COLOR: Record<Outcome | "pending", string> = {
  trade: "var(--chart-3)", refused: "var(--chart-1)", plan: "var(--positive)", research: "var(--foreground)",
  note: "var(--muted-foreground)", nothing: "var(--negative)", pending: "var(--border)",
};
const ACTIONS = [["EXIT", "Sell", "var(--negative)"], ["REVIEW", "Review", "var(--muted-foreground)"], ["ENTER", "Buy", "var(--chart-2)"], ["ADD", "Add", "var(--chart-4)"], ["TRIM", "Trim", "var(--chart-1)"]] as const;
const OUTCOME_CHART = Object.fromEntries(OUTCOMES.map((k) => [k, { label: OUTCOME_LABEL[k], color: COLOR[k] }])) satisfies ChartConfig;
const FIRES_CHART = {
  ...Object.fromEntries(ACTIONS.map(([k, label, color]) => [k, { label, color }])),
  expired: { label: "Expired proposals", color: "var(--foreground)" },
} satisfies ChartConfig;
type Counts = Record<string, number | undefined>;


function OutcomeBar({ out }: { out: Counts }) {
  const keys = [...OUTCOMES, "pending"] as const;
  const total = keys.reduce((s, k) => s + (out[k] ?? 0), 0);
  if (!total) return <span className="text-xs text-muted-foreground">Never shown</span>;
  return (
    <div className="min-w-48 space-y-1 whitespace-normal">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {keys.map((k) => (out[k] ? <div key={k} style={{ width: `${(100 * (out[k] ?? 0)) / total}%`, background: COLOR[k] }} /> : null))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{keys.filter((k) => out[k]).map((k) => `${OUTCOME_LABEL[k].toLowerCase()} ${out[k]}`).join(" · ")}</p>
    </div>
  );
}

function CountList({ rows }: { rows: Array<{ label: string; n: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <Empty>No fires in this range.</Empty>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,2fr)_3fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>{r.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${(100 * r.n) / max}%` }} /></div>
          <Num>{r.n}</Num>
        </div>
      ))}
    </div>
  );
}

export function AgentWorkTab() {
  const [days, setDays] = useState<RangeDays>(30);
  const [analyst, setAnalyst] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ id: string; ticker: string } | null>(null);
  const q = new URLSearchParams({ days: String(days), ...(analyst ? { analyst } : {}) });
  const { data, error, retry } = useLoad<AgentWork>(`/api/performance/agent-work?${q}`);
  const stock = (thesisId: string, ticker: string) => (
    <Button variant="link" size="sm" onClick={() => setSheet({ id: thesisId, ticker })}>{ticker}</Button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">What the agents were shown and what they did, from saved runs, Activity lines and orders. Nothing here reaches an agent.</p>
        <div className="flex items-center gap-2">
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v) as RangeDays)}>
            <TabsList size="sm">{RANGES.map((d) => <TabsTrigger key={d} value={String(d)}>{d}D</TabsTrigger>)}</TabsList>
          </Tabs>
          <AnalystFilter analysts={data?.analysts} value={analyst} onChange={setAnalyst} />
        </div>
      </div>

      {!data ? (
        <Loading error={error} what="agent work numbers" onRetry={retry} />
      ) : (
        <Body w={data} stock={stock} />
      )}

      {sheet && <ThesisSheet open onOpenChange={(o) => !o && setSheet(null)} thesis_id={sheet.id} ticker={sheet.ticker} direction={null} />}
    </div>
  );
}

/** The listed-but-unanswered rows, one per stock: how many mornings, the last one, every code it carried. */
function nothingByStock(w: AgentWork) {
  const by = new Map<string, { thesisId: string; ticker: string; analyst: string; n: number; last: string; codes: Set<string> }>();
  for (const x of w.situations.nothing) {
    const e = by.get(x.thesisId) ?? { thesisId: x.thesisId, ticker: x.ticker ?? "?", analyst: x.analyst, n: 0, last: x.date, codes: new Set<string>() };
    e.n++;
    if (x.date > e.last) e.last = x.date;
    x.codes.forEach((c) => e.codes.add(c));
    by.set(x.thesisId, e);
  }
  return [...by.values()].sort((a, b) => b.n - a.n).map((e) => ({ ...e, codes: [...e.codes] }));
}

function Body({ w, stock }: { w: AgentWork; stock: (thesisId: string, ticker: string) => ReactNode }) {
  const t = w.totals;
  const tiles: Tile[] = [
    { label: "Morning runs", value: String(t.morningRuns) },
    { label: "Trigger runs", value: String(t.triggerRuns) },
    { label: "Trigger fires", value: String(t.fires), sub: `on ${t.firedStocks} stocks` },
    { label: "Proposals", value: String(t.proposals), sub: `${t.expired} expired unanswered` },
    { label: "Approved and filled", value: String(t.filled) },
    { label: "Listed, nothing written", value: t.workRows ? `${Math.round((100 * t.nothing) / t.workRows)}%` : "—", sub: `${t.nothing} of ${t.workRows} work-list rows` },
  ];
  const names = [...new Set(w.runs.byType.map((r) => r.analyst))].sort((a, b) => (a === "Account" ? 1 : b === "Account" ? -1 : a.localeCompare(b)));
  const runCols = ["Morning", "Trigger", "Writer", "Chat"];
  const runsOf = (name: string, mode: string) => w.runs.byType.filter((r) => r.analyst === name && (mode === "Other" ? !runCols.includes(r.mode) : r.mode === mode)).reduce((s, r) => s + r.n, 0);
  const categories = w.situations.categories.map((c) => ({ category: c.category, triggerRuns: c.triggerRuns, ...c.out }));
  // Every day carries every action (0 when none), so the stacked areas join up.
  const daily: Array<Record<string, number | string>> = (w.fires.daily as Array<{ date: string } & Counts>).map((d) => ({
    ...Object.fromEntries([...ACTIONS.map(([k]) => k), "expired"].map((k) => [k, d[k] ?? 0])), date: d.date,
  }));
  const actions = ACTIONS.filter(([k]) => daily.some((d) => Number(d[k]) > 0));

  return (
    <div className="space-y-6">
      {w.reads.read < w.reads.morningRuns && (
        <Alert>
          <AlertTitle>Some morning runs couldn&apos;t be read</AlertTitle>
          <AlertDescription>Situations came back from {w.reads.read} of {w.reads.morningRuns} morning runs. The saved thread may have changed shape; the situation counts below are short.</AlertDescription>
        </Alert>
      )}

      <Tiles tiles={tiles} />

      <h2 className="text-lg font-medium">Runs</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Runs by type" description="Per analyst. Account runs are your chat, the portfolio digest and the market review.">
          <SimpleTable head={["Analyst", ...runCols.map((c) => [c, "num"] as [string, "num"]), ["Other", "num"]]} empty="No runs in this range."
            rows={names.map((n) => [n, ...[...runCols, "Other"].map((m) => runsOf(n, m))])} />
        </Section>
        <Section title="Stocks touched per run" description="Written counts stocks the run wrote a line on, a Writer it dispatched included.">
          <SimpleTable head={["Run", ["Runs", "num"], ["Listed", "num"], ["Written", "num"], ["Most", "num"]]} empty="No runs in this range."
            rows={w.runs.touched.map((r) => [r.mode, r.runs, r.listed == null ? "" : <Num key="l">{r.listed.toFixed(1)}</Num>, <Num key="w">{r.written.toFixed(1)}</Num>, r.max])} />
        </Section>
      </div>

      <h2 className="text-lg font-medium">Situations</h2>
      <Section title="By category" description={`What the morning run did with the stocks it was shown (${t.workRows} work-list rows; a stock in two categories counts in both). Trigger runs: ${w.situations.categories.map((c) => `${c.category} ${c.triggerRuns}`).join(" · ")}.`}>
        <ChartContainer config={OUTCOME_CHART} style={chartSize(280)}>
          <BarChart data={categories} layout="vertical" margin={{ left: 8, right: 8 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="category" axisLine={false} tickLine={false} width={132} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {OUTCOMES.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="o" fill={`var(--color-${k})`} radius={i === OUTCOMES.length - 1 ? [0, 4, 4, 0] : 0} />
            ))}
          </BarChart>
        </ChartContainer>
      </Section>
      <Section title="By situation" description="Shown: rows on the work list. On quiet rows: the code was on a stock the read did not list. Trigger runs: worked out from what fired, since trigger runs save no codes.">
        <SimpleTable empty="No morning runs in this range."
          head={["Situation", "Category", ["Shown", "num"], ["Stocks", "num"], ["Days", "num"], ["On quiet rows", "num"], ["Trigger runs", "num"], "What the run did"]}
          rows={w.situations.codes.map((c) => [
            <div key="n"><div>{c.name}</div><div className="text-xs text-muted-foreground">{c.code}</div></div>,
            c.category, c.shown, c.stocks, c.days, c.quiet, c.triggerRuns, <OutcomeBar key="o" out={c.out} />,
          ])} />
      </Section>
      <Section title="Listed, nothing written" description={`Stocks a morning run was shown and wrote nothing on: ${t.nothing} of ${t.workRows} work-list rows. Since Nov 13 a morning run must answer each one before it can finish, so this should empty out.`}>
        <SimpleTable head={["Stock", "Analyst", ["Mornings", "num"], "Last", "Situations"]} empty="Every listed stock got an answer."
          rows={nothingByStock(w).map((x) => [stock(x.thesisId, x.ticker), x.analyst, x.n, <span key="d" className="tabular-nums">{x.last}</span>, <span key="c" className="text-xs text-muted-foreground">{x.codes.join(", ") || "—"}</span>])} />
      </Section>

      <h2 className="text-lg font-medium">Triggers fired</h2>
      <Section title="Fires per day" description="Stacked by action. The dashed line is proposals made that day that later expired unanswered.">
        {daily.length ? (
          <ChartContainer config={FIRES_CHART} style={chartSize(260)}>
            <ComposedChart data={daily} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                {actions.map(([k]) => (
                  <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.1} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} minTickGap={24}
                tickFormatter={(d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
              <YAxis axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot"
                labelFormatter={(d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {actions.map(([k]) => (
                <Area key={k} dataKey={k} type="monotone" stackId="a" fill={`url(#fill-${k})`} stroke={`var(--color-${k})`} />
              ))}
              <Line dataKey="expired" type="monotone" stroke="var(--color-expired)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            </ComposedChart>
          </ChartContainer>
        ) : <Empty>No fires in this range.</Empty>}
      </Section>
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="By action"><CountList rows={w.fires.byAction} /></Section>
        <Section title="By fire mode" description="How the fire was handled. A rule that fired into another rule's Auto run counts as Auto."><CountList rows={w.fires.byMode} /></Section>
        <Section title="By measure"><CountList rows={w.fires.byMeasure} /></Section>
        <Section title="By level" description="Where the rule lives. Removed: deleted since it fired."><CountList rows={w.fires.byLevel} /></Section>
      </div>
      <Section title="What each fire led to" description="Send to Agent and Auto: what the trigger run did. Flag for Review: what the next morning run did on the stock. Each proposal counts once.">
        <SimpleTable head={["On fire", "Action", ["Fires", "num"], "What it led to", ["Expired", "num"], ["Filled", "num"]]} empty="No fires in this range."
          rows={w.fires.ledTo.map((l) => [l.mode, l.action, l.n, <OutcomeBar key="o" out={l.out} />, l.orders.EXPIRED ?? 0, l.orders.FILLED ?? 0])} />
      </Section>
      <Section title="The worst re-firers" description="The same trigger on more than one day. Streak: the longest run of trading days in a row.">
        <SimpleTable head={["Stock", "Trigger", "Level", "On fire", ["Days", "num"], ["Streak", "num"], ["Proposals", "num"], ["Expired", "num"]]} empty="No trigger fired on more than one day."
          rows={w.fires.refirers.map((r) => [stock(r.thesisId, r.ticker), r.sentence, r.level, r.mode, r.days, r.streak, r.proposals, r.expired])} />
      </Section>
      <Section title="Same-day duplicate fires" description="Two different rules firing on the same stock the same day.">
        <SimpleTable head={["Rule", "Fired with", ["Stock-days", "num"], "Stocks"]} empty="No stock had two rules fire on the same day."
          rows={w.fires.duplicates.map((d) => [d.a, d.b, d.stockDays, <span key="s" className="text-xs text-muted-foreground">{d.tickers.join(", ")}</span>])} />
      </Section>

      <h2 className="text-lg font-medium">Proposals and stocks</h2>
      <Section title="Proposals by stock" description="Each stock's proposals and how they ended.">
        <SimpleTable head={["Stock", ["Proposals", "num"], ["Expired", "num"], ["Filled", "num"], ["Declined", "num"], ["Waiting", "num"]]} empty="No proposals in this range."
          rows={w.proposals.map((p) => [stock(p.thesisId, p.ticker), p.total, p.status.EXPIRED ?? 0, p.status.FILLED ?? 0, p.status.REJECTED ?? 0, p.status.AWAITING_APPROVAL ?? 0])} />
      </Section>
      <Section title="Per stock" description="Reviews are REVIEWED and UPDATED lines. Runs: morning runs that listed it, trigger runs on it, and any run that wrote on it. Active stocks with nothing are at the bottom.">
        <SimpleTable head={["Stock", "Analyst", "Status", ["Reviews", "num"], ["Fires", "num"], ["Runs", "num"], ["Listed", "num"], ["Trigger runs", "num"], ["Proposals", "num"], ["Expired", "num"]]} empty="No stocks in this range."
          rows={w.stocks.map((s) => [stock(s.thesisId, s.ticker), s.analyst, s.status.charAt(0) + s.status.slice(1).toLowerCase(), s.reviews, s.fires, s.runs, s.listed, s.triggerRuns, s.proposals, s.expired])} />
      </Section>
    </div>
  );
}
