"use client";

import type { ReactNode } from "react";
import { ThesisBody, ThesisBodySkeleton, useThesisSheetData } from "@/components/agent/sheets/ThesisSheet";

/**
 * A thesis as a page body: the sheet's body with a sidebar — the same tabs,
 * chart, triggers and notes, loaded the same way the sheet loads them. The
 * trade page pins its own position row; the stock page takes the thesis's
 * current trade and adds its Financials and News tabs and its history under
 * Activity. The body puts the position card and the stock cards in the
 * sidebar itself; `aside` is a page's extra card (the trade page's Trade
 * Details, the stock page's About), rendered between them. While the thesis
 * loads it sits beside the skeleton.
 */
export function ThesisPageBody({
  thesisId,
  positionId = null,
  ticker,
  aside,
  moreTabs,
  afterActivity,
}: {
  thesisId: string | null;
  positionId?: string | null;
  ticker: string;
  aside?: ReactNode;
  moreTabs?: Array<{ label: string; content: ReactNode }>;
  afterActivity?: ReactNode;
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
      afterActivity={afterActivity}
    />
  );
}
