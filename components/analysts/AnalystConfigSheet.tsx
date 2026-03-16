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
import { Eye, X } from "lucide-react";
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
