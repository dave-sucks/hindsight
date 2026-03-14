"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FC,
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
import { cn } from "@/lib/utils";
import {
  IconPlus,
  IconSend,
  IconWorld,
  IconPaperclip,
  IconWand,
  IconChartLine,
} from "@tabler/icons-react";
import {
  DollarSign,
  Search,
  SquareIcon,
  TrendingUp,
  BarChart3,
  Briefcase,
  GitCompare,
  Slash,
  X,
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

// ── Composer features config ───────────────────────────────────────────────

export interface HindsightComposerFeatures {
  /** Enable slash commands. Default: false */
  slashCommands?: boolean;
  /** Custom slash command list (overrides defaults) */
  commands?: SlashCommand[];
  /** Enable $ticker search. Default: false */
  tickerSearch?: boolean;
  /** Show the plus menu with attach/web search options. Default: true */
  plusMenu?: boolean;
  /** Show auto mode toggle. Default: false */
  autoMode?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Additional plus menu items */
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
    autoMode: showAutoMode = false,
    placeholder = "Ask anything…",
    extraMenuItems = [],
  } = features;

  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");

  // Ticker state
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearchQuery, setTickerSearchQuery] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  // Auto mode state
  const [autoModeActive, setAutoModeActive] = useState(false);

  const composerRuntime = useComposerRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Detect slash command trigger ───────────────────────────────────────
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;

      if (slashCommands) {
        if (val.startsWith("/") && !val.includes(" ")) {
          setSlashOpen(true);
          setSlashFilter(val.slice(1).toLowerCase());
        } else {
          setSlashOpen(false);
          setSlashFilter("");
        }
      }
    },
    [slashCommands],
  );

  // ── Select a slash command ─────────────────────────────────────────────
  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      setSlashOpen(false);
      setSlashFilter("");
      composerRuntime.setText(cmd.template);
    },
    [composerRuntime],
  );

  // ── Ticker search with debounce ────────────────────────────────────────
  useEffect(() => {
    if (!tickerOpen || !tickerSearchQuery.trim()) {
      setTickerResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(tickerSearchQuery)}`,
        );
        const data = await res.json();
        setTickerResults(data.results ?? []);
      } catch {
        setTickerResults([]);
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

  const filteredCommands = slashFilter
    ? commands.filter(
        (c) =>
          c.name.includes(slashFilter) || c.label.includes(slashFilter),
      )
    : commands;

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={() => {}}
      />

      {/* ─── Main card container ──────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-lg overflow-hidden transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20">
        {/* Context chips above input */}
        {selectedTicker && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            <Badge
              variant="secondary"
              className="gap-1 tabular-nums text-xs h-6"
            >
              <DollarSign className="h-3 w-3" />
              {selectedTicker.symbol}
              {selectedTicker.price != null && (
                <span className="text-muted-foreground ml-0.5">
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
            onChange={handleInputChange}
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
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <IconPaperclip size={16} className="opacity-60" />
                      Attach Files
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        const text = composerRuntime.getState().text;
                        composerRuntime.setText(
                          text
                            ? `${text}\n[Search the web for latest news]`
                            : "Search the web for latest news on ",
                        );
                      }}
                    >
                      <IconWorld size={16} className="opacity-60" />
                      Web Search
                    </DropdownMenuItem>
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
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Auto mode toggle */}
            {showAutoMode && (
              <Button
                variant={autoModeActive ? "secondary" : "outline"}
                size="sm"
                onClick={() => setAutoModeActive(!autoModeActive)}
              >
                <IconWand className="size-3" />
                Auto
              </Button>
            )}

            {/* Slash commands trigger */}
            {slashCommands && (
              <Popover open={slashOpen} onOpenChange={setSlashOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!slashOpen) {
                          setSlashOpen(true);
                          composerRuntime.setText("/");
                        }
                      }}
                    />
                  }
                >
                  <Slash className="h-3 w-3" />
                  Commands
                </PopoverTrigger>
                <PopoverContent
                  className="w-64 p-0"
                  side="top"
                  align="start"
                >
                  <Command>
                    <CommandList>
                      <CommandEmpty>No commands found</CommandEmpty>
                      <CommandGroup heading="Commands">
                        {filteredCommands.map((cmd) => (
                          <CommandItem
                            key={cmd.name}
                            value={cmd.name}
                            onSelect={() => selectCommand(cmd)}
                          >
                            <cmd.icon className="text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <span className="text-sm font-medium">
                                {cmd.label}
                              </span>
                              <p className="text-xs text-muted-foreground truncate">
                                {cmd.description}
                              </p>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
                  className="w-64 p-0"
                  side="top"
                  align="start"
                >
                  <Command>
                    <CommandInput
                      placeholder="Search ticker…"
                      value={tickerSearchQuery}
                      onValueChange={setTickerSearchQuery}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {tickerSearchQuery ? "No results" : "Type to search"}
                      </CommandEmpty>
                      {tickerResults.length > 0 && (
                        <CommandGroup>
                          {tickerResults.map((r, i) => (
                            <CommandItem
                              key={`${r.symbol}-${i}`}
                              value={r.symbol}
                              onSelect={() => selectTicker(r.symbol)}
                            >
                              <span className="font-medium">
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
