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
import { StockLogo } from "@/components/StockLogo";
import { StockCombobox } from "@/components/analysts/StockCombobox";
import { X } from "lucide-react";
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

// ── Editable row — label left, input/dropdown right ──────────────────────────
// Same visual weight as ConfigRow in AnalystConfigPanel: text-sm both sides

function EditableRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
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

  // Sync watchlist when config changes
  if (config.watchlist !== watchlist && !isPending) {
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

        <div>
          {/* ── Config rows ────────────────────────────────────── */}
          <div className="p-3 border-b">
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

          {/* ── Sectors ────────────────────────────────────────── */}
          {config.sectors.length > 0 && (
            <div className="p-3 border-b">
              <p className="text-sm font-medium mb-1.5">Sectors</p>
              <div className="flex flex-wrap gap-1.5">
                {config.sectors.map((s) => (
                  <Badge key={s} variant="outline">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* ── Signals ────────────────────────────────────────── */}
          {config.signalTypes.length > 0 && (
            <div className="p-3 border-b">
              <p className="text-sm font-medium mb-1.5">Signals</p>
              <div className="flex flex-wrap gap-1.5">
                {config.signalTypes.map((s) => (
                  <Badge key={s} variant="outline">
                    {s.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* ── Watchlist — StockLogo rows ──────────────────────── */}
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium">Watchlist</p>
              <StockCombobox
                onSelect={handleAddStock}
                excludeSymbols={watchlist}
              />
            </div>
            {watchlist.length > 0 ? (
              <div>
                {watchlist.map((symbol) => (
                  <div key={symbol} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                    <StockLogo ticker={symbol} size="sm" />
                    <span className="font-mono text-[11px] font-medium flex-1">{symbol}</span>
                    <button
                      onClick={() => handleRemoveStock(symbol)}
                      className="rounded-full hover:bg-foreground/10 p-0.5 text-muted-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                No stocks on the watchlist yet.
              </p>
            )}
          </div>

          {/* ── Domain Monitors ─────────────────────────────────── */}
          {config.domainMonitors.length > 0 && (
            <div className="p-3 border-b">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium">Sources</p>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {config.domainMonitors.length}
                </span>
              </div>
              {config.domainMonitors.map((m) => (
                <div key={m.id} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${m.domain}&sz=16`}
                    alt=""
                    width={14}
                    height={14}
                    className="size-3.5 rounded-sm shrink-0"
                  />
                  <span className="text-sm truncate flex-1">{m.name}</span>
                  <span className="text-[11px] text-muted-foreground">{m.category}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Search Monitors ─────────────────────────────────── */}
          {config.searchMonitors.length > 0 && (
            <div className="p-3 border-b">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium">Search Queries</p>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {config.searchMonitors.length}
                </span>
              </div>
              {config.searchMonitors.map((m) => (
                <div key={m.id} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-sm text-muted-foreground flex-1">{m.query}</span>
                  <span className="text-[11px] text-muted-foreground">{m.category}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Intelligence Policy ─────────────────────────────── */}
          {config.intelligencePolicy && (
            <div className="p-3">
              <p className="text-sm font-medium mb-1.5">Attention Policy</p>
              <div className="space-y-0.5">
                {typeof config.intelligencePolicy.holdingsAttention === "number" && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-sm text-muted-foreground">Holdings</span>
                    <span className="text-sm tabular-nums font-medium">
                      {Math.round((config.intelligencePolicy.holdingsAttention as number) * 100)}%
                    </span>
                  </div>
                )}
                {typeof config.intelligencePolicy.watchlistAttention === "number" && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-sm text-muted-foreground">Watchlist</span>
                    <span className="text-sm tabular-nums font-medium">
                      {Math.round((config.intelligencePolicy.watchlistAttention as number) * 100)}%
                    </span>
                  </div>
                )}
                {typeof config.intelligencePolicy.discoveryAttention === "number" && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-sm text-muted-foreground">Discovery</span>
                    <span className="text-sm tabular-nums font-medium">
                      {Math.round((config.intelligencePolicy.discoveryAttention as number) * 100)}%
                    </span>
                  </div>
                )}
                {typeof config.intelligencePolicy.maxSignalsPerRun === "number" && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-[11px] text-muted-foreground">Signal budget</span>
                    <span className="text-[11px] tabular-nums font-medium">
                      {config.intelligencePolicy.maxSignalsPerRun as number}
                    </span>
                  </div>
                )}
                {typeof config.intelligencePolicy.allowLiveSearch === "boolean" && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-[11px] text-muted-foreground">Live search</span>
                    <span className="text-[11px] font-medium">
                      {(config.intelligencePolicy.allowLiveSearch as boolean) ? "On" : "Off"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
