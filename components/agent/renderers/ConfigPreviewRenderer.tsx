"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AgentConfigCard,
  type AgentConfigData,
} from "@/components/domain/agent-config-card";
import { useToolUICallbacks } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import type { ToolResult } from "@/lib/agent/tool-result";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  analystPrompt: "Strategy",
  directionBias: "Direction",
  holdDurations: "Hold Duration",
  sectors: "Sectors",
  signalTypes: "Signals",
  minConfidence: "Min Confidence",
  maxPositionSize: "Position Size",
  maxOpenPositions: "Max Positions",
  minMarketCapTier: "Market Cap",
  watchlist: "Watchlist",
  exclusionList: "Exclusion List",
};

function formatValue(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  if (key === "watchlist" && Array.isArray(val)) {
    if (val.length === 0) return "—";
    return val
      .map((t) => (typeof t === "string" ? t : (t as { symbol: string }).symbol))
      .join(", ");
  }
  if (Array.isArray(val)) return val.length === 0 ? "—" : val.join(", ");
  if (key === "maxPositionSize" && typeof val === "number")
    return `$${val.toLocaleString()}`;
  if (key === "minConfidence" && typeof val === "number") return `${val}%`;
  if (typeof val === "string" && key === "analystPrompt")
    return val.length > 80 ? val.slice(0, 80) + "…" : val;
  return String(val);
}

function computeDiff(
  before: Record<string, unknown>,
  after: AgentConfigData,
): { label: string; before: string; after: string }[] {
  const diffs: { label: string; before: string; after: string }[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const bStr = formatValue(key, before[key]);
    const aStr = formatValue(key, after[key as keyof AgentConfigData]);
    if (bStr !== aStr) diffs.push({ label, before: bStr, after: aStr });
  }
  return diffs;
}

export function ConfigPreviewRenderer({ result, loading }: Props) {
  const config = result.data as AgentConfigData | null;
  const {
    onConfirmConfig,
    onConfigSuggested,
    isCreating,
    confirmLabel,
    confirmingLabel,
    currentConfig,
  } = useToolUICallbacks();

  const configSuggestedRef = useRef(onConfigSuggested);
  configSuggestedRef.current = onConfigSuggested;

  useEffect(() => {
    if (config && configSuggestedRef.current) {
      configSuggestedRef.current(config);
    }
  }, [config]);

  if (loading || !config) return null;

  // Editor mode: show diff against currentConfig
  if (currentConfig) {
    const diffs = computeDiff(currentConfig, config);
    if (diffs.length === 0) {
      return (
        <Card className="p-4 mt-1">
          <p className="text-sm text-muted-foreground">No changes detected.</p>
        </Card>
      );
    }
    return (
      <div className="my-2 space-y-3">
        <Card className="overflow-hidden p-0">
          <div className="p-3 border-b flex items-center justify-between">
            <h4 className="text-sm font-medium">Proposed Changes</h4>
            <Badge variant="secondary">
              {diffs.length} {diffs.length === 1 ? "change" : "changes"}
            </Badge>
          </div>
          <div className="p-3 space-y-3">
            {diffs.map((d) => (
              <div key={d.label} className="text-sm">
                <span className="text-sm text-muted-foreground">{d.label}</span>
                <div className="flex items-start gap-2.5 mt-1">
                  <span className="text-red-500 line-through min-w-0 break-words text-sm">
                    {d.before}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-emerald-500 font-medium min-w-0 break-words text-sm">
                    {d.after}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        {onConfirmConfig && (
          <Button
            onClick={() => onConfirmConfig(config)}
            disabled={isCreating}
            className="w-full h-10"
            size="default"
          >
            <Check className="h-4 w-4 mr-2" />
            {isCreating
              ? (confirmingLabel ?? "Applying…")
              : (confirmLabel ?? "Apply Changes")}
          </Button>
        )}
      </div>
    );
  }

  // Builder mode: compact card when panel is handling the config
  if (onConfigSuggested) {
    return (
      <div className="my-2">
        <Card className="overflow-hidden p-0 gap-0">
          <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
            <span className="text-sm font-brand font-semibold truncate">
              {config.name ?? "Analyst"}
            </span>
            <span className="text-xs text-muted-foreground">Analyst</span>
          </div>
          <div className="p-3">
            {config.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {config.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground/60 mt-1.5">
              Review the strategy, resources, and configuration in the panel.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Builder mode: inline full card with confirm button
  return (
    <div className="my-2">
      <AgentConfigCard
        {...config}
        onConfirm={onConfirmConfig ? () => onConfirmConfig(config) : undefined}
        isCreating={isCreating}
        showConfirmButton={!!onConfirmConfig}
        confirmLabel={confirmLabel}
        confirmingLabel={confirmingLabel}
      />
    </div>
  );
}
