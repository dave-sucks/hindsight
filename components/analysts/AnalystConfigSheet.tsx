"use client";

import { useState, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StockLogo } from "@/components/StockLogo";
import { StockCombobox } from "@/components/analysts/StockCombobox";
import { Eye, X, Globe, Search, Zap } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  updateAnalystField,
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/actions/analyst.actions";
import type { AnalystConfig } from "@/lib/actions/analyst.actions";

interface AnalystConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AnalystConfig;
}

function EditableRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-border pb-1.5 pt-1.5">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function AnalystConfigSheet({
  open,
  onOpenChange,
  config,
}: AnalystConfigSheetProps) {
  const [isPending, startTransition] = useTransition();
  const [watchlist, setWatchlist] = useState(config.watchlist);

  // Reset watchlist when config changes (e.g. after server revalidation)
  if (config.watchlist !== watchlist && !isPending) {
    // Only sync if the arrays are actually different
    const configStr = config.watchlist.join(",");
    const localStr = watchlist.join(",");
    if (configStr !== localStr) {
      setWatchlist(config.watchlist);
    }
  }

  const saveField = (field: Parameters<typeof updateAnalystField>[1], value: unknown) => {
    startTransition(async () => {
      await updateAnalystField(config.id, field, value);
    });
  };

  const handleAddStock = (symbol: string) => {
    const upper = symbol.toUpperCase();
    if (watchlist.includes(upper)) return;
    setWatchlist((prev) => [...prev, upper]);
    startTransition(async () => {
      await addToWatchlist(config.id, upper);
    });
  };

  const handleRemoveStock = (symbol: string) => {
    setWatchlist((prev) => prev.filter((s) => s !== symbol));
    startTransition(async () => {
      await removeFromWatchlist(config.id, symbol);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold">Configuration</SheetTitle>
          <SheetDescription className="text-xs">
            Edit settings directly or use the AI chat.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-5">
          {/* Editable config rows */}
          <div className="space-y-0.5">
            <EditableRow label="Direction">
              <Select
                defaultValue={config.directionBias}
                onValueChange={(val) => saveField("directionBias", val)}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">LONG</SelectItem>
                  <SelectItem value="SHORT">SHORT</SelectItem>
                  <SelectItem value="BOTH">BOTH</SelectItem>
                </SelectContent>
              </Select>
            </EditableRow>

            <EditableRow label="Hold Duration">
              <Select
                defaultValue={config.holdDurations[0] ?? "SWING"}
                onValueChange={(val) => saveField("holdDurations", [val])}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAY">DAY</SelectItem>
                  <SelectItem value="SWING">SWING</SelectItem>
                  <SelectItem value="POSITION">POSITION</SelectItem>
                </SelectContent>
              </Select>
            </EditableRow>

            <EditableRow label="Min Confidence">
              <Input
                type="number"
                defaultValue={config.minConfidence}
                min={0}
                max={100}
                className="w-20 text-right tabular-nums"
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val !== config.minConfidence) {
                    saveField("minConfidence", Math.min(100, Math.max(0, val)));
                  }
                }}
              />
            </EditableRow>

            <EditableRow label="Schedule">
              <Input
                type="time"
                defaultValue={config.scheduleTime}
                className="w-28 text-right tabular-nums"
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== config.scheduleTime) {
                    saveField("scheduleTime", e.target.value);
                  }
                }}
              />
            </EditableRow>

            <EditableRow label="Max Positions">
              <Input
                type="number"
                defaultValue={config.maxOpenPositions}
                min={1}
                max={20}
                className="w-20 text-right tabular-nums"
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val !== config.maxOpenPositions) {
                    saveField("maxOpenPositions", Math.min(20, Math.max(1, val)));
                  }
                }}
              />
            </EditableRow>

            <EditableRow label="Max Position Size">
              <Input
                type="number"
                defaultValue={config.maxPositionSize ?? 0}
                min={0}
                step={100}
                className="w-28 text-right tabular-nums"
                onBlur={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val !== config.maxPositionSize) {
                    saveField("maxPositionSize", Math.max(0, val));
                  }
                }}
              />
            </EditableRow>

            <EditableRow label="Max Risk %">
              <Input
                type="number"
                defaultValue={config.maxRiskPct ?? 2}
                min={0}
                max={100}
                step={0.5}
                className="w-20 text-right tabular-nums"
                onBlur={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val !== (config.maxRiskPct ?? 2)) {
                    saveField("maxRiskPct", Math.min(100, Math.max(0, val)));
                  }
                }}
              />
            </EditableRow>
          </div>

          {/* Sectors */}
          {config.sectors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Sectors</p>
              <div className="flex flex-wrap gap-1">
                {config.sectors.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Signals */}
          {config.signalTypes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Signals</p>
              <div className="flex flex-wrap gap-1">
                {config.signalTypes.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Watching */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Watching</p>
              <StockCombobox
                onSelect={handleAddStock}
                excludeSymbols={watchlist}
              />
            </div>
            {watchlist.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {watchlist.map((symbol) => (
                  <Badge key={symbol} variant="secondary">
                    <Eye className="h-3 w-3" />
                    {symbol}
                    <button
                      onClick={() => handleRemoveStock(symbol)}
                      className="ml-0.5 rounded-full hover:bg-foreground/10 p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                No stocks on the watchlist yet. Add stocks that this analyst should
                prioritize during research runs.
              </p>
            )}
          </div>

          {/* Intelligence Section */}
          {(config.domainMonitors.length > 0 || config.searchMonitors.length > 0 || config.intelligencePolicy) && (
            <>
              <Separator />

              {/* Domain Monitors (Sources) */}
              {config.domainMonitors.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Source Monitors</p>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto tabular-nums">
                      {config.domainMonitors.length}
                    </span>
                  </div>
                  <div className="space-y-0">
                    {config.domainMonitors.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0">
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${m.domain}&sz=16`}
                          alt=""
                          width={14}
                          height={14}
                          className="size-3.5 rounded-sm shrink-0"
                        />
                        <span className="text-sm truncate flex-1">{m.name}</span>
                        <Badge variant="secondary">{m.category}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Monitors (Queries) */}
              {config.searchMonitors.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Search Monitors</p>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto tabular-nums">
                      {config.searchMonitors.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {config.searchMonitors.map((m) => (
                      <div key={m.id} className="flex items-start gap-2 py-1 border-b border-border/40 last:border-0">
                        <span className="text-sm text-foreground/80 flex-1">{m.query}</span>
                        <Badge variant="secondary">{m.category}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Intelligence Policy */}
              {config.intelligencePolicy && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Attention Policy</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    {typeof config.intelligencePolicy.holdingsAttention === "number" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Holdings</span>
                        <span className="tabular-nums font-medium">
                          {Math.round((config.intelligencePolicy.holdingsAttention as number) * 100)}%
                        </span>
                      </div>
                    )}
                    {typeof config.intelligencePolicy.watchlistAttention === "number" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Watchlist</span>
                        <span className="tabular-nums font-medium">
                          {Math.round((config.intelligencePolicy.watchlistAttention as number) * 100)}%
                        </span>
                      </div>
                    )}
                    {typeof config.intelligencePolicy.discoveryAttention === "number" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Discovery</span>
                        <span className="tabular-nums font-medium">
                          {Math.round((config.intelligencePolicy.discoveryAttention as number) * 100)}%
                        </span>
                      </div>
                    )}
                    {typeof config.intelligencePolicy.maxSignalsPerRun === "number" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Signal budget</span>
                        <span className="tabular-nums font-medium">
                          {config.intelligencePolicy.maxSignalsPerRun as number}
                        </span>
                      </div>
                    )}
                    {typeof config.intelligencePolicy.allowLiveSearch === "boolean" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Live search</span>
                        <span className="font-medium">
                          {(config.intelligencePolicy.allowLiveSearch as boolean) ? "On" : "Off"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
