'use client';

import * as React from 'react';
import { BookmarkPlus, BookmarkCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  addWatchlistItem,
  dispatchThesisWrite,
  removeWatchlistItem,
} from '@/lib/actions/watchlist.actions';
import {
  AddToWatchlistDialog,
  type AddToWatchlistChoices,
} from '@/components/stocks/AddToWatchlistDialog';

interface Analyst {
  id: string;
  name: string;
  isWatched: boolean;
}

interface WatchlistDropdownProps {
  symbol: string;
  analysts: Analyst[];
}

export function WatchlistDropdown({ symbol, analysts }: WatchlistDropdownProps) {
  const [state, setState] = React.useState(analysts);
  // The analyst awaiting the two add questions, or null when none is.
  const [pendingAdd, setPendingAdd] = React.useState<Analyst | null>(null);

  const anyWatched = state.some((a) => a.isWatched);
  const Icon = anyWatched ? BookmarkCheck : BookmarkPlus;

  function handleToggle(analystId: string, checked: boolean) {
    // Adding asks two questions first (DAV-225) — whether to research the
    // name now, and whether to review it on a schedule. Neither is assumed.
    if (checked) {
      const analyst = state.find((a) => a.id === analystId);
      if (analyst) setPendingAdd(analyst);
      return;
    }
    setState((prev) =>
      prev.map((a) => (a.id === analystId ? { ...a, isWatched: false } : a)),
    );
    removeWatchlistItem(analystId, symbol).catch(console.error);
  }

  function confirmAdd(analyst: Analyst, choices: AddToWatchlistChoices) {
    setState((prev) =>
      prev.map((a) => (a.id === analyst.id ? { ...a, isWatched: true } : a)),
    );
    // "Write a thesis now" hands the whole name to the writer, which mints
    // the coverage itself — seeding a bare row first would collide with it.
    if (choices.writeThesisNow) {
      dispatchThesisWrite(
        analyst.id,
        symbol,
        choices.reviewCadenceDays,
      ).catch(console.error);
      return;
    }
    addWatchlistItem(
      analyst.id,
      symbol,
      'Added manually',
      'USER',
      'NORMAL',
      choices.reviewCadenceDays,
    ).catch(console.error);
  }

  if (analysts.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Watchlists</DropdownMenuLabel>
          {state.map((analyst) => (
            <DropdownMenuCheckboxItem
              key={analyst.id}
              checked={analyst.isWatched}
              onCheckedChange={(checked) => handleToggle(analyst.id, !!checked)}
            >
              {analyst.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {pendingAdd ? (
        <AddToWatchlistDialog
          open
          onOpenChange={(o) => {
            if (!o) setPendingAdd(null);
          }}
          symbol={symbol}
          analystName={pendingAdd.name}
          onConfirm={(choices) => confirmAdd(pendingAdd, choices)}
        />
      ) : null}
    </DropdownMenu>
  );
}
