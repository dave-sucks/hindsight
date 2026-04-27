"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { StockLogo } from "@/components/StockLogo";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hooks/useDebounce";

// ── StockSearch ─────────────────────────────────────────────────────────────
// THE single stock-picker for the app. Trigger button opens a popover with a
// Finnhub-backed search field and a Command list of results. Used by:
//   - Analyst watchlist add-row
//   - Chat composer "$ Stocks" toolbar
// Anything else that needs "search a stock and pick one" should use this.
//
// Cmd-K global search lives in components/SearchCommand.tsx — that one is a
// dialog (different surface) and is intentionally separate.

export interface StockItem {
  symbol: string;
  name: string;
}

export interface StockSearchProps {
  onSelect: (symbol: string, name: string) => void;
  /** Custom trigger element. Defaults to an outline "Add stock" button. */
  trigger?: ReactElement;
  /** Symbols to hide from results (e.g. already on the watchlist). */
  excludeSymbols?: string[];
  /** Items shown when the search field is empty. Empty list → shows hint. */
  defaultItems?: StockItem[];
  /** Width of the popover (Tailwind class). Default w-64. */
  contentWidthClass?: string;
}

export function StockSearch({
  onSelect,
  trigger,
  excludeSymbols = [],
  defaultItems = [],
  contentWidthClass = "w-64",
}: StockSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockItem[]>(defaultItems);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) {
      setResults(defaultItems);
      return;
    }
    setLoading(true);
    try {
      const found = await searchStocks(query.trim());
      setResults(
        found
          .filter((s) => !excludeSymbols.includes(s.symbol))
          .map((s) => ({ symbol: s.symbol, name: s.name })),
      );
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const debouncedSearch = useDebounce(handleSearch, 300);

  useEffect(() => {
    debouncedSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleSelect = (item: StockItem) => {
    onSelect(item.symbol, item.name);
    setOpen(false);
    setQuery("");
    setResults(defaultItems);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          trigger ?? (
            <Button variant="outline" size="sm">
              <Plus />
              Add stock
            </Button>
          )
        }
      />
      <PopoverContent
        align="start"
        sideOffset={4}
        className={`p-0 ${contentWidthClass}`}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search stocks…"
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Searching…</span>
              </div>
            ) : results.length === 0 ? (
              <CommandEmpty>
                {query.trim() ? "No stocks found" : "Type to search stocks"}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {results.map((stock) => (
                  <CommandItem
                    key={stock.symbol}
                    value={stock.symbol}
                    onSelect={() => handleSelect(stock)}
                  >
                    <StockLogo ticker={stock.symbol} size="sm" />
                    <span className="font-medium">{stock.symbol}</span>
                    <span className="text-muted-foreground truncate">
                      {stock.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
