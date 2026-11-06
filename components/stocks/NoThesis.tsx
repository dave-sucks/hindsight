"use client";

/**
 * The stock page's Thesis tab when no thesis is live on the stock (the
 * owner, 2026-11-05, "to polish on a rainy day"): a bordered rectangle
 * drawn as a skeleton of writing (a square avatar, three lines), "No
 * research yet" under it, and an outline button that asks an analyst for
 * a thesis: pick one and the stock goes to that analyst's thesis writer,
 * the same path as the watchlist menu's "research it now".
 */

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { sendToThesisWriter } from "@/lib/actions/watchlist.actions";

export function NoThesis({ ticker, analysts }: { ticker: string; analysts: Array<{ id: string; name: string }> }) {
  const ask = (analyst: { id: string; name: string }) =>
    sendToThesisWriter(analyst.id, ticker, "horizon", "mint")
      .then(() => toast.success(`${ticker} sent to ${analyst.name} — the thesis lands shortly.`))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : `Couldn't send ${ticker}`));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-sm" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">No research yet</p>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" disabled={analysts.length === 0} />}>
            Create thesis for {ticker}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Which analyst writes it</DropdownMenuLabel>
            {analysts.map((a) => (
              <DropdownMenuItem key={a.id} onClick={() => ask(a)}>
                {a.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
