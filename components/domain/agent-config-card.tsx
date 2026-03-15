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
  Sparkles,
  Target,
  TrendingUp,
  User,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentConfigData = {
  name: string;
  description?: string;
  analystPrompt: string;
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
  LONG: <ArrowUpRight className="h-4 w-4" />,
  SHORT: <ArrowDownRight className="h-4 w-4" />,
  BOTH: <ArrowLeftRight className="h-4 w-4" />,
};

// ─── AgentConfigCard ──────────────────────────────────────────────────────────

export function AgentConfigCard({
  name,
  description,
  analystPrompt,
  directionBias = "BOTH",
  holdDurations = [],
  sectors = [],
  signalTypes = [],
  minConfidence = 0,
  maxPositionSize = 0,
  maxOpenPositions = 0,
  minMarketCapTier = "any",
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
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <User className="size-4" />
              </div>
              <h3 className="text-lg font-semibold truncate">{name}</h3>
            </div>
            {description && (
              <p className="text-sm text-muted-foreground line-clamp-2 pl-[42px]">
                {description}
              </p>
            )}
          </div>
          <Badge
            variant={
              directionBias === "LONG"
                ? "positive"
                : directionBias === "SHORT"
                  ? "negative"
                  : "secondary"
            }
          >
            {directionIcon[directionBias]}
            {directionBias}
          </Badge>
        </div>
      </div>

      {/* ── Strategy prompt ──────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Strategy
          </span>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed line-clamp-4">
          {analystPrompt}
        </p>
      </div>

      <div className="px-6 py-4 space-y-5">
        {/* ── Risk Parameters ────────────────────────────────────────── */}
        <div>
          <SectionLabel>Risk Parameters</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            <StatCell
              icon={Shield}
              label="Min Confidence"
              value={`${minConfidence}%`}
              highlight={minConfidence >= 70}
            />
            <StatCell
              icon={DollarSign}
              label="Position Size"
              value={`$${maxPositionSize.toLocaleString()}`}
            />
            <StatCell
              icon={Target}
              label="Max Positions"
              value={String(maxOpenPositions)}
            />
            <StatCell
              icon={Clock}
              label="Hold Duration"
              value={holdDurations.join(", ")}
            />
            <StatCell
              icon={BarChart3}
              label="Market Cap"
              value={`${minMarketCapTier}+`}
            />
          </div>
        </div>

        {/* ── Sectors ────────────────────────────────────────────────── */}
        {sectors.length > 0 && (
          <div>
            <SectionLabel>Sectors</SectionLabel>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sectors.map((s) => (
                <Badge key={s} variant="outline">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Signal Types ───────────────────────────────────────────── */}
        {signalTypes.length > 0 && (
          <div>
            <SectionLabel>Signals</SectionLabel>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {signalTypes.map((s) => (
                <Badge key={s} variant="outline">
                  <TrendingUp className="h-2.5 w-2.5" />
                  {s.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Watchlist ──────────────────────────────────────────────── */}
        {watchlist.length > 0 && (
          <div>
            <SectionLabel>Watchlist</SectionLabel>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {watchlist.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                >
                  <Eye className="h-2.5 w-2.5" />
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Exclusion list ─────────────────────────────────────────── */}
        {exclusionList.length > 0 && (
          <div>
            <SectionLabel>Excluded</SectionLabel>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {exclusionList.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                >
                  <Ban className="h-2.5 w-2.5" />
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm button ────────────────────────────────────────────── */}
      {showConfirmButton && onConfirm && (
        <div className="px-6 pb-5 pt-1">
          <Button
            onClick={onConfirm}
            disabled={isCreating}
            className="w-full h-10"
            size="default"
          >
            <Check className="h-4 w-4 mr-2" />
            {isCreating ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "text-sm tabular-nums font-semibold",
          highlight && "text-positive"
        )}
      >
        {value}
      </p>
    </div>
  );
}
