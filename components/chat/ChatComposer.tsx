"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, X, AtSign, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Shared types ───────────────────────────────────────────────────────────────

export type ComposerContext = {
  ticker: { symbol: string; price: number | null } | null;
  referencedThesis: ComposerRecentThesis | null;
  tradeType: "DAY" | "SWING" | "POSITION";
  direction: "LONG" | "SHORT" | "EITHER";
  model: "gpt-4o" | "gpt-4o-mini" | "o3-mini";
};

export type ComposerRecentThesis = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  createdAt: Date;
};

type TickerResult = { symbol: string; description: string };

// ── ChatComposer ───────────────────────────────────────────────────────────────

export interface ChatComposerProps {
  onSubmit: (message: string, context: ComposerContext) => void | Promise<void>;
  recentTheses?: ComposerRecentThesis[];
  placeholder?: string;
  loading?: boolean;
  className?: string;
}

export function ChatComposer({
  onSubmit,
  recentTheses = [],
  placeholder = "Research any stock…",
  loading = false,
  className,
}: ChatComposerProps) {
  const [input, setInput] = useState("");

  // Ticker state
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  // @Reference state — uses Popover, not Dialog
  const [refOpen, setRefOpen] = useState(false);
  const [referencedThesis, setReferencedThesis] =
    useState<ComposerRecentThesis | null>(null);

  // Config state — wired to real Select controls
  const [model, setModel] = useState<"gpt-4o" | "gpt-4o-mini" | "o3-mini">(
    "gpt-4o"
  );
  const [direction, setDirection] = useState<"LONG" | "SHORT" | "EITHER">(
    "EITHER"
  );
  const [tradeType, setTradeType] = useState<"DAY" | "SWING" | "POSITION">(
    "SWING"
  );

  // Ticker search with debounce
  useEffect(() => {
    if (!tickerOpen || !tickerSearch.trim()) {
      setTickerResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(tickerSearch)}`
        );
        const data = await res.json();
        setTickerResults(data.results ?? []);
      } catch {
        setTickerResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [tickerSearch, tickerOpen]);

  const selectTicker = useCallback(async (sym: string) => {
    setTickerOpen(false);
    setTickerSearch("");
    setTickerResults([]);
    setSelectedTicker({ symbol: sym, price: null });
    try {
      const res = await fetch(
        `/api/quotes?symbols=${encodeURIComponent(sym)}`
      );
      const data = await res.json();
      const price = data.quotes?.[0]?.price ?? null;
      setSelectedTicker({ symbol: sym, price });
    } catch {
      // keep price null
    }
  }, []);

  async function handleSubmit() {
    const msg = input.trim();
    if (!msg || loading) return;

    const ctx: ComposerContext = {
      ticker: selectedTicker,
      referencedThesis,
      tradeType,
      direction,
      model,
    };

    setInput("");
    setSelectedTicker(null);
    setReferencedThesis(null);

    await onSubmit(msg, ctx);
  }

  const hasChips = selectedTicker !== null || referencedThesis !== null;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Main composer box */}
      <div className="rounded-lg border bg-background">
        {/* Context chips — appear inside box when ticker or thesis is selected */}
        {hasChips && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {selectedTicker && (
              <Badge
                variant="secondary"
                className="gap-1 font-mono tabular-nums text-xs h-6"
              >
                ${selectedTicker.symbol}
                {selectedTicker.price !== null && (
                  <span className="text-muted-foreground ml-0.5">
                    ${selectedTicker.price.toFixed(2)}
                  </span>
                )}
                <button
                  onClick={() => setSelectedTicker(null)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                  aria-label="Remove ticker"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {referencedThesis && (
              <Badge variant="secondary" className="gap-1 font-mono text-xs h-6">
                @{referencedThesis.ticker}
                <span
                  className={cn(
                    "ml-0.5 text-xs",
                    referencedThesis.direction === "LONG"
                      ? "text-emerald-500"
                      : referencedThesis.direction === "SHORT"
                      ? "text-red-500"
                      : "text-muted-foreground"
                  )}
                >
                  {referencedThesis.direction}
                </span>
                <button
                  onClick={() => setReferencedThesis(null)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                  aria-label="Remove reference"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        )}

        {/* Textarea — stock shadcn component, no custom overrides */}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={placeholder}
          disabled={loading}
          className="min-h-[72px] max-h-[200px] resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent text-sm"
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-1">
            {/* $Ticker — Popover with live combobox */}
            <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
              <PopoverTrigger
                className={cn(
                  "inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md transition-colors",
                  "hover:bg-muted text-muted-foreground hover:text-foreground font-mono"
                )}
              >
                <span className="font-semibold">$</span>
                <span>
                  {selectedTicker ? selectedTicker.symbol : "Ticker"}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" side="top" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search ticker…"
                    value={tickerSearch}
                    onValueChange={setTickerSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {tickerSearch ? "No results" : "Type to search"}
                    </CommandEmpty>
                    {tickerResults.length > 0 && (
                      <CommandGroup>
                        {tickerResults.map((r, i) => (
                          <CommandItem
                            key={`${r.symbol}-${i}`}
                            value={r.symbol}
                            onSelect={() => selectTicker(r.symbol)}
                          >
                            <span className="font-medium font-mono">
                              {r.symbol}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground truncate">
                              {r.description}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* @Reference — Popover (not Dialog) with thesis combobox */}
            <Popover open={refOpen} onOpenChange={setRefOpen}>
              <PopoverTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors",
                  "hover:bg-muted text-muted-foreground hover:text-foreground",
                  recentTheses.length === 0 && "opacity-40 pointer-events-none"
                )}
                aria-label="Reference a thesis"
              >
                <AtSign className="h-3.5 w-3.5" />
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" side="top" align="start">
                <Command>
                  <CommandInput placeholder="Search past theses…" />
                  <CommandList className="max-h-64">
                    <CommandEmpty>No theses found</CommandEmpty>
                    <CommandGroup>
                      {recentTheses.map((t) => (
                        <CommandItem
                          key={t.id}
                          value={`${t.ticker} ${t.direction}`}
                          onSelect={() => {
                            setReferencedThesis(t);
                            setRefOpen(false);
                          }}
                        >
                          <span className="font-medium font-mono">
                            {t.ticker}
                          </span>
                          <span
                            className={cn(
                              "ml-1.5 text-xs",
                              t.direction === "LONG"
                                ? "text-emerald-500"
                                : t.direction === "SHORT"
                                ? "text-red-500"
                                : "text-muted-foreground"
                            )}
                          >
                            {t.direction}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {t.confidenceScore}% ·{" "}
                            {new Date(t.createdAt).toLocaleDateString()}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Send */}
          <Button
            size="icon"
            className="h-8 w-8 rounded-full"
            disabled={loading || !input.trim()}
            onClick={handleSubmit}
            aria-label="Send"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Secondary config row — real Select controls below the box */}
      <div className="flex items-center gap-1 px-1">
        <Select
          value={model}
          onValueChange={(v) => setModel(v as typeof model)}
        >
          <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent text-muted-foreground hover:text-foreground px-2 min-w-0 w-auto gap-1 focus:ring-0 [&>svg]:opacity-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-4o" className="text-xs">
              GPT-4o
            </SelectItem>
            <SelectItem value="gpt-4o-mini" className="text-xs">
              GPT-4o mini
            </SelectItem>
            <SelectItem value="o3-mini" className="text-xs">
              o3-mini
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={direction}
          onValueChange={(v) => setDirection(v as typeof direction)}
        >
          <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent text-muted-foreground hover:text-foreground px-2 min-w-0 w-auto gap-1 focus:ring-0 [&>svg]:opacity-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EITHER" className="text-xs">
              Any direction
            </SelectItem>
            <SelectItem value="LONG" className="text-xs">
              Long only
            </SelectItem>
            <SelectItem value="SHORT" className="text-xs">
              Short only
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={tradeType}
          onValueChange={(v) => setTradeType(v as typeof tradeType)}
        >
          <SelectTrigger className="h-7 text-xs border-0 shadow-none bg-transparent text-muted-foreground hover:text-foreground px-2 min-w-0 w-auto gap-1 focus:ring-0 [&>svg]:opacity-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DAY" className="text-xs">
              Day trade
            </SelectItem>
            <SelectItem value="SWING" className="text-xs">
              Swing trade
            </SelectItem>
            <SelectItem value="POSITION" className="text-xs">
              Position
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
