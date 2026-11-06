/**
 * The Fundamentals tab (the owner, 2026-11-05, after Robinhood's). The top
 * is two columns: six key stats, one row each, two thirds wide, beside the
 * company's six facts. Under them the rest of the numbers in tabs the full
 * width of the page, the tab row standing as the header, each tab plain
 * rows and nothing else:
 *
 *   Key stats (six rows)                    | Company (six rows)
 *   [Valuation · Growth & returns · Profitability · Balance sheet & per share]
 *   Filings
 *
 * Narrower than two columns the top stacks. Only the three margins carry a bar.
 */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/domain/section-label";
import { BarList, StatList } from "@/components/stocks/StatGrid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Fundamentals as Data, Stat } from "@/lib/stocks/stock-stats";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="self-start">
      <SectionLabel className="border-b border-border pb-2">{label}</SectionLabel>
      {children}
    </section>
  );
}

/** The rest of the numbers: a small tab per group, the chosen group's rows the full width. */
function NumberTabs({ d }: { d: Data }) {
  const tabs: Array<{ value: string; label: string; body: ReactNode }> = [];
  if (d.valuation.length > 0) tabs.push({ value: "valuation", label: "Valuation", body: <StatList stats={d.valuation} /> });
  if (d.growth.length > 0 || d.priceReturns.length > 0) {
    tabs.push({ value: "growth", label: "Growth & returns", body: <StatList stats={[...d.growth, ...d.priceReturns]} /> });
  }
  if (d.margins.length > 0 || d.returns.length > 0) {
    tabs.push({
      value: "profitability",
      label: "Profitability",
      body: (
        <>
          <BarList stats={d.margins} floor={100} />
          <StatList stats={d.returns} />
        </>
      ),
    });
  }
  if (d.balanceSheet.length > 0 || d.perShare.length > 0) {
    tabs.push({ value: "balance", label: "Balance sheet & per share", body: <StatList stats={[...d.balanceSheet, ...d.perShare]} /> });
  }
  if (tabs.length === 0) return null;
  return (
    <Tabs defaultValue={tabs[0].value}>
      {/* The tab row is the header: the same rule under it as under a group's label. */}
      <div className="border-b border-border pb-2">
        <TabsList size="sm">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function Fundamentals({
  ticker,
  keyStats,
  data: d,
  facts,
  filings,
}: {
  ticker: string;
  /** The six key stats, one row each, at the top. */
  keyStats: Stat[];
  data: Data;
  facts: Stat[];
  filings: ReactNode;
}) {
  const hasNumbers = [d.valuation, d.growth, d.priceReturns, d.margins, d.returns, d.balanceSheet, d.perShare].some((g) => g.length > 0);
  return (
    <div className="@container">
      <div className="space-y-10">
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 @min-[448px]:grid-cols-3">
          <div className="@min-[448px]:col-span-2">
            <Group label="Key stats">
              <StatList stats={keyStats} />
            </Group>
          </div>
          {facts.length > 0 ? (
            <Group label="Company">
              <StatList stats={facts} />
            </Group>
          ) : null}
        </div>
        {hasNumbers ? <NumberTabs d={d} /> : <p className="text-sm text-muted-foreground">No financial data for {ticker}.</p>}
        <section className="space-y-2">
          <SectionLabel>Filings</SectionLabel>
          {filings}
        </section>
      </div>
    </div>
  );
}
