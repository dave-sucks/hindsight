"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FC,
  type ReactNode,
} from "react";
import {
  ComposerPrimitive,
  AuiIf,
  useComposerRuntime,
} from "@assistant-ui/react";
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
  IconPlus,
  IconSend,
  IconChartLine,
} from "@tabler/icons-react";
import {
  Search,
  SquareIcon,
  TrendingUp,
  BarChart3,
  Briefcase,
  GitCompare,
  Slash,
  X,
  Loader2,
} from "lucide-react";

// ── Slash command definitions ──────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  icon: FC<{ className?: string }>;
  template: string;
}

const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "research",
    label: "/research",
    description: "Deep-dive research on a ticker",
    icon: Search,
    template: "/research ",
  },
  {
    name: "trade",
    label: "/trade",
    description: "Place a paper trade",
    icon: TrendingUp,
    template: "/trade ",
  },
  {
    name: "portfolio",
    label: "/portfolio",
    description: "Check portfolio status",
    icon: Briefcase,
    template: "/portfolio",
  },
  {
    name: "compare",
    label: "/compare",
    description: "Compare two or more tickers",
    icon: GitCompare,
    template: "/compare ",
  },
  {
    name: "performance",
    label: "/performance",
    description: "View performance report",
    icon: BarChart3,
    template: "/performance",
  },
];

// ── Ticker result type ─────────────────────────────────────────────────────

type TickerResult = { symbol: string; description: string };

// ── Integration type ─────────────────────────────────────────────────────

export interface ComposerIntegration {
  label: string;
  icon: FC<{ className?: string }>;
  enabled: boolean;
  description?: string;
}

// ── Composer features config ───────────────────────────────────────────────

export interface HindsightComposerFeatures {
  /** Enable slash commands. Default: false */
  slashCommands?: boolean;
  /** Custom slash command list (overrides defaults) */
  commands?: SlashCommand[];
  /** Enable $ticker search. Default: false */
  tickerSearch?: boolean;
  /** Show the plus menu. Default: true */
  plusMenu?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Active integrations/sources shown in + menu (like Claude's connectors) */
  integrations?: ComposerIntegration[];
  /** Additional plus menu action items */
  extraMenuItems?: Array<{
    label: string;
    icon: FC<{ size?: number; className?: string }>;
    onClick: () => void;
  }>;
}

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

