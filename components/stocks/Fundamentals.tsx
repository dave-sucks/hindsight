/**
 * The Fundamentals tab (the owner, 2026-11-05, after Robinhood's): one grid
 * of groups, three columns wide, a gap between columns and rows and nothing
 * else. Every group is a label with a rule under it, then the same stat
 * rows; Valuation spans two columns and lays its rows down both.
 *
 *   Valuation                      | Company
 *   Growth        | Price returns  | Profitability
 *   Balance sheet | Per share      | Dividends
 *   Filings
 *
 * Narrower than three columns the groups flow in two; narrower still they
 * stack. Only the three margins carry a bar.
 */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/domain/section-label";
import { BarList, StatGrid, StatList } from "@/components/stocks/StatGrid";
import type { Fundamentals as Data, Stat } from "@/lib/stocks/stock-stats";
import { cn } from "@/lib/utils";

function Group({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={cn("self-start", wide && "@min-[448px]:col-span-2")}>
      <SectionLabel className="border-b border-border pb-2">{label}</SectionLabel>
      {children}
    </section>
  );
}

/** One row of the grid: up to three groups, or nothing when all are empty. */
function Row({ groups }: { groups: ReactNode[] }) {
  const drawn = groups.filter(Boolean);
  if (drawn.length === 0) return null;
  // Both widths in one form, so the wider rule wins: a named @md sorts after
  // an arbitrary width in the cascade and left the third column an auto track.
  return <div className="grid grid-cols-1 gap-x-8 gap-y-10 @min-[448px]:grid-cols-2 @min-[840px]:grid-cols-3">{drawn}</div>;
}

const list = (key: string, label: string, stats: Stat[]) =>
  stats.length > 0 ? (
    <Group key={key} label={label}>
      <StatList stats={stats} />
    </Group>
  ) : null;

export function Fundamentals({
  ticker,
  data: d,
  facts,
  filings,
}: {
  ticker: string;
  data: Data;
  facts: Stat[];
  filings: ReactNode;
}) {
  const nothing =
    d.valuation.length === 0 && [d.growth, d.priceReturns, d.margins, d.returns, d.balanceSheet, d.perShare, d.dividends].every((g) => g.length === 0);
  return (
    <div className="@container">
      <div className="space-y-10">
        <Row
          groups={[
            d.valuation.length > 0 ? (
              <Group key="valuation" label="Valuation" wide>
                <StatGrid columns={d.valuation} />
              </Group>
            ) : nothing ? (
              <p key="none" className="text-sm text-muted-foreground @min-[448px]:col-span-2">
                No financial data for {ticker}.
              </p>
            ) : null,
            list("company", "Company", facts),
          ]}
        />
        <Row
          groups={[
            list("growth", "Growth", d.growth),
            list("returns", "Price returns", d.priceReturns),
            d.margins.length > 0 || d.returns.length > 0 ? (
              <Group key="profit" label="Profitability">
                <BarList stats={d.margins} floor={100} />
                <StatList stats={d.returns} />
              </Group>
            ) : null,
          ]}
        />
        <Row
          groups={[
            list("balance", "Balance sheet", d.balanceSheet),
            list("share", "Per share", d.perShare),
            list("dividends", "Dividends", d.dividends),
          ]}
        />
        <section className="space-y-2">
          <SectionLabel>Filings</SectionLabel>
          {filings}
        </section>
      </div>
    </div>
  );
}
