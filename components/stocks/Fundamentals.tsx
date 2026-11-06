/**
 * The Fundamentals tab (the owner, 2026-11-05, after Robinhood's): one grid
 * from top to bottom. Each band is a main part two columns wide beside a
 * rail one column wide, the rail split off by a hairline and a wider gap.
 * The main part holds one group laid down both columns (Valuation) or two
 * groups side by side; every group is a label over the same stat rows.
 *
 *   Valuation                      ‖ Company
 *   Growth        | Price returns  ‖ Profitability   (the rates, as bars)
 *   Balance sheet | Per share      ‖ Dividends
 *   Filings
 *
 * Narrower than three columns (a laptop beside the sidebar) the rail's
 * group joins the two columns as a third group; narrower still they stack.
 */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/domain/section-label";
import { BarList, FactList, StatGrid, StatList } from "@/components/stocks/StatGrid";
import type { Fundamentals as Data } from "@/lib/stocks/stock-stats";
import { cn } from "@/lib/utils";

function Group({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={cn("space-y-1", wide && "@min-[448px]:col-span-2")}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

/** A main part (two columns) beside a rail (one), or nothing when both are empty. */
function Band({ main, rail }: { main: ReactNode[]; rail: ReactNode }) {
  const groups = main.filter(Boolean);
  if (groups.length === 0 && !rail) return null;
  // Both widths in one form, so the wider rule wins: a named @md sorts after
  // an arbitrary width in the cascade and left the third column an auto track.
  return (
    <div className="grid grid-cols-1 gap-8 @min-[448px]:grid-cols-2 @min-[840px]:grid-cols-3">
      {groups}
      {rail ? <div className="@min-[840px]:col-start-3 @min-[840px]:border-l @min-[840px]:border-border/40 @min-[840px]:pl-8">{rail}</div> : null}
    </div>
  );
}

export function Fundamentals({
  ticker,
  data,
  facts,
  filings,
}: {
  ticker: string;
  data: Data;
  facts: Array<{ label: string; value: ReactNode }>;
  filings: ReactNode;
}) {
  const d = data;
  const nothing = [d.growth, d.priceReturns, d.profitability, d.balanceSheet, d.perShare, d.dividends].every((g) => g.length === 0) && d.valuation.length === 0;
  return (
    <div className="@container">
      <div className="space-y-10">
        <Band
          main={[
            d.valuation.length > 0 ? (
              <Group key="valuation" label="Valuation" wide>
                <StatGrid columns={d.valuation} />
              </Group>
            ) : nothing ? (
              <p key="none" className="text-sm text-muted-foreground @min-[448px]:col-span-2">
                No financial data for {ticker}.
              </p>
            ) : null,
          ]}
          rail={
            facts.length > 0 ? (
              <Group label="Company">
                <FactList rows={facts} />
              </Group>
            ) : null
          }
        />
        <Band
          main={[
            d.growth.length > 0 ? (
              <Group key="growth" label="Growth">
                <BarList stats={d.growth} />
              </Group>
            ) : null,
            d.priceReturns.length > 0 ? (
              <Group key="returns" label="Price returns">
                <BarList stats={d.priceReturns} />
              </Group>
            ) : null,
          ]}
          rail={
            d.profitability.length > 0 ? (
              <Group label="Profitability">
                <BarList stats={d.profitability} floor={100} />
              </Group>
            ) : null
          }
        />
        <Band
          main={[
            d.balanceSheet.length > 0 ? (
              <Group key="balance" label="Balance sheet">
                <StatList stats={d.balanceSheet} />
              </Group>
            ) : null,
            d.perShare.length > 0 ? (
              <Group key="share" label="Per share">
                <StatList stats={d.perShare} />
              </Group>
            ) : null,
          ]}
          rail={
            d.dividends.length > 0 ? (
              <Group label="Dividends">
                <StatList stats={d.dividends} />
              </Group>
            ) : null
          }
        />
        <section className="space-y-2">
          <SectionLabel>Filings</SectionLabel>
          {filings}
        </section>
      </div>
    </div>
  );
}
