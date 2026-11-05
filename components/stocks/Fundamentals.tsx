/**
 * The Fundamentals tab (the owner, 2026-11-05, after Robinhood's): the key
 * figures in two columns on the left, the company's facts in one on the
 * right, then the full statistics table and the filings under both.
 */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/domain/section-label";
import { FactList, StatGrid } from "@/components/stocks/StatGrid";
import { StatTable } from "@/components/stocks/StatTable";
import type { StatColumns, StatSection } from "@/lib/stocks/stock-stats";

export function Fundamentals({
  ticker,
  figures,
  facts,
  sections,
  filings,
}: {
  ticker: string;
  figures: StatColumns;
  facts: Array<{ label: string; value: ReactNode }>;
  sections: StatSection[];
  filings: ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-3">
        <section className="space-y-1 lg:col-span-2">
          <SectionLabel>Key figures</SectionLabel>
          <StatGrid columns={figures} />
        </section>
        <section className="space-y-1">
          <SectionLabel>Company</SectionLabel>
          <FactList rows={facts} />
        </section>
      </div>
      {sections.length > 0 ? (
        <StatTable sections={sections} />
      ) : (
        <p className="text-sm text-muted-foreground">No financial data for {ticker}.</p>
      )}
      <section className="space-y-2">
        <SectionLabel>Filings</SectionLabel>
        {filings}
      </section>
    </div>
  );
}
