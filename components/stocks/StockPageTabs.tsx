"use client";

/**
 * The stock page's tabs when no thesis is live on the stock — Overview ·
 * Thesis (the empty state) · Fundamentals · Transactions · News — with the sidebar beside every tab's
 * content, as on the trade page. With a live thesis the page renders the
 * thesis's own body instead (ThesisPageBody), with Fundamentals and News after
 * its own. Owns the open tab so Overview's "View all" can switch to
 * Transactions.
 */

import { useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StockOverview, type StockOverviewProps } from "@/components/stocks/StockOverview";
import { Transactions } from "@/components/trades/Transactions";
import type { FillFacts } from "@/lib/stocks/stock-history";

const OVERVIEW = 0;
const THESIS = 1;
const FINANCIALS = 2;
const TRANSACTIONS = 3;
const NEWS = 4;

export function StockPageTabs({
  overview,
  overviewStats,
  transactions,
  held,
  thesis,
  financials,
  news,
  sidebar,
}: {
  overview: StockOverviewProps;
  /** The range bars and key stats, first on Overview. */
  overviewStats: ReactNode;
  /** Every fill on the stock. */
  transactions: FillFacts[];
  /** The open position, for the total line's "still holding". */
  held: { shares: number; avgCost: number } | null;
  /** The Thesis tab with no thesis: the empty state and the way to ask for one. */
  thesis: ReactNode;
  financials: ReactNode;
  news: ReactNode;
  sidebar: ReactNode;
}) {
  const [tab, setTab] = useState<number>(OVERVIEW);
  const columns = "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]";
  const side = <div className="hidden lg:block space-y-4">{sidebar}</div>;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as number)}>
      <TabsList>
        <TabsTrigger value={OVERVIEW}>Overview</TabsTrigger>
        <TabsTrigger value={THESIS}>Thesis</TabsTrigger>
        <TabsTrigger value={FINANCIALS}>Fundamentals</TabsTrigger>
        <TabsTrigger value={TRANSACTIONS}>Transactions</TabsTrigger>
        <TabsTrigger value={NEWS}>News</TabsTrigger>
      </TabsList>

      <TabsContent value={OVERVIEW} className="space-y-10">
        <StockOverview {...overview} sidebar={sidebar}>
          {overviewStats}
          <Transactions ticker={overview.ticker} fills={transactions} limit={5} onViewAll={() => setTab(TRANSACTIONS)} openThesis held={held} currentPrice={overview.price} />
        </StockOverview>
      </TabsContent>

      <TabsContent value={THESIS} className="space-y-10">
        <div className={columns}>
          <div className="min-w-0 space-y-10">{thesis}</div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={FINANCIALS} className="space-y-10">
        <div className={columns}>
          <div className="min-w-0 space-y-10">{financials}</div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={TRANSACTIONS} className="space-y-10">
        <div className={columns}>
          <div className="min-w-0 space-y-10">
            <Transactions ticker={overview.ticker} fills={transactions} openThesis held={held} currentPrice={overview.price} />
          </div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={NEWS} className="space-y-10">
        <div className={columns}>
          <div className="min-w-0 space-y-10">{news}</div>
          {side}
        </div>
      </TabsContent>
    </Tabs>
  );
}
