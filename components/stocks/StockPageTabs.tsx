"use client";

/**
 * The stock page's tabs when no thesis is live on the stock — Overview ·
 * Financials · Transactions · News — with the sidebar beside every tab's
 * content, as on the trade page. With a live thesis the page renders the
 * thesis's own body instead (ThesisPageBody), with Financials and News after
 * its own. Owns the open tab so Overview's "View all" can switch to
 * Transactions.
 */

import { useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StockOverview, type StockOverviewProps } from "@/components/stocks/StockOverview";
import { Transactions } from "@/components/trades/Transactions";
import type { FillFacts } from "@/lib/stocks/stock-history";

const OVERVIEW = 0;
const FINANCIALS = 1;
const TRANSACTIONS = 2;
const NEWS = 3;

export function StockPageTabs({
  overview,
  stats,
  transactions,
  financials,
  news,
  sidebar,
}: {
  overview: StockOverviewProps;
  /** The key stats under the chart. */
  stats: ReactNode;
  /** Every fill on the stock. */
  transactions: FillFacts[];
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
        <TabsTrigger value={FINANCIALS}>Financials</TabsTrigger>
        <TabsTrigger value={TRANSACTIONS}>Transactions</TabsTrigger>
        <TabsTrigger value={NEWS}>News</TabsTrigger>
      </TabsList>

      <TabsContent value={OVERVIEW} className="space-y-5">
        <StockOverview {...overview} sidebar={sidebar}>
          {stats}
          <Transactions ticker={overview.ticker} fills={transactions} limit={5} onViewAll={() => setTab(TRANSACTIONS)} openThesis />
        </StockOverview>
      </TabsContent>

      <TabsContent value={FINANCIALS} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">{financials}</div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={TRANSACTIONS} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">
            <Transactions ticker={overview.ticker} fills={transactions} openThesis />
          </div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={NEWS} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">{news}</div>
          {side}
        </div>
      </TabsContent>
    </Tabs>
  );
}
