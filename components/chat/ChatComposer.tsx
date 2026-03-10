"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, X, AtSign, SlidersHorizontal, Loader2 } from "lucide-react";

// ── Shared types ───────────────────────────────────────────────────────────────

/** Context attached to a chat message — ticker, reference thesis, and trade config. */
export type ComposerContext = {
  ticker: { symbol: string; price: number | null } | null;
  referencedThesis: ComposerRecentThesis | null;
  tradeType: "DAY" | "SWING" | "POSITION";
  direction: "LONG" | "SHORT" | "EITHER";
};

/** A past thesis that can be @-referenced in the composer. */
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
  /** Called when the user submits a message. */
  onSubmit: (message: string, context: ComposerContext) => void | Promise<void>;
  /** Past theses available for @-reference. */
  recentTheses?: ComposerRecentThesis[];
  placeholder?: string;
  /** When true, the send button shows a spinner and the textarea is disabled. */
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Ticker
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  // @Reference
  const [refOpen, setRefOpen] = useState(false);
  const [referencedThesis, setReferencedThesis] =
    useState<ComposerRecentThesis | null>(null);

  // Options
  const [tradeType, setTradeType] = useState<"DAY" | "SWING" | "POSITION">(
    "SWING"
  );
  const [direction, setDirection] = useState<"LONG" | "SHORT" | "EITHER">(
    "EITHER"
  );
  const optionsChanged = tradeType !== "SWING" || direction !== "EITHER";

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Ticker search debounce
  useEffect(() => {
    if (!tickerOpen) return;
    if (!tickerSearch.trim()) {
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
    };

    // Reset immediately so the UI feels snappy
    setInput("");
    setSelectedTicker(null);
    setReferencedThesis(null);

    await onSubmit(msg, ctx);
  }

  const hasChips = selectedTicker !== null || referencedThesis !== null;

  return (
    <>
      <div className={className}>
        <div className="rounded-xl border bg-card shadow-sm">
          {/* Context chips */}
          {hasChips && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {selectedTicker && (
                <span className="flex items-center gap-1 text-xs bg-muted rounded-full px-3 py-1 font-medium tabular-nums">
                  <span className="font-mono">${selectedTicker.symbol}</span>
                  {selectedTicker.price !== null && (
                    <span className="text-muted-foreground ml-1">
                      ${selectedTicker.price.toFixed(2)}
                    </span>
                  )}
                  <button
                    onClick={() => setSelectedTicker(null)}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    aria-label="Remove ticker"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {referencedThesis && (
                <span className="flex items-center gap-1 text-xs bg-muted rounded-full px-3 py-1 font-medium">
                  <span className="font-mono">@{referencedThesis.ticker}</span>
                  <span
                    className={`text-xs ml-1 ${
                      referencedThesis.direction === "LONG"
                        ? "text-emerald-500"
                        : referencedThesis.direction === "SHORT"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    {referencedThesis.direction}
                  </span>
                  <button
                    onClick={() => setReferencedThesis(null)}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    aria-label="Remove reference"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          )}

          {/* Textarea */}
          <div className="px-3 pt-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={placeholder}
              rows={2}
              disabled={loading}
              className="w-full resize-none bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground leading-relaxed overflow-hidden disabled:opacity-50"
              style={{ minHeight: "48px", maxHeight: "200px" }}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <div className="flex items-center gap-1">
              {/* $Ticker popover */}
              <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
                <PopoverTrigger className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground font-mono rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                  <span className="font-semibold not-italic">$</span>
                  <span>{selectedTicker ? selectedTicker.symbol : "Ticker"}</span>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
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
                          {tickerResults.map((r) => (
                            <CommandItem
                              key={r.symbol}
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

              {/* @Reference button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setRefOpen(true)}
                disabled={recentTheses.length === 0}
                title={
                  recentTheses.length === 0
                    ? "No past theses to reference"
                    : "Reference a past thesis"
                }
              >
                <AtSign className="h-3.5 w-3.5" />
              </Button>

              {/* Options dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="relative inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  title="Trade options"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {optionsChanged && (
                    <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs">
                      Options
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="text-xs">
                      Trade type
                      <span className="ml-auto text-muted-foreground">
                        {tradeType}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={tradeType}
                        onValueChange={(v) =>
                          setTradeType(v as "DAY" | "SWING" | "POSITION")
                        }
                      >
                        {(["DAY", "SWING", "POSITION"] as const).map((t) => (
                          <DropdownMenuRadioItem
                            key={t}
                            value={t}
                            className="text-xs"
                          >
                            {t}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="text-xs">
                      Direction
                      <span className="ml-auto text-muted-foreground">
                        {direction}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={direction}
                        onValueChange={(v) =>
                          setDirection(v as "LONG" | "SHORT" | "EITHER")
                        }
                      >
                        {(["LONG", "SHORT", "EITHER"] as const).map((d) => (
                          <DropdownMenuRadioItem
                            key={d}
                            value={d}
                            className="text-xs"
                          >
                            {d}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Send button */}
            <Button
              size="sm"
              className="h-8 w-8 rounded-full p-0"
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
      </div>

      {/* @Reference Dialog */}
      <Dialog open={refOpen} onOpenChange={setRefOpen}>
        <DialogContent className="max-w-sm p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="text-sm font-medium">
              Reference a past thesis
            </DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search theses…" />
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
                    <span className="font-medium font-mono">{t.ticker}</span>
                    <span
                      className={`ml-1.5 text-xs ${
                        t.direction === "LONG"
                          ? "text-emerald-500"
                          : t.direction === "SHORT"
                          ? "text-red-500"
                          : "text-muted-foreground"
                      }`}
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
        </DialogContent>
      </Dialog>
    </>
  );
}
