"use client";

import { useState, useEffect, useCallback, useRef, type FC, type ComponentType } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { StockLogo } from "@/components/StockLogo";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hooks/useDebounce";
import {
  Plus,
  Send,
  Square,
  Slash,
  Check,
  X,
  Loader2,
  Globe,
  BarChart3,
  TrendingUp,
  FileText,
  Brain,
  Briefcase,
  History,
  ArrowRight,
  Search,
  GitCompare,
  ChevronsUpDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  template: string;
}

export interface HindsightComposerFeatures {
  slashCommands?: boolean;
  commands?: SlashCommand[];
  tickerSearch?: boolean;
  plusMenu?: boolean;
  placeholder?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { name: "research",    label: "/research",    icon: Search,      template: "/research "    },
  { name: "trade",       label: "/trade",       icon: TrendingUp,  template: "/trade "       },
  { name: "compare",     label: "/compare",     icon: GitCompare,  template: "/compare "     },
  { name: "portfolio",   label: "/portfolio",   icon: Briefcase,   template: "/portfolio"    },
  { name: "performance", label: "/performance", icon: BarChart3,   template: "/performance"  },
];

const DEFAULT_STOCKS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "TSLA", name: "Tesla Inc." },
];

const CAPABILITIES = [
  {
    group: "Live Data",
    items: [
      {
        label: "Web Search",
        description: "Live internet search via Perplexity Sonar — finds breaking news, earnings releases, and market-moving events in real time.",
        logo: "https://www.google.com/s2/favicons?domain=perplexity.ai&sz=32",
        icon: Globe,
      },
      {
        label: "Market Data",
        description: "Real-time quotes, earnings calendars, company metrics and news via Finnhub. Used for every stock lookup and price check.",
        logo: "https://www.google.com/s2/favicons?domain=finnhub.io&sz=32",
        icon: BarChart3,
      },
      {
        label: "Options Flow",
        description: "Put/call ratios and unusual contract activity via Financial Modeling Prep — surfaces institutional positioning signals.",
        logo: "https://www.google.com/s2/favicons?domain=financialmodelingprep.com&sz=32",
        icon: TrendingUp,
      },
      {
        label: "SEC Filings",
        description: "10-K, 10-Q, 8-K and Form 4 filings pulled directly from SEC EDGAR — insider activity, earnings, and risk disclosures.",
        logo: "https://www.google.com/s2/favicons?domain=sec.gov&sz=32",
        icon: FileText,
      },
      {
        label: "Web Extraction",
        description: "Full article and document extraction via Firecrawl — pulls complete content from any URL behind signals and headlines.",
        logo: "https://www.google.com/s2/favicons?domain=firecrawl.dev&sz=32",
        icon: Globe,
      },
    ],
  },
  {
    group: "Agent Intelligence",
    items: [
      {
        label: "Morning Brief",
        description: "Pre-market intelligence generated nightly — firm-wide market sweep, signal routing, and analyst-specific insights ready before the open.",
        logo: "https://www.google.com/s2/favicons?domain=openai.com&sz=32",
        icon: Brain,
      },
      {
        label: "Portfolio Context",
        description: "Live Alpaca paper positions, P&L, and open orders injected into every agent run so it knows what you already hold.",
        logo: "https://www.google.com/s2/favicons?domain=alpaca.markets&sz=32",
        icon: Briefcase,
      },
      {
        label: "Performance History",
        description: "Past trade outcomes, win rates, and weekly calibration reports — the agent uses these to tune confidence thresholds and sizing.",
        logo: null,
        icon: History,
      },
      {
        label: "Paper Trading",
        description: "Live market orders via Alpaca paper trading — the agent places, tracks, and closes positions automatically based on its theses.",
        logo: "https://www.google.com/s2/favicons?domain=alpaca.markets&sz=32",
        icon: TrendingUp,
      },
    ],
  },
];

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
  } = features;

  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const canSend = useAuiState((s) => s.composer.canSend);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Input sync ────────────────────────────────────────────────────────────
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    aui.composer().setText(e.target.value);
  };

  const handleSend = useCallback(() => {
    if (!canSend || isRunning) return;
    aui.composer().send();
  }, [canSend, isRunning, aui]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Slash commands ────────────────────────────────────────────────────────
  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      aui.composer().setText(cmd.template);
      textareaRef.current?.focus();
    },
    [aui],
  );

  // ── Ticker search ─────────────────────────────────────────────────────────
  const [tickerOpen, setTickerOpen] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerQuery, setTickerQuery] = useState("");
  const [tickerResults, setTickerResults] = useState<{ symbol: string; name: string }[]>(DEFAULT_STOCKS);
  const [tickerLoading, setTickerLoading] = useState(false);

  const handleTickerSearch = useCallback(async () => {
    if (!tickerQuery.trim()) {
      setTickerResults(DEFAULT_STOCKS);
      return;
    }
    setTickerLoading(true);
    try {
      const results = await searchStocks(tickerQuery.trim());
      setTickerResults(results.map((r) => ({ symbol: r.symbol, name: r.name })));
    } catch {
      setTickerResults([]);
    } finally {
      setTickerLoading(false);
    }
  }, [tickerQuery]);

  const debouncedTickerSearch = useDebounce(handleTickerSearch, 300);

  useEffect(() => {
    debouncedTickerSearch();
  }, [tickerQuery]);

  const selectTicker = useCallback(
    (symbol: string) => {
      setSelectedTicker(symbol === selectedTicker ? null : symbol);
      setTickerOpen(false);
      setTickerQuery("");
      const newText = text ? `${text} $${symbol} ` : `$${symbol} `;
      aui.composer().setText(newText);
      textareaRef.current?.focus();
    },
    [text, aui, selectedTicker],
  );

  const clearTicker = useCallback(() => {
    if (!selectedTicker) return;
    const newText = text
      .replace(`$${selectedTicker} `, "")
      .replace(`$${selectedTicker}`, "");
    aui.composer().setText(newText);
    setSelectedTicker(null);
  }, [selectedTicker, text, aui]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <InputGroup className="w-full">
      {/* Ticker chip — block-start addon */}
      {selectedTicker && (
        <InputGroupAddon align="block-start">
          <Badge variant="secondary" className="gap-1">
            <StockLogo ticker={selectedTicker} size="sm" className="size-4" />
            <span className="tabular-nums">{selectedTicker}</span>
            <button
              type="button"
              onClick={clearTicker}
              className="ml-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Remove ticker"
            >
              <X className="size-3" />
            </button>
          </Badge>
        </InputGroupAddon>
      )}

      {/* Textarea */}
      <InputGroupTextarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        aria-label="Message input"
      />

      {/* Bottom toolbar — block-end addon */}
      <InputGroupAddon align="block-end">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1">

            {/* + Capabilities menu */}
            {plusMenu && (
              <TooltipProvider>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DropdownMenuTrigger
                          render={<Button variant="outline" size="icon-sm" aria-label="Capabilities" />}
                        />
                      }
                    >
                      <Plus className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent side="top">Capabilities</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" side="top" className="w-60">
                    {CAPABILITIES.map((group, gi) => (
                      <DropdownMenuGroup key={group.group}>
                        {gi > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
                        {group.items.map((item) => (
                          <Tooltip key={item.label}>
                            <TooltipTrigger render={<DropdownMenuItem />}>
                              {item.logo ? (
                                <img
                                  src={item.logo}
                                  alt=""
                                  width={16}
                                  height={16}
                                  className="size-4 rounded-sm object-contain"
                                />
                              ) : (
                                <item.icon className="size-4" />
                              )}
                              {item.label}
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {item.description}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </DropdownMenuGroup>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => window.location.href = "/agent-workflow"}>
                        <ArrowRight className="size-4" />
                        View all capabilities
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipProvider>
            )}

            {/* Slash commands */}
            {slashCommands && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" aria-label="Commands" />}
                >
                  <Slash className="size-3" />
                  Commands
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-44">
                  <DropdownMenuGroup>
                    {commands.map((cmd) => (
                      <DropdownMenuItem key={cmd.name} onClick={() => selectCommand(cmd)}>
                        <cmd.icon className="size-4" />
                        {cmd.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Ticker combobox */}
            {tickerSearch && (
              <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={tickerOpen}
                    />
                  }
                >
                  {selectedTicker ?? "Stocks"}
                  <ChevronsUpDown className="opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="p-0">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search stocks…"
                      value={tickerQuery}
                      onValueChange={setTickerQuery}
                    />
                    <CommandList>
                      {tickerLoading ? (
                        <div className="flex items-center justify-center gap-2 py-6">
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Searching…</span>
                        </div>
                      ) : (
                        <>
                          <CommandEmpty>No stocks found.</CommandEmpty>
                          <CommandGroup>
                            {tickerResults.map((stock) => (
                              <CommandItem
                                key={stock.symbol}
                                value={stock.symbol}
                                onSelect={() => selectTicker(stock.symbol)}
                              >
                                <StockLogo ticker={stock.symbol} size="sm" />
                                <span className="font-medium">{stock.symbol}</span>
                                <span className="text-muted-foreground truncate">{stock.name}</span>
                                <Check
                                  className={selectedTicker === stock.symbol ? "ml-auto opacity-100" : "ml-auto opacity-0"}
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
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
              onClick={() => aui.composer().cancel()}
              aria-label="Stop"
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={handleSend}
              aria-label="Send"
            >
              <Send className="size-3" />
            </Button>
          )}
        </div>
      </InputGroupAddon>
    </InputGroup>
  );
};

HindsightComposer.displayName = "HindsightComposer";
