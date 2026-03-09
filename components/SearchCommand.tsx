"use client"

import { useEffect, useState } from "react"
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command"
import {Button} from "@/components/ui/button";
import {Loader2, TrendingUp, Search} from "lucide-react";
import Link from "next/link";
import {searchStocks} from "@/lib/actions/finnhub.actions";
import {useDebounce} from "@/hooks/useDebounce";

export default function SearchCommand({ renderAs = 'button', label = 'Add stock', initialStocks }: SearchCommandProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(false)
  const [stocks, setStocks] = useState<StockWithWatchlistStatus[]>(initialStocks);

  const isSearchMode = !!searchTerm.trim();
  const displayStocks = isSearchMode ? stocks : stocks?.slice(0, 10);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const handleSearch = async () => {
    if(!isSearchMode) return setStocks(initialStocks);

    setLoading(true)
    try {
        const results = await searchStocks(searchTerm.trim());
        setStocks(results);
    } catch {
      setStocks([])
    } finally {
      setLoading(false)
    }
  }

  const debouncedSearch = useDebounce(handleSearch, 300);

  useEffect(() => {
    debouncedSearch();
  }, [searchTerm]);

  const handleSelectStock = () => {
    setOpen(false);
    setSearchTerm("");
    setStocks(initialStocks);
  }

  return (
    <>
      {renderAs === 'text' ? (
          <span onClick={() => setOpen(true)} className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
            {label}
          </span>
      ) : renderAs === 'icon' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            className="w-full justify-start gap-3 px-3 h-9 hover:bg-secondary/50"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">{label}</span>
            <kbd className="ml-auto text-xs text-muted-foreground/50 font-mono">⌘K</kbd>
          </Button>
      ) : (
          <Button onClick={() => setOpen(true)}>
            {label}
          </Button>
      )}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <div className="flex items-center border-b border-border px-3">
          <CommandInput value={searchTerm} onValueChange={setSearchTerm} placeholder="Search stocks..." className="flex-1 border-0 focus-visible:ring-0" />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
        </div>
        <CommandList>
          {loading ? (
              <CommandEmpty>Loading stocks...</CommandEmpty>
          ) : displayStocks?.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {isSearchMode ? 'No results found' : 'No stocks available'}
              </div>
            ) : (
            <ul>
              <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isSearchMode ? 'Search results' : 'Popular stocks'}
                {` `}({displayStocks?.length || 0})
              </div>
              {displayStocks?.map((stock, i) => (
                  <li key={stock.symbol}>
                    <Link
                        href={`/stocks/${stock.symbol}`}
                        onClick={handleSelectStock}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-secondary/50 transition-colors cursor-pointer"
                    >
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">
                          {stock.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {stock.symbol} | {stock.exchange} | {stock.type}
                        </div>
                      </div>
                    </Link>
                  </li>
              ))}
            </ul>
          )
          }
        </CommandList>
      </CommandDialog>
    </>
  )
}
