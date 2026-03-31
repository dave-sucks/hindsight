"use client";

import { useState, useEffect, useCallback, useRef, type FC } from "react";
import { useComposerRuntime, useThreadRuntime } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { StockLogo } from "@/components/StockLogo";
import { cn } from "@/lib/utils";
import {
  Plus,
  Send,
  Square,
  Slash,
  TrendingUp,
  Search,
  Briefcase,
  GitCompare,
  BarChart3,
  X,
  Loader2,
} from "lucide-react";
import { IconChartLine } from "@tabler/icons-react";

// ── Slash commands ─────────────────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  icon: FC<{ className?: string }>;
  template: string;
}

const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { name: "research",    label: "/research",    description: "Deep-dive research on a ticker", icon: Search,    template: "/research "    },
  { name: "trade",       label: "/trade",       description: "Place a paper trade",            icon: TrendingUp, template: "/trade "       },
  { name: "portfolio",   label: "/portfolio",   description: "Check portfolio status",         icon: Briefcase, template: "/portfolio"     },
  { name: "compare",     label: "/compare",     description: "Compare two or more tickers",   icon: GitCompare, template: "/compare "     },
  { name: "performance", label: "/performance", description: "View performance report",        icon: BarChart3,  template: "/performance"  },
];

// ── Types ──────────────────────────────────────────────────────────────────

export interface ComposerIntegration {
  label: string;
  icon: FC<{ className?: string }>;
  enabled: boolean;
  description?: string;
}

export interface HindsightComposerFeatures {
  slashCommands?: boolean;
  commands?: SlashCommand[];
  tickerSearch?: boolean;
  plusMenu?: boolean;
  placeholder?: string;
  integrations?: ComposerIntegration[];
  extraMenuItems?: Array<{
    label: string;
    icon: FC<{ size?: number; className?: string }>;
    onClick: () => void;
  }>;
}

type TickerResult = { symbol: string; description: string };

// ── Component ──────────────────────────────────────────────────────────────

export const HindsightComposer: FC<{ features?: HindsightComposerFeatures }> = ({
  features = {},
}) => {
  const {
    slashCommands = false,
    commands = DEFAULT_SLASH_COMMANDS,
    tickerSearch = false,
    plusMenu = true,
    placeholder = "Ask anything…",
    integrations = [],
    extraMenuItems = [],
  } = features;

  const composerRuntime = useComposerRuntime();
  const threadRuntime = useThreadRuntime();

  // ── Local state ──────────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track thread running state
  useEffect(() => {
    return threadRuntime.subscribe(() => {
      setIsRunning(threadRuntime.getState().isRunning);
    });
  }, [threadRuntime]);

  // ── Input handlers ────────────────────────────────────────────────────────
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    composerRuntime.setText(val);
  };

  const handleSend = useCallback(() => {
    if (!text.trim() || isRunning) return;
    composerRuntime.send();
    setText("");
  }, [text, isRunning, composerRuntime]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Slash commands ────────────────────────────────────────────────────────
  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      setText(cmd.template);
      composerRuntime.setText(cmd.template);
      textareaRef.current?.focus();
    },
    [composerRuntime],
  );

  // ── Ticker search ─────────────────────────────────────────────────────────
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerQuery, setTickerQuery] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  useEffect(() => {
    if (!tickerOpen || !tickerQuery.trim()) {
      setTickerResults([]);
      setTickerLoading(false);
      return;
    }
    setTickerLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(tickerQuery)}`);
        const data = await res.json();
        setTickerResults(data.results ?? []);
      } catch {
        setTickerResults([]);
      } finally {
        setTickerLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [tickerQuery, tickerOpen]);

  const selectTicker = useCallback(
    async (sym: string) => {
      setTickerOpen(false);
      setTickerQuery("");
      setTickerResults([]);
      setSelectedTicker({ symbol: sym, price: null });
      const newText = text ? `${text} $${sym} ` : `$${sym} `;
      setText(newText);
      composerRuntime.setText(newText);
      textareaRef.current?.focus();
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(sym)}`);
        const data = await res.json();
        setSelectedTicker({ symbol: sym, price: data.quotes?.[0]?.price ?? null });
      } catch { /* keep null */ }
    },
    [text, composerRuntime],
  );

  const clearTicker = useCallback(() => {
    if (!selectedTicker) return;
    const newText = text
      .replace(`$${selectedTicker.symbol} `, "")
      .replace(`$${selectedTicker.symbol}`, "");
    setText(newText);
    composerRuntime.setText(newText);
    setSelectedTicker(null);
  }, [selectedTicker, text, composerRuntime]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border bg-background transition-shadow focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring">
      {/* Ticker chip */}
      {selectedTicker && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          <Badge variant="secondary">
            <StockLogo ticker={selectedTicker.symbol} size="sm" className="h-4 w-4" />
            <span className="tabular-nums">{selectedTicker.symbol}</span>
            {selectedTicker.price != null && (
              <span className="text-muted-foreground tabular-nums">
                ${selectedTicker.price.toFixed(2)}
              </span>
            )}
            <button
              type="button"
              onClick={clearTicker}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove ticker"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent px-3 pt-3 pb-2 text-sm placeholder:text-muted-foreground focus:outline-none"
        aria-label="Message input"
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">

          {/* + menu */}
          {plusMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Add" />}>
                <Plus className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                {extraMenuItems.length > 0 && (
                  <DropdownMenuGroup>
                    {extraMenuItems.map((item) => (
                      <DropdownMenuItem key={item.label} onClick={item.onClick}>
                        <item.icon size={16} />
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                )}
                {integrations.length > 0 && (
                  <DropdownMenuGroup>
                    {extraMenuItems.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>Sources</DropdownMenuLabel>
                    {integrations.map((intg) => (
                      <DropdownMenuItem key={intg.label} disabled>
                        <intg.icon className="size-4 opacity-60" />
                        <span className="flex-1 text-xs">{intg.label}</span>
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            intg.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
                          )}
                        />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Slash commands */}
          {slashCommands && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                <Slash className="size-3" />
                Commands
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuGroup>
                  {commands.map((cmd) => (
                    <DropdownMenuItem key={cmd.name} onClick={() => selectCommand(cmd)}>
                      <cmd.icon className="opacity-60" />
                      <span className="font-medium">{cmd.label}</span>
                      <span className="text-xs text-muted-foreground">{cmd.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Ticker popover */}
          {tickerSearch && (
            <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
              <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
                <IconChartLine className="size-3" />
                {selectedTicker ? selectedTicker.symbol : "Ticker"}
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="p-0">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search stocks…"
                    value={tickerQuery}
                    onValueChange={setTickerQuery}
                  />
                  <CommandList>
                    {tickerLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Searching…</span>
                      </div>
                    ) : tickerResults.length === 0 ? (
                      <CommandEmpty>
                        {tickerQuery.trim() ? "No results" : "Type to search stocks"}
                      </CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {tickerResults.map((r, i) => (
                          <CommandItem
                            key={`${r.symbol}-${i}`}
                            value={r.symbol}
                            onSelect={() => selectTicker(r.symbol)}
                          >
                            <StockLogo ticker={r.symbol} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">{r.symbol}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {r.description}
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Send / Stop */}
        {isRunning ? (
          <Button
            size="icon-sm"
            onClick={() => threadRuntime.interrupt?.()}
            aria-label="Stop"
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            disabled={!text.trim()}
            onClick={handleSend}
            aria-label="Send"
          >
            <Send className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
};

HindsightComposer.displayName = "HindsightComposer";
