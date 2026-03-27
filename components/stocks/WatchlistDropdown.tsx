'use client';

import { useOptimistic, useTransition } from 'react';
import { BookmarkPlus, BookmarkCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  addWatchlistItem,
  removeWatchlistItem,
} from '@/lib/actions/watchlist.actions';

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
  const [isPending, startTransition] = useTransition();

  const [optimisticAnalysts, setOptimistic] = useOptimistic(
    analysts,
    (current: Analyst[], analystId: string) =>
      current.map((a) =>
        a.id === analystId ? { ...a, isWatched: !a.isWatched } : a,
      ),
  );

  const anyWatched = optimisticAnalysts.some((a) => a.isWatched);
  const Icon = anyWatched ? BookmarkCheck : BookmarkPlus;

  function handleToggle(analyst: Analyst) {
    startTransition(async () => {
      setOptimistic(analyst.id);
      try {
        if (analyst.isWatched) {
          await removeWatchlistItem(analyst.id, symbol);
        } else {
          await addWatchlistItem(analyst.id, symbol);
        }
      } catch (error) {
        console.error('Watchlist toggle failed:', error);
      }
    });
  }

  if (analysts.length === 0) {
    return (
      <Button variant="ghost" size="icon-sm" disabled>
        <BookmarkPlus />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Add to Watchlist</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {optimisticAnalysts.map((analyst) => (
          <DropdownMenuItem
            key={analyst.id}
            onClick={() => handleToggle(analyst)}
          >
            <span>{analyst.name}</span>
            {analyst.isWatched && (
              <Check className="ml-auto h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
