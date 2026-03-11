"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  BarChart3,
  Check,
  Clock,
  DollarSign,
  Eye,
  Shield,
  Target,
  TrendingUp,
  User,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentConfigData = {
  name: string;
  description?: string;
  analystPrompt: string;
  directionBias: "LONG" | "SHORT" | "BOTH";
  holdDurations: string[];
  sectors: string[];
  signalTypes: string[];
  minConfidence: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  minMarketCapTier: string;
  watchlist?: string[];
  exclusionList?: string[];
};

export type AgentConfigCardProps = ComponentProps<typeof Card> &
  AgentConfigData & {
    onConfirm?: () => void;
    isCreating?: boolean;
    showConfirmButton?: boolean;
    confirmLabel?: string;
    confirmingLabel?: string;
  };

// ─── Direction config ─────────────────────────────────────────────────────────

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

// ─── AgentConfigCard ──────────────────────────────────────────────────────────

export function AgentConfigCard({
  name,
  description,
  analystPrompt,
  directionBias,
  holdDurations,
  sectors,
  signalTypes,
  minConfidence,
  maxPositionSize,
  maxOpenPositions,
  minMarketCapTier,
  watchlist = [],
  exclusionList = [],
  onConfirm,
  isCreating,
  showConfirmButton = true,
  confirmLabel = "Create Analyst",
  confirmingLabel = "Creating...",
  className,
  ...cardProps
}: AgentConfigCardProps) {
  return (
    <Card className={cn("p-5 space-y-4", className)} {...cardProps}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="text-sm font-semibold truncate">{name}</h3>
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 ml-6">
              {description}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex items-center gap-1 text-xs font-medium shrink-0",
            directionColor[directionBias]
          )}
        >
          {directionIcon[directionBias]}
          {directionBias}
        </div>
      </div>

      {/* Strategy prompt */}
      <div className="rounded-md bg-muted/50 px-3 py-2">
        <p className="text-xs text-muted-foreground line-clamp-3">
          {analystPrompt}
        </p>
      </div>

      {/* Config grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
        <ConfigRow icon={Clock} label="Hold Duration">
          {holdDurations.join(", ")}
        </ConfigRow>
        <ConfigRow icon={Shield} label="Min Confidence">
          <span className="tabular-nums">{minConfidence}%</span>
        </ConfigRow>
        <ConfigRow icon={DollarSign} label="Position Size">
          <span className="tabular-nums">
            ${maxPositionSize.toLocaleString()}
          </span>
        </ConfigRow>
        <ConfigRow icon={Target} label="Max Positions">
          <span className="tabular-nums">{maxOpenPositions}</span>
        </ConfigRow>
        <ConfigRow icon={BarChart3} label="Market Cap">
          {minMarketCapTier}+
        </ConfigRow>
      </div>

      {/* Sectors */}
      {sectors.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sectors
          </span>
          <div className="flex flex-wrap gap-1.5">
            {sectors.map((s) => (
              <Badge key={s} variant="secondary" className="text-[11px]">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Signal Types */}
      {signalTypes.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signals
          </span>
          <div className="flex flex-wrap gap-1.5">
            {signalTypes.map((s) => (
              <Badge key={s} variant="outline" className="text-[11px]">
                <TrendingUp className="h-2.5 w-2.5" />
                {s.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Watchlist */}
      {watchlist.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Watchlist
          </span>
          <div className="flex flex-wrap gap-1.5">
            {watchlist.map((t) => (
              <Badge key={t} variant="secondary" className="text-[11px] font-mono">
                <Eye className="h-2.5 w-2.5" />
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Exclusion list */}
      {exclusionList.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Excluded
          </span>
          <div className="flex flex-wrap gap-1.5">
            {exclusionList.map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="text-[11px] font-mono text-muted-foreground"
              >
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
