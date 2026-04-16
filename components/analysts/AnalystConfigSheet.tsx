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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InfoRow } from "@/components/ui/info-row";
import { Info, Search } from "lucide-react";
import {
  updateAnalystField,
} from "@/lib/actions/analyst.actions";
import type { AnalystConfig } from "@/lib/actions/analyst.actions";

interface AnalystConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AnalystConfig;
}

export function AnalystConfigSheet({
  open,
  onOpenChange,
  config,
}: AnalystConfigSheetProps) {
  const [, startTransition] = useTransition();

  const saveField = (field: Parameters<typeof updateAnalystField>[1], value: unknown) => {
    startTransition(async () => {
      await updateAnalystField(config.id, field, value);
    });
  };

  const policy = config.intelligencePolicy;

  function titleCase(s: string) {
    return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
  }

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

        <TooltipProvider>
          <div>
            {/* ── Trading config ────────────────────────────────── */}
            <div className="p-3 border-b flex flex-col gap-1">
              <InfoRow label="Direction">
                <Select
                  defaultValue={config.directionBias}
                  onValueChange={(val) => saveField("directionBias", val)}
                >
                  <SelectTrigger size="sm" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LONG">Long</SelectItem>
                    <SelectItem value="SHORT">Short</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </InfoRow>

              <InfoRow label="Hold Duration">
                <Select
                  defaultValue={config.holdDurations[0] ?? "SWING"}
                  onValueChange={(val) => saveField("holdDurations", [val])}
                >
                  <SelectTrigger size="sm" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="SWING">Swing</SelectItem>
                    <SelectItem value="POSITION">Position</SelectItem>
                  </SelectContent>
                </Select>
              </InfoRow>

              <InfoRow label="Min Confidence">
                <Input
                  type="number"
                  defaultValue={config.minConfidence}
                  min={0}
                  max={100}
                  className="w-24 text-right tabular-nums"
                  onBlur={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val !== config.minConfidence) {
                      saveField("minConfidence", Math.min(100, Math.max(0, val)));
                    }
                  }}
                />
              </InfoRow>

              <InfoRow label="Schedule">
                <Input
                  type="time"
                  defaultValue={config.scheduleTime}
                  className="w-24 text-right tabular-nums"
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== config.scheduleTime) {
                      saveField("scheduleTime", e.target.value);
                    }
                  }}
                />
              </InfoRow>

              <InfoRow label="Max Positions">
                <Input
                  type="number"
                  defaultValue={config.maxOpenPositions}
                  min={1}
                  max={20}
                  className="w-24 text-right tabular-nums"
                  onBlur={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val !== config.maxOpenPositions) {
                      saveField("maxOpenPositions", Math.min(20, Math.max(1, val)));
                    }
                  }}
                />
              </InfoRow>

              <InfoRow label="Max Position Size">
                <Input
                  type="number"
                  defaultValue={config.maxPositionSize ?? 0}
                  min={0}
                  step={100}
                  className="w-24 text-right tabular-nums"
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val !== config.maxPositionSize) {
                      saveField("maxPositionSize", Math.max(0, val));
                    }
                  }}
                />
              </InfoRow>

              <InfoRow label="Max Risk %">
                <Input
                  type="number"
                  defaultValue={config.maxRiskPct ?? 2}
                  min={0}
                  max={100}
                  step={0.5}
                  className="w-24 text-right tabular-nums"
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val !== (config.maxRiskPct ?? 2)) {
                      saveField("maxRiskPct", Math.min(100, Math.max(0, val)));
                    }
                  }}
                />
              </InfoRow>

              {/* Attention policy rows — inline with config, not a separate section */}
              {policy && typeof policy.holdingsAttention === "number" && (
                <InfoRow label="Holdings attention" value={`${Math.round((policy.holdingsAttention as number) * 100)}%`} mono />
              )}
              {policy && typeof policy.watchlistAttention === "number" && (
                <InfoRow label="Watchlist attention" value={`${Math.round((policy.watchlistAttention as number) * 100)}%`} mono />
              )}
              {policy && typeof policy.discoveryAttention === "number" && (
                <InfoRow label="Discovery attention" value={`${Math.round((policy.discoveryAttention as number) * 100)}%`} mono />
              )}
              {policy && typeof policy.maxSignalsPerRun === "number" && (
                <InfoRow label="Signal budget" value={String(policy.maxSignalsPerRun as number)} mono />
              )}
              {policy && typeof policy.allowLiveSearch === "boolean" && (
                <InfoRow
                  label="Live search"
                  value={(policy.allowLiveSearch as boolean) ? "On" : "Off"}
                />
              )}

              {config.sectors.length > 0 && (
                <InfoRow label="Sectors">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {config.sectors.map((s) => (
                      <Badge key={s} variant="secondary">{titleCase(s)}</Badge>
                    ))}
                  </div>
                </InfoRow>
              )}

              {config.signalTypes.length > 0 && (
                <InfoRow label="Signals" border={false}>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {config.signalTypes.map((s) => (
                      <Badge key={s} variant="secondary">{titleCase(s)}</Badge>
                    ))}
                  </div>
                </InfoRow>
              )}
            </div>

            {/* ── Universe (discovery fence) ─────────────────────── */}
            {/* B contract: Universe = sectors ∧ industries ∧ themes ∧       */}
            {/* marketCapMin/Max ∧ exchanges. Empty dim = no filter.         */}
            {/* exclusionList hard-rejects. Watchlist + positions bypass.    */}
            {(config.sectors.length > 0 ||
              config.industries.length > 0 ||
              config.themes.length > 0 ||
              config.exchanges.length > 0 ||
              config.exclusionList.length > 0 ||
              config.marketCapMin !== null ||
              config.marketCapMax !== null) && (
              <div className="p-3 border-b">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <p className="text-sm font-medium">Universe</p>
                  <Tooltip>
                    <TooltipTrigger render={<span className="cursor-help" />}>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      The discovery fence. Signals matching this Universe surface as
                      new-ticker candidates in your morning brief, even when they are
                      not in your watchlist or positions. Ask the editor to update it.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-1">
                  {config.industries.length > 0 && (
                    <InfoRow label="Industries">
                      <div className="flex flex-wrap gap-1 justify-end">
                        {config.industries.map((s) => (
                          <Badge key={s} variant="outline">{titleCase(s)}</Badge>
                        ))}
                      </div>
                    </InfoRow>
                  )}
                  {config.themes.length > 0 && (
                    <InfoRow label="Themes">
                      <div className="flex flex-wrap gap-1 justify-end">
                        {config.themes.map((s) => (
                          <Badge key={s} variant="outline">{titleCase(s)}</Badge>
                        ))}
                      </div>
                    </InfoRow>
                  )}
                  {config.exchanges.length > 0 && (
                    <InfoRow
                      label="Exchanges"
                      value={config.exchanges.join(", ")}
                      mono
                    />
                  )}
                  {(config.marketCapMin !== null ||
                    config.marketCapMax !== null) && (
                    <InfoRow
                      label="Market Cap"
                      value={`${config.marketCapMin ?? "—"} – ${config.marketCapMax ?? "—"}`}
                      mono
                    />
                  )}
                  {config.exclusionList.length > 0 && (
                    <InfoRow
                      label="Excluded"
                      value={config.exclusionList.join(", ")}
                      mono
                      border={false}
                    />
                  )}
                </div>
              </div>
            )}

            {/* ── Sources ───────────────────────────────────────── */}
            {config.domainMonitors.length > 0 && (
              <div className="p-3 border-b">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <p className="text-sm font-medium">Sources</p>
                  <Tooltip>
                    <TooltipTrigger render={<span className="cursor-help" />}>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Websites monitored daily for new articles. Perplexity Sonar searches each domain, then Firecrawl extracts full article text for the agent to read.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-1">
                  {config.domainMonitors.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 min-h-8">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${m.domain}&sz=16`}
                        alt=""
                        width={14}
                        height={14}
                        className="size-3.5 rounded-sm shrink-0"
                      />
                      <span className="truncate flex-1">{m.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Search Queries ─────────────────────────────────── */}
            {config.searchMonitors.length > 0 && (
              <div className="p-3 border-b">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <p className="text-sm font-medium">Search Queries</p>
                  <Tooltip>
                    <TooltipTrigger render={<span className="cursor-help" />}>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Perplexity Sonar runs these queries daily before the agent wakes up. Results become findings that get routed to the analyst based on relevance.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-1">
                  {config.searchMonitors.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 min-h-8">
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1">{m.query}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
