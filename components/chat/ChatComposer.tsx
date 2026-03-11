"use client";

import type { ChatStatus } from "ai";
import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
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
import { X, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

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
  /** @deprecated Prefer `status` for richer state. Falls back to "submitted" when true. */
  loading?: boolean;
  status?: ChatStatus;
  className?: string;
}

export function ChatComposer({
  onSubmit,
  recentTheses = [],
  placeholder = "Research any stock\u2026",
  loading = false,
  status: statusProp,
  className,
}: ChatComposerProps) {
  // Shadow state — tracks textarea value for disabled-submit check.
  // Textarea is uncontrolled (PromptInput owns it via form.reset()).
  const [input, setInput] = useState("");

  // Ticker state
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  // @Reference state
  const [refOpen, setRefOpen] = useState(false);
  const [referencedThesis, setReferencedThesis] =
    useState<ComposerRecentThesis | null>(null);

  // Config state
  const [model, setModel] = useState<"gpt-4o" | "gpt-4o-mini" | "o3-mini">(
    "gpt-4o"
  );
  const [direction, setDirection] = useState<"LONG" | "SHORT" | "EITHER">(
    "EITHER"
  );
  const [tradeType, setTradeType] = useState<"DAY" | "SWING" | "POSITION">(
    "SWING"
  );

  const chatStatus: ChatStatus | undefined =
    statusProp ?? (loading ? "submitted" : undefined);

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

  const handlePromptInputSubmit = useCallback(
    async (msg: PromptInputMessage) => {
      const text = msg.text.trim();
      if (!text || loading) return;

      const ctx: ComposerContext = {
        ticker: selectedTicker,
        referencedThesis,
        tradeType,
        direction,
        model,
      };

      // Clear context chips optimistically (PromptInput clears textarea via form.reset)
      setInput("");
      setSelectedTicker(null);
      setReferencedThesis(null);

      await onSubmit(text, ctx);
    },
    [selectedTicker, referencedThesis, tradeType, direction, model, loading, onSubmit]
  );

  const hasChips = selectedTicker !== null || referencedThesis !== null;

  return (
    <div className={cn("space-y-2", className)}>
      <PromptInput onSubmit={handlePromptInputSubmit}>
        {/* Context chips — ticker and thesis reference badges */}
        {hasChips && (
          <PromptInputHeader>
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
                  type="button"
                  onClick={() => setSelectedTicker(null)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                  aria-label="Remove ticker"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {referencedThesis && (
              <Badge
                variant="secondary"
                className="gap-1 font-mono text-xs h-6"
              >
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
                  type="button"
                  onClick={() => setReferencedThesis(null)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                  aria-label="Remove reference"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </PromptInputHeader>
        )}

        <PromptInputTextarea
          placeholder={placeholder}
          disabled={loading}
          onChange={(e) => setInput(e.target.value)}
        />

        <PromptInputFooter>
          <PromptInputTools>
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
                    placeholder="Search ticker\u2026"
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

            {/* @Reference — Popover with thesis combobox */}
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
                  <CommandInput placeholder="Search past theses\u2026" />
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
          </PromptInputTools>

          <PromptInputSubmit
            status={chatStatus}
            disabled={loading || !input.trim()}
          />
        </PromptInputFooter>
      </PromptInput>

      {/* Secondary config row — PromptInputSelect controls below the box */}
      <div className="flex items-center gap-1 px-1">
        <PromptInputSelect
          value={model}
          onValueChange={(v) => setModel(v as typeof model)}
        >
          <PromptInputSelectTrigger className="h-7 text-xs px-2 min-w-0 w-auto gap-1 [&>svg]:opacity-50">
            <PromptInputSelectValue />
          </PromptInputSelectTrigger>
          <PromptInputSelectContent>
            <PromptInputSelectItem value="gpt-4o" className="text-xs">
              GPT-4o
            </PromptInputSelectItem>
            <PromptInputSelectItem value="gpt-4o-mini" className="text-xs">
              GPT-4o mini
            </PromptInputSelectItem>
            <PromptInputSelectItem value="o3-mini" className="text-xs">
              o3-mini
            </PromptInputSelectItem>
          </PromptInputSelectContent>
        </PromptInputSelect>

        <PromptInputSelect
          value={direction}
          onValueChange={(v) => setDirection(v as typeof direction)}
        >
          <PromptInputSelectTrigger className="h-7 text-xs px-2 min-w-0 w-auto gap-1 [&>svg]:opacity-50">
            <PromptInputSelectValue />
          </PromptInputSelectTrigger>
          <PromptInputSelectContent>
            <PromptInputSelectItem value="EITHER" className="text-xs">
              Any direction
            </PromptInputSelectItem>
            <PromptInputSelectItem value="LONG" className="text-xs">
              Long only
            </PromptInputSelectItem>
            <PromptInputSelectItem value="SHORT" className="text-xs">
              Short only
            </PromptInputSelectItem>
          </PromptInputSelectContent>
        </PromptInputSelect>

        <PromptInputSelect
          value={tradeType}
          onValueChange={(v) => setTradeType(v as typeof tradeType)}
        >
          <PromptInputSelectTrigger className="h-7 text-xs px-2 min-w-0 w-auto gap-1 [&>svg]:opacity-50">
            <PromptInputSelectValue />
          </PromptInputSelectTrigger>
          <PromptInputSelectContent>
            <PromptInputSelectItem value="DAY" className="text-xs">
              Day trade
            </PromptInputSelectItem>
            <PromptInputSelectItem value="SWING" className="text-xs">
              Swing trade
            </PromptInputSelectItem>
            <PromptInputSelectItem value="POSITION" className="text-xs">
              Position
            </PromptInputSelectItem>
          </PromptInputSelectContent>
        </PromptInputSelect>
      </div>
    </div>
  );
}
