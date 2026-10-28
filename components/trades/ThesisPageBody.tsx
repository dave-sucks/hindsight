"use client";

import type { ReactNode } from "react";
import { ThesisBody, ThesisBodySkeleton, useThesisSheetData } from "@/components/agent/sheets/ThesisSheet";

/**
 * The trade page's body: the thesis sheet's body with a sidebar — the same
 * tabs, chart, triggers and notes, loaded the same way the sheet loads them,
 * pinned to this page's own position row. The body puts the position card
 * and the stock cards in the sidebar itself; `aside` is the page's one extra
 * card (Trade Details), rendered between them. While the thesis loads it
 * sits beside the skeleton.
 */
export function ThesisPageBody({
  thesisId,
  positionId,
  ticker,
  aside,
}: {
  thesisId: string | null;
  positionId: string;
  ticker: string;
  aside?: ReactNode;
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
  return <ThesisBody data={{ ...data, state }} thesis_id={thesisId} ticker={ticker} surface="page" aside={aside} />;
}
