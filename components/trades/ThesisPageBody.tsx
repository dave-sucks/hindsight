"use client";

import type { ReactNode } from "react";
import { ThesisBody, ThesisBodySkeleton, useThesisSheetData } from "@/components/agent/sheets/ThesisSheet";
import type { FillFacts } from "@/lib/stocks/stock-history";

/**
 * A thesis as a page body: the sheet's body with a sidebar — the same tabs,
 * chart, triggers and notes, loaded the same way the sheet loads them. The
 * trade page pins its own position row; the stock page hands in every trade
 * on the stock for the Transactions tab, its Financials (the key stats at the
 * top) and News tabs, and hides the plan and the Activity tab (it is
 * the stock, not the trade). The body puts the stock cards in the sidebar
 * itself; `aside` is a page's extra card (the stock page's About). While the
 * thesis loads it sits beside the skeleton.
 */
export function ThesisPageBody({
  thesisId,
  positionId = null,
  ticker,
  aside,
  moreTabs,
  transactions,
  showTriggers,
  showActivity,
}: {
  thesisId: string | null;
  positionId?: string | null;
  ticker: string;
  aside?: ReactNode;
  moreTabs?: Array<{ label: string; content: ReactNode }>;
  transactions?: FillFacts[];
  showTriggers?: boolean;
  showActivity?: boolean;
}) {
  const data = useThesisSheetData(thesisId ?? undefined, ticker, positionId);
  const state = data.state;
  if (!thesisId || !data.loaded || !state) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {!thesisId ? (
            <p className="py-8 text-sm text-muted-foreground">No thesis on record for this trade.</p>
          ) : !data.loaded ? (
            <ThesisBodySkeleton />
          ) : (
            <p className="py-8 text-sm text-muted-foreground">Couldn&apos;t load this thesis. Reload to retry.</p>
          )}
        </div>
        {aside ? <div className="hidden lg:block space-y-4">{aside}</div> : null}
      </div>
    );
  }
  return (
    <ThesisBody
      data={{ ...data, state }}
      thesis_id={thesisId}
      ticker={ticker}
      surface="page"
      aside={aside}
      moreTabs={moreTabs}
      transactions={transactions}
      showTriggers={showTriggers}
      showActivity={showActivity}
    />
  );
}
