"use client";

import {
  useState,
  useEffect,
  useCallback,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import {
  ArrowUpIcon,
  SquareIcon,
  DollarSign,
  Search,
  TrendingUp,
  BarChart3,
  Briefcase,
  GitCompare,
  X,
  Slash,
} from "lucide-react";

// ── Slash command definitions ────────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  icon: FC<{ className?: string }>;
  /** What gets inserted into the composer */
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

// ── Ticker result type ───────────────────────────────────────────────────────

type TickerResult = { symbol: string; description: string };

// ── Composer features config ─────────────────────────────────────────────────

export interface RichComposerFeatures {
  /** Enable slash commands. Default: true */
  slashCommands?: boolean;
  /** Custom slash command list (overrides defaults) */
  commands?: SlashCommand[];
  /** Enable $ticker search. Default: true */
  tickerSearch?: boolean;
  /** Placeholder text. Default: "Send a message…" */
  placeholder?: string;
}

// ── Inline search input for ticker search (within popover) ───────────────────

function TickerSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center border-b px-3">
      <Search className="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      <input
        className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
        placeholder="Search ticker…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export const RichComposer: FC<{ features?: RichComposerFeatures }> = ({
  features = {},
}) => {
  const {
    slashCommands = true,
    commands = DEFAULT_SLASH_COMMANDS,
    tickerSearch = true,
    placeholder = "Send a message…",
  } = features;

  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [currentText, setCurrentText] = useState("");

  // Ticker state
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearchQuery, setTickerSearchQuery] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  const composerRuntime = useComposerRuntime();

  // ── Detect slash command trigger ─────────────────────────────────────────
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setCurrentText(val);

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
    [slashCommands]
  );

  // ── Select a slash command ───────────────────────────────────────────────
  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      setSlashOpen(false);
      setSlashFilter("");
      composerRuntime.setText(cmd.template);
      setCurrentText(cmd.template);
    },
    [composerRuntime]
  );

  // ── Ticker search with debounce ──────────────────────────────────────────
  useEffect(() => {
    if (!tickerOpen || !tickerSearchQuery.trim()) {
      setTickerResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(tickerSearchQuery)}`
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

      // Prefix the ticker in the composer text if not already there
      const text = composerRuntime.getState().text;
      if (!text.includes(`$${sym}`)) {
        composerRuntime.setText(text ? `${text} $${sym} ` : `$${sym} `);
      }

      // Fetch price in background
      try {
        const res = await fetch(
          `/api/quotes?symbols=${encodeURIComponent(sym)}`
        );
        const data = await res.json();
        const price = data.quotes?.[0]?.price ?? null;
        setSelectedTicker({ symbol: sym, price });
      } catch {
        /* keep price null */
      }
    },
    [composerRuntime]
  );

  const clearTicker = useCallback(() => {
    if (selectedTicker) {
      const text = composerRuntime.getState().text;
      composerRuntime.setText(
        text.replace(`$${selectedTicker.symbol} `, "").replace(`$${selectedTicker.symbol}`, "")
      );
      setSelectedTicker(null);
    }
  }, [selectedTicker, composerRuntime]);

  // ── Filtered commands ────────────────────────────────────────────────────
  const filteredCommands = slashFilter
    ? commands.filter(
        (c) =>
          c.name.includes(slashFilter) || c.label.includes(slashFilter)
      )
    : commands;

  const hasChips = selectedTicker != null;

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <div className="flex w-full flex-col rounded-2xl border border-input bg-background outline-none transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20">
        {/* Context chips above input */}
        {hasChips && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {selectedTicker && (
              <Badge
                variant="secondary"
                className="gap-1 font-mono tabular-nums text-xs h-6"
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
            )}
          </div>
        )}

        {/* Main input */}
        <ComposerPrimitive.Input
          placeholder={placeholder}
          className="aui-composer-input mb-1 max-h-32 min-h-14 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
          onChange={handleInputChange}
        />

        {/* Action bar */}
        <div className="relative mx-2 mb-2 flex items-center justify-between">
          {/* Left side: tools */}
          <div className="flex items-center gap-0.5">
            {/* Slash commands trigger */}
            {slashCommands && (
              <Popover open={slashOpen} onOpenChange={setSlashOpen}>
                <PopoverTrigger
                  className={cn(
                    "inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md transition-colors",
                    "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => {
                    if (!slashOpen) {
                      setSlashOpen(true);
                      composerRuntime.setText("/");
                      setCurrentText("/");
                    }
                  }}
                >
                  <Slash className="h-3.5 w-3.5" />
                  <span className="text-xs">Commands</span>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" side="top" align="start">
                  <Command>
                    <CommandList>
                      <CommandEmpty>No commands found</CommandEmpty>
                      <CommandGroup heading="Commands">
                        {filteredCommands.map((cmd) => (
                          <CommandItem
                            key={cmd.name}
                            value={cmd.name}
                            onSelect={() => selectCommand(cmd)}
                            className="gap-2.5"
                          >
                            <cmd.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <span className="font-mono text-xs font-medium">
                                {cmd.label}
                              </span>
                              <p className="text-[11px] text-muted-foreground truncate">
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
                  className={cn(
                    "inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md transition-colors",
                    "hover:bg-muted text-muted-foreground hover:text-foreground font-mono"
                  )}
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>
                    {selectedTicker ? selectedTicker.symbol : "Ticker"}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" side="top" align="start">
                  <TickerSearchInput
                    value={tickerSearchQuery}
                    onChange={setTickerSearchQuery}
                  />
                  <Command>
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
            )}
          </div>

          {/* Right side: send / cancel */}
          <div className="flex items-center gap-1">
            <AuiIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <TooltipIconButton
                  tooltip="Send message"
                  side="bottom"
                  type="button"
                  variant="default"
                  size="icon"
                  className="aui-composer-send size-8 rounded-full"
                  aria-label="Send message"
                >
                  <ArrowUpIcon className="aui-composer-send-icon size-4" />
                </TooltipIconButton>
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="aui-composer-cancel size-8 rounded-full"
                  aria-label="Stop generating"
                >
                  <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
                </Button>
              </ComposerPrimitive.Cancel>
            </AuiIf>
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
};

RichComposer.displayName = "RichComposer";
