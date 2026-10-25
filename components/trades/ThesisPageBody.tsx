"use client";

import { ThesisBody, ThesisBodySkeleton, useThesisSheetData } from "@/components/agent/sheets/ThesisSheet";

/**
 * The trade page's main column: the thesis sheet's body — price with the
 * chart's move, a proposal if one waits, the tabs, the chart, the note, the
 * triggers and the rest — loaded the same way the sheet loads it. The page's
 * right-hand card carries the held trade, so the banner shows only for a
 * proposal (surface "page").
 */
export function ThesisPageBody({ thesisId, ticker }: { thesisId: string; ticker: string }) {
  const data = useThesisSheetData(thesisId, ticker);
  if (!data.loaded) return <ThesisBodySkeleton />;
  const state = data.state;
  if (!state) {
    return <p className="py-8 text-sm text-muted-foreground">Couldn&apos;t load this thesis. Reload to retry.</p>;
  }
  return <ThesisBody data={{ ...data, state }} thesis_id={thesisId} ticker={ticker} surface="page" />;
}
