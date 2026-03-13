"use client";

import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Clock,
  Shield,
  Target,
  TrendingUp,
  DollarSign,
  BarChart3,
  Eye,
  Ban,
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SuggestedConfig = {
  name: string;
  analystPrompt: string;
  description?: string;
  directionBias?: "LONG" | "SHORT" | "BOTH";
  holdDurations?: string[];
  sectors?: string[];
  signalTypes?: string[];
  minConfidence?: number;
  maxPositionSize?: number;
  maxOpenPositions?: number;
  minMarketCapTier?: string;
  watchlist?: string[];
  exclusionList?: string[];
};

const directionIcon = {
  LONG: <ArrowUpRight className="h-3.5 w-3.5" />,
  SHORT: <ArrowDownRight className="h-3.5 w-3.5" />,
  BOTH: <ArrowLeftRight className="h-3.5 w-3.5" />,
};

const directionColor = {
  LONG: "text-emerald-500",
  SHORT: "text-red-500",
  BOTH: "text-blue-500",
};

export function ConfigPreviewCard({
  config,
  onConfirm,
  isCreating,
  showConfirmButton = true,
  confirmLabel = "Create Analyst",
  confirmingLabel = "Creating...",
}: {
  config: SuggestedConfig;
  onConfirm?: () => void;
  isCreating?: boolean;
  showConfirmButton?: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
}) {
  return (
    <Card className="p-5 space-y-4 my-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{config.name}</h3>
          {config.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {config.description}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex items-center gap-1 text-xs font-medium shrink-0",
            directionColor[config.directionBias ?? "BOTH"]
          )}
        >
          {directionIcon[config.directionBias ?? "BOTH"]}
          {config.directionBias ?? "BOTH"}
        </div>
      </div>

      {/* Strategy prompt */}
      <div className="rounded-md bg-muted/50 px-3 py-2">
        <p className="text-xs text-muted-foreground line-clamp-3">
          {config.analystPrompt}
        </p>
      </div>

      {/* Config grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
        <ConfigRow icon={Clock} label="Hold Duration">
          {(config.holdDurations ?? []).join(", ") || "—"}
        </ConfigRow>
        <ConfigRow icon={Shield} label="Min Confidence">
          <span className="tabular-nums">{config.minConfidence ?? 0}%</span>
        </ConfigRow>
        <ConfigRow icon={DollarSign} label="Position Size">
          <span className="tabular-nums">
            ${(config.maxPositionSize ?? 0).toLocaleString()}
          </span>
        </ConfigRow>
        <ConfigRow icon={Target} label="Max Positions">
          <span className="tabular-nums">{config.maxOpenPositions ?? 0}</span>
        </ConfigRow>
        <ConfigRow icon={BarChart3} label="Market Cap">
          {config.minMarketCapTier ?? "any"}+
        </ConfigRow>
      </div>

      {/* Sectors */}
      {(config.sectors ?? []).length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sectors
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(config.sectors ?? []).map((s) => (
              <Badge key={s} variant="secondary" className="text-[11px]">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Signal Types */}
      {(config.signalTypes ?? []).length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signals
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(config.signalTypes ?? []).map((s) => (
              <Badge key={s} variant="outline" className="text-[11px]">
                <TrendingUp className="h-2.5 w-2.5" />
                {s.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Watchlist / Exclusion */}
      {(config.watchlist?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Watchlist
          </span>
          <div className="flex flex-wrap gap-1.5">
            {config.watchlist!.map((t) => (
              <Badge key={t} variant="secondary" className="text-[11px] font-mono">
                <Eye className="h-2.5 w-2.5" />
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {(config.exclusionList?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Excluded
          </span>
          <div className="flex flex-wrap gap-1.5">
            {config.exclusionList!.map((t) => (
              <Badge key={t} variant="outline" className="text-[11px] font-mono text-muted-foreground">
                <Ban className="h-2.5 w-2.5" />
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Confirm button */}
      {showConfirmButton && onConfirm && (
        <Button
          onClick={onConfirm}
          disabled={isCreating}
          className="w-full"
          size="sm"
        >
          <Check className="h-3.5 w-3.5 mr-1.5" />
          {isCreating ? confirmingLabel : confirmLabel}
        </Button>
      )}
    </Card>
  );
}

function ConfigRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
