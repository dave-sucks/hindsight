/**
 * The Fundamentals tab (the owner, 2026-11-05, after Robinhood's): a grid
 * three columns wide with a gap and nothing else, two rows deep. Every
 * group is a label with a rule under it, then the same stat rows.
 *
 *   Valuation (down two columns)             | Company
 *   Business: Growth · Profitability ·       | Price returns
 *             Balance sheet · Per share
 *             (one block, a small tab each)
 *   Filings
 *
 * The business block is the owner's call (2026-11-05): the groups about the
 * company share one block and one set of small tabs instead of each taking
 * a third of the page, since most of them are rarely read; the stock's own
 * returns stay beside it. Narrower than three columns the groups flow in
 * two; narrower still they stack. Only the three margins carry a bar.
 */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/domain/section-label";
import { BarList, StatGrid, StatList } from "@/components/stocks/StatGrid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { inColumns, type Fundamentals as Data, type Stat } from "@/lib/stocks/stock-stats";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="self-start">
      <SectionLabel className="border-b border-border pb-2">{label}</SectionLabel>
      {children}
    </section>
  );
}

/** One row of the grid: up to three columns of groups, or nothing when all are empty. */
function Row({ children }: { children: ReactNode }) {
  // Both widths in one form, so the wider rule wins: a named @md sorts after
  // an arbitrary width in the cascade and left the third column an auto track.
  return <div className="grid grid-cols-1 gap-x-8 gap-y-10 @min-[448px]:grid-cols-2 @min-[840px]:grid-cols-3">{children}</div>;
}

/** The two-column cell: Valuation, and the business block with its tabs. */
function Wide({ children }: { children: ReactNode }) {
  return <div className="self-start @min-[448px]:col-span-2">{children}</div>;
}

/** The business block: one label, a small tab per group, the chosen group's rows down two columns. */
function Business({ d }: { d: Data }) {
  const tabs: Array<{ value: string; label: string; body: ReactNode }> = [];
  if (d.growth.length > 0) tabs.push({ value: "growth", label: "Growth", body: <StatGrid columns={inColumns(d.growth)} /> });
  if (d.margins.length > 0 || d.returns.length > 0) {
    tabs.push({
      value: "profitability",
      label: "Profitability",
      body: (
        <div className="grid grid-cols-1 gap-x-8 @min-[448px]:grid-cols-2">
          <BarList stats={d.margins} floor={100} />
          <StatList stats={d.returns} />
        </div>
      ),
    });
  }
  if (d.balanceSheet.length > 0) tabs.push({ value: "balance", label: "Balance sheet", body: <StatGrid columns={inColumns(d.balanceSheet)} /> });
  if (d.perShare.length > 0) tabs.push({ value: "share", label: "Per share", body: <StatGrid columns={inColumns(d.perShare)} /> });
  if (tabs.length === 0) return null;
  return (
    <Tabs defaultValue={tabs[0].value}>
      <SectionLabel
        className="border-b border-border pb-2"
        action={
          <TabsList size="sm">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      >
        Business
      </SectionLabel>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function Fundamentals({ ticker, data: d, facts, filings }: { ticker: string; data: Data; facts: Stat[]; filings: ReactNode }) {
  const hasBusiness = [d.growth, d.margins, d.returns, d.balanceSheet, d.perShare].some((g) => g.length > 0);
  const nothing = d.valuation.length === 0 && d.priceReturns.length === 0 && !hasBusiness;
  return (
    <div className="@container">
      <div className="space-y-10">
        <Row>
          {d.valuation.length > 0 ? (
            <Wide>
              <Group label="Valuation">
                <StatGrid columns={inColumns(d.valuation)} />
              </Group>
            </Wide>
          ) : nothing ? (
            <Wide>
              <p className="text-sm text-muted-foreground">No financial data for {ticker}.</p>
            </Wide>
          ) : null}
          {facts.length > 0 ? (
            <Group label="Company">
              <StatList stats={facts} />
            </Group>
          ) : null}
        </Row>
        <Row>
          {hasBusiness ? (
            <Wide>
              <Business d={d} />
            </Wide>
          ) : null}
          {d.priceReturns.length > 0 ? (
            <Group label="Price returns">
              <StatList stats={d.priceReturns} />
            </Group>
          ) : null}
        </Row>
        <section className="space-y-2">
          <SectionLabel>Filings</SectionLabel>
          {filings}
        </section>
      </div>
    </div>
  );
}
