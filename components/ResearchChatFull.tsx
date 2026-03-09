"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { triggerResearchRun } from "@/lib/actions/research.actions";
import { toast } from "sonner";
import { ArrowUp, X, AtSign, SlidersHorizontal } from "lucide-react";
import { RunResearchButton } from "@/components/RunResearchButton";

// ---- Types ------------------------------------------------------------------

type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "token"; text: string }
  | { type: "complete"; thesis: ThesisOutput }
  | { type: "error"; text: string };

type ThesisOutput = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: string;
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  signal_types: string[];
  sector: string | null;
  model_used: string;
};

type Message =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      status: "thinking" | "streaming" | "done" | "error";
      thinkingText?: string;
      streamedText?: string;
      thesis?: ThesisOutput;
      errorText?: string;
    };

type RecentThesis = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  createdAt: Date;
};

type TickerResult = { symbol: string; description: string };

const SUGGESTIONS = [
  "Research NVDA for a swing trade",
  "What sectors look strong this week?",
  "Is AAPL a buy at current levels?",
];

// ---- Main Component ---------------------------------------------------------

export default function ResearchChatFull({
  userId,
  recentTheses,
  hasRunning,
}: {
  userId: string;
  recentTheses: RecentThesis[];
  hasRunning: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Input config state
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState("");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<{
    symbol: string;
    price: number | null;
  } | null>(null);

  const [refOpen, setRefOpen] = useState(false);
  const [referencedThesis, setReferencedThesis] = useState<RecentThesis | null>(null);

  const [tradeType, setTradeType] = useState<"DAY" | "SWING" | "POSITION">("SWING");
  const [direction, setDirection] = useState<"LONG" | "SHORT" | "EITHER">("EITHER");
  const optionsChanged = tradeType !== "SWING" || direction !== "EITHER";

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(sym)}`);
      const data = await res.json();
      const price = data.quotes?.[0]?.price ?? null;
      setSelectedTicker({ symbol: sym, price });
    } catch {
      // keep price null
    }
  }, []);

  function buildMessage(raw: string): string {
    const parts: string[] = [];

    // Context prefix
    const contextParts: string[] = [];
    if (tradeType !== "SWING" || direction !== "EITHER") {
      contextParts.push(`${tradeType}${direction !== "EITHER" ? ` ${direction}` : ""}`);
    }
    if (selectedTicker) {
      contextParts.push(selectedTicker.symbol);
    }
    if (contextParts.length > 0) {
      parts.push(`[Research context: ${contextParts.join(", ")}]`);
    }

    // @-reference
    if (referencedThesis) {
      parts.push(
        `Re this research on ${referencedThesis.ticker} (${new Date(referencedThesis.createdAt).toLocaleDateString()}): ${referencedThesis.reasoningSummary}`
      );
      parts.push("");
    }

    parts.push(raw);
    return parts.join("\n");
  }

  async function handleSubmit(rawMsg?: string) {
    const msg = (rawMsg ?? input).trim();
    if (!msg || busy) return;

    setInput("");
    setBusy(true);

    const fullMessage = buildMessage(msg);

    // Optimistic user bubble (show original message, not context-prefixed)
    setMessages((prev) => [...prev, { role: "user", text: msg }]);

    const assistantIdx = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      { role: "assistant", status: "thinking", thinkingText: "Starting research..." },
    ]);

    // Clear selections after send
    const savedTicker = selectedTicker?.symbol;
    setSelectedTicker(null);
    setReferencedThesis(null);

    try {
      const res = await fetch("/api/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: fullMessage }),
      });

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalThesis: ThesisOutput | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event: StreamEvent = JSON.parse(line.slice(5).trim());

            if (event.type === "thinking") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({ ...m, status: "thinking", thinkingText: event.text } as Message)
                    : m
                )
              );
            } else if (event.type === "token") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({
                        ...m,
                        status: "streaming",
                        streamedText:
                          ((m as { streamedText?: string }).streamedText ?? "") +
                          event.text,
                      } as Message)
                    : m
                )
              );
            } else if (event.type === "complete") {
              finalThesis = event.thesis;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({ ...m, status: "done", thesis: event.thesis } as Message)
                    : m
                )
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({ ...m, status: "error", errorText: event.text } as Message)
                    : m
                )
              );
            }
          } catch {
            // malformed SSE line
          }
        }
      }

      if (finalThesis && finalThesis.direction !== "PASS" && userId) {
        try {
          await triggerResearchRun(userId, [finalThesis.ticker], "MANUAL");
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === assistantIdx
            ? ({
                ...m,
                status: "error",
                errorText: err instanceof Error ? err.message : "Unknown error",
              } as Message)
            : m
        )
      );
      toast.error("Research failed");
    } finally {
      setBusy(false);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100dvh-5.25rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <h1 className="text-lg font-medium">Research</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/research/history"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View History →
          </Link>
          <RunResearchButton hasRunning={hasRunning} />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 pb-32 px-4">
            <div className="text-center">
              <h2 className="text-2xl font-semibold">Hindsight Research</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Ask the AI to research any stock
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s)}
                  className="text-xs border border-border rounded-full px-4 py-2 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full space-y-6 px-4 py-6 pb-44">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2 text-sm max-w-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <AssistantMessage key={i} msg={msg} />
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input dock */}
      <div className="shrink-0 pb-6 px-4">
        <div className="max-w-2xl mx-auto w-full">
          <Card className="rounded-2xl shadow-lg border">
            {/* Chips row */}
            {(selectedTicker || referencedThesis) && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {selectedTicker && (
                  <span className="flex items-center gap-1 text-xs bg-muted rounded-full px-3 py-1 font-medium tabular-nums">
                    ${selectedTicker.symbol}
                    {selectedTicker.price !== null && (
                      <span className="text-muted-foreground ml-1">
                        ${selectedTicker.price.toFixed(2)}
                      </span>
                    )}
                    <button
                      onClick={() => setSelectedTicker(null)}
                      className="ml-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {referencedThesis && (
                  <span className="flex items-center gap-1 text-xs bg-muted rounded-full px-3 py-1 font-medium">
                    @{referencedThesis.ticker}{" "}
                    <span className="text-muted-foreground">
                      {referencedThesis.direction}
                    </span>
                    <button
                      onClick={() => setReferencedThesis(null)}
                      className="ml-1 text-muted-foreground hover:text-foreground"
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
                placeholder="Research NVDA for a swing trade..."
                rows={2}
                disabled={busy}
                className="w-full resize-none bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground leading-relaxed overflow-hidden disabled:opacity-50"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <div className="flex items-center gap-1">
                {/* Ticker combobox */}
                <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
                  <PopoverTrigger className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                    <span className="font-semibold">$</span>
                    {selectedTicker ? selectedTicker.symbol : "Ticker"}
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search ticker..."
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
                                <span className="font-medium">{r.symbol}</span>
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

                {/* @-reference */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setRefOpen(true)}
                  disabled={recentTheses.length === 0}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>

                {/* Options */}
                <DropdownMenu>
                  <DropdownMenuTrigger className="relative inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {optionsChanged && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    <DropdownMenuLabel className="text-xs">Options</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs">
                        Trade type
                        <span className="ml-auto text-muted-foreground">{tradeType}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={tradeType}
                          onValueChange={(v) =>
                            setTradeType(v as "DAY" | "SWING" | "POSITION")
                          }
                        >
                          {["DAY", "SWING", "POSITION"].map((t) => (
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
                        <span className="ml-auto text-muted-foreground">{direction}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={direction}
                          onValueChange={(v) =>
                            setDirection(v as "LONG" | "SHORT" | "EITHER")
                          }
                        >
                          {["LONG", "SHORT", "EITHER"].map((d) => (
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
                disabled={busy || !input.trim()}
                onClick={() => handleSubmit()}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* @-reference Dialog */}
      <Dialog open={refOpen} onOpenChange={setRefOpen}>
        <DialogContent className="max-w-sm p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="text-sm font-medium">Reference a past thesis</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search theses..." />
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
                    <span className="font-medium">{t.ticker}</span>
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
    </div>
  );
}

// ---- Assistant message sub-components ----------------------------------------

function AssistantMessage({
  msg,
}: {
  msg: Extract<Message, { role: "assistant" }>;
}) {
  if (msg.status === "thinking") {
    return (
      <div className="flex gap-2 items-center text-sm text-muted-foreground">
        <span className="animate-pulse">●</span>
        <span>{msg.thinkingText}</span>
      </div>
    );
  }

  if (msg.status === "streaming") {
    return (
      <Card className="p-4 text-sm whitespace-pre-wrap">
        {msg.streamedText}
        <span className="animate-pulse">▌</span>
      </Card>
    );
  }

  if (msg.status === "error") {
    return (
      <Card className="border-destructive p-4">
        <p className="text-sm text-destructive">
          Research failed — {msg.errorText ?? "unknown error"}. Please try again.
        </p>
      </Card>
    );
  }

  if (msg.status === "done" && msg.thesis) {
    return <ThesisCard thesis={msg.thesis} />;
  }

  return null;
}

function ThesisCard({ thesis }: { thesis: ThesisOutput }) {
  const directionColor =
    thesis.direction === "LONG"
      ? "text-emerald-500"
      : thesis.direction === "SHORT"
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {thesis.ticker}
            <span className={`ml-2 text-base font-semibold tabular-nums ${directionColor}`}>
              {thesis.direction}
            </span>
          </CardTitle>
          <div className="flex gap-2 items-center">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Confidence
            </span>
            <span
              className={`tabular-nums font-semibold ${
                thesis.confidence_score >= 70 ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {thesis.confidence_score}%
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-1">
          {thesis.signal_types.map((s) => (
            <Badge key={s} variant="secondary" className="text-xs">
              {s}
            </Badge>
          ))}
          {thesis.sector && (
            <Badge variant="outline" className="text-xs">
              {thesis.sector}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {thesis.hold_duration}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {thesis.entry_price && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Entry
              </p>
              <p className="tabular-nums font-semibold">${thesis.entry_price.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Target
              </p>
              <p className="tabular-nums font-semibold text-emerald-500">
                {thesis.target_price ? `$${thesis.target_price.toFixed(2)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Stop
              </p>
              <p className="tabular-nums font-semibold text-red-500">
                {thesis.stop_loss ? `$${thesis.stop_loss.toFixed(2)}` : "—"}
              </p>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Analysis
          </p>
          <p className="text-muted-foreground leading-relaxed">{thesis.reasoning_summary}</p>
        </div>

        {thesis.thesis_bullets.length > 0 && (
          <ul className="space-y-1 list-disc list-inside text-muted-foreground">
            {thesis.thesis_bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}

        {thesis.risk_flags.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Risks
            </p>
            <ul className="space-y-1 list-disc list-inside text-red-500/80">
              {thesis.risk_flags.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {thesis.direction === "PASS" && (
          <p className="text-muted-foreground italic">
            No high-conviction trade identified. The AI suggests passing on this setup.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
