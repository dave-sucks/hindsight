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
  removeWatchlistItem,
  sendToThesisWriter,
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
  /** Analyst awaiting the two add questions, or null when none is. */
  const [pendingAdd, setPendingAdd] = React.useState<Analyst | null>(null);

  const anyWatched = state.some((a) => a.isWatched);
  const Icon = anyWatched ? BookmarkCheck : BookmarkPlus;

  function handleToggle(analystId: string, checked: boolean) {
    // Adding asks the two questions first (DAV-225): research it now, and
    // review it on a schedule. Neither is assumed.
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
    // Research mints the coverage itself, so don't seed a bare row first.
    const work = choices.writeThesisNow
      ? sendToThesisWriter(analyst.id, symbol, choices.reviewCadenceDays)
      : addWatchlistItem(
          analyst.id,
          symbol,
          'Added manually',
          'USER',
          'NORMAL',
          choices.reviewCadenceDays,
        );
    work.catch(console.error);
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
