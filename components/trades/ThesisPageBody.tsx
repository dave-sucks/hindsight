"use client";

import type { ReactNode } from "react";
import { ThesisBody, ThesisBodySkeleton, useThesisSheetData } from "@/components/agent/sheets/ThesisSheet";

/**
 * The trade page's main column: the thesis sheet's body — price with the
 * chart's move, a proposal if one waits, the tabs, the chart, the note, the
 * triggers and the rest — loaded the same way the sheet loads it. The page's
 * right-hand cards (`aside`) render beside the tab panels so they start
 * level with the chart; while the thesis loads they sit beside the skeleton.
 */
export function ThesisPageBody({ thesisId, ticker, aside }: { thesisId: string | null; ticker: string; aside?: ReactNode }) {
  const data = useThesisSheetData(thesisId ?? undefined, ticker);
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