  // Ticker state
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearchQuery, setTickerSearchQuery] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  const composerRuntime = useComposerRuntime();

  // ── Select a slash command ─────────────────────────────────────────────
  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      composerRuntime.setText(cmd.template);
    },
    [composerRuntime],
  );

  // ── Ticker search with debounce ────────────────────────────────────────
  useEffect(() => {
    if (!tickerOpen || !tickerSearchQuery.trim()) {
      setTickerResults([]);
      setTickerLoading(false);
      return;
    }
    setTickerLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(tickerSearchQuery)}`,
        );
        const data = await res.json();
        setTickerResults(data.results ?? []);
      } catch {
        setTickerResults([]);
      } finally {
        setTickerLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [tickerSearchQuery, tickerOpen]);

  const selectTicker = useCallback(
    async (sym: string) => {
      setTickerOpen(false);
      setTickerSearchQuery("");
      setTickerResults([]);
      setSelectedTicker({ symbol: sym, price: null });

      const text = composerRuntime.getState().text;
      if (!text.includes(`$${sym}`)) {
        composerRuntime.setText(text ? `${text} $${sym} ` : `$${sym} `);
      }

      try {
        const res = await fetch(
          `/api/quotes?symbols=${encodeURIComponent(sym)}`,
        );
        const data = await res.json();
        const price = data.quotes?.[0]?.price ?? null;
        setSelectedTicker({ symbol: sym, price });
      } catch {
        /* keep price null */
      }
    },
    [composerRuntime],
  );

  const clearTicker = useCallback(() => {
    if (selectedTicker) {
      const text = composerRuntime.getState().text;
      composerRuntime.setText(
        text
          .replace(`$${selectedTicker.symbol} `, "")
          .replace(`$${selectedTicker.symbol}`, ""),
      );
      setSelectedTicker(null);
    }
  }, [selectedTicker, composerRuntime]);

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      {/* ─── Main card container ──────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-lg overflow-hidden transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20">
        {/* Context chips above input */}
        {selectedTicker && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            <Badge
              variant="secondary"
              className="gap-1.5 tabular-nums text-xs h-6"
            >
              <StockLogo ticker={selectedTicker.symbol} size="sm" className="h-4 w-4" />
              {selectedTicker.symbol}
              {selectedTicker.price != null && (
                <span className="text-muted-foreground">
                  ${selectedTicker.price.toFixed(2)}
                </span>
              )}
              <button
                type="button"
                onClick={clearTicker}
                className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                aria-label="Remove ticker"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        {/* ─── Textarea ──────────────────────────────────────────────── */}
        <div className="px-3 pt-3 pb-2 grow">
          <ComposerPrimitive.Input
            placeholder={placeholder}
            className="w-full bg-transparent! p-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder-muted-foreground resize-none border-none outline-none text-sm min-h-10 max-h-[25vh]"
            rows={1}
            autoFocus
            aria-label="Message input"
          />
        </div>

        {/* ─── Bottom bar ────────────────────────────────────────────── */}
        <div className="mb-2 px-2 flex items-center justify-between">
          {/* Left side: plus menu + tools */}
          <div className="flex items-center gap-1">
            {/* Plus menu */}
            {plusMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                    />
                  }
                >
                  <IconPlus className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {/* Action items */}
                  {extraMenuItems.length > 0 && (
                    <DropdownMenuGroup>
                      {extraMenuItems.map((item) => (
                        <DropdownMenuItem
                          key={item.label}
                          onClick={item.onClick}
                        >
                          <item.icon size={16} className="opacity-60" />
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  )}

                  {/* Active integrations / sources */}
                  {integrations.length > 0 && (
                    <DropdownMenuGroup>
                      {extraMenuItems.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        Sources
                      </DropdownMenuLabel>
                      {integrations.map((intg) => (
                        <DropdownMenuItem key={intg.label} disabled>
                          <intg.icon className="h-4 w-4 shrink-0 opacity-60" />
                          <span className="text-xs flex-1">{intg.label}</span>
                          <span className={cn(
                            "h-2 w-2 rounded-full shrink-0",
                            intg.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
                          )} />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Slash commands menu */}
            {slashCommands && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                    />
                  }
                >
                  <Slash className="h-3 w-3" />
                  Commands
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  <DropdownMenuGroup>
                    {commands.map((cmd) => (
                      <DropdownMenuItem
                        key={cmd.name}
                        onClick={() => selectCommand(cmd)}
                      >
                        <cmd.icon className="text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">{cmd.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{cmd.description}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Ticker search trigger */}
            {tickerSearch && (
              <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                    />
                  }
                >
                  <IconChartLine className="size-3" />
                  {selectedTicker ? selectedTicker.symbol : "Ticker"}
                </PopoverTrigger>
                <PopoverContent
                  className="w-72 p-0"
                  side="top"
                  align="start"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search stocks…"
                      value={tickerSearchQuery}
                      onValueChange={setTickerSearchQuery}
                    />
                    <CommandList>
                      {tickerLoading ? (
                        <div className="flex items-center justify-center py-6 gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Searching...</span>
                        </div>
                      ) : tickerResults.length === 0 ? (
                        <CommandEmpty>
                          {tickerSearchQuery.trim() ? "No results" : "Type to search stocks"}
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
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium">{r.symbol}</div>
                                <div className="text-xs text-muted-foreground truncate">
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

          {/* Right side: send / cancel */}
          <div>
            <AuiIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label="Send message"
                >
                  <IconSend className="size-3" />
                </Button>
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <Button
                  type="button"
                  variant="default"
                  size="icon-sm"
                  aria-label="Stop generating"
                >
                  <SquareIcon className="size-3 fill-current" />
                </Button>
              </ComposerPrimitive.Cancel>
            </AuiIf>
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
};

HindsightComposer.displayName = "HindsightComposer";
