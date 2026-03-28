"use client";

import { useEffect, useRef, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ArrowRight, Check } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AgentConfigCard,
  type AgentConfigData,
} from "@/components/domain/agent-config-card";

import { useToolUICallbacks } from "./tool-ui-shared";

// ─── suggest_config tool UI (builder mode — full card + create button) ──────

export const SuggestConfigRender: ToolCallMessagePartComponent<
  AgentConfigData,
  AgentConfigData
> = ({ args, status }) => {
  const { onConfirmConfig, onConfigSuggested, isCreating, confirmLabel, confirmingLabel } =
    useToolUICallbacks();

  const hasPanelCallback = !!onConfigSuggested;
  const configSuggestedRef = useRef(onConfigSuggested);
  configSuggestedRef.current = onConfigSuggested;

  useEffect(() => {
    if (args && configSuggestedRef.current) {
      configSuggestedRef.current(args);
    }
  }, [args]);

  if (!args) return null;

  if (hasPanelCallback) {
    const dir = args.directionBias ?? "BOTH";
    const hold = (args.holdDurations ?? ["SWING"]).join("/");
    const conf = args.minConfidence ?? 65;
    return (
      <div className="my-2">
        <Card className="overflow-hidden p-0 gap-0">
          <div className="px-3 py-2 border-b bg-muted flex items-center justify-between gap-2">
            <span className="text-sm font-brand font-semibold truncate">
              {args.name ?? "Analyst"}
            </span>
            <Badge
              variant={
                dir === "LONG"
                  ? "positive"
                  : dir === "SHORT"
                    ? "negative"
                    : "secondary"
              }
            >
              {dir}
            </Badge>
          </div>
          <div className="px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 font-mono">
              <span>{dir}</span>
              <span className="opacity-30">&middot;</span>
              <span>{hold}</span>
              <span className="opacity-30">&middot;</span>
              <span className="tabular-nums">{conf}% MIN</span>
              <span className="opacity-30">&middot;</span>
              <span className="text-foreground/50">see panel &rarr;</span>
            </span>
          </div>
        </Card>
      </div>
    );
  }

  // Fallback: render full config card inline (no panel available)
  return (
    <div className="my-2">
      <AgentConfigCard
        {...args}
        onConfirm={
          onConfirmConfig ? () => onConfirmConfig(args) : undefined
        }
        isCreating={isCreating}
        showConfirmButton={!!onConfirmConfig}
        confirmLabel={confirmLabel}
        confirmingLabel={confirmingLabel}
      />
    </div>
  );
};

SuggestConfigRender.displayName = "SuggestConfigRender";

// ─── Config diff helpers (editor mode) ──────────────────────────────────────

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
  sourcePackProposal: "Domain Monitors",
  intelligenceQueries: "Search Monitors",
  intelligencePolicy: "Intelligence Policy",
};

function formatValue(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  // Watchlist: array of strings or objects with .symbol
  if (key === "watchlist" && Array.isArray(val)) {
    if (val.length === 0) return "—";
    return val.map((t) => (typeof t === "string" ? t : (t as { symbol: string }).symbol)).join(", ");
  }
  // Domain monitors (sourcePackProposal)
  if (key === "sourcePackProposal" && typeof val === "object" && val !== null) {
    const sources = (val as { sources?: { name: string }[] }).sources;
    if (!sources || sources.length === 0) return "—";
    return `${sources.length} sources: ${sources.map((s) => s.name).join(", ")}`;
  }
  // Search monitors (intelligenceQueries)
  if (key === "intelligenceQueries" && Array.isArray(val)) {
    if (val.length === 0) return "—";
    return `${val.length} queries: ${val.map((q: { query?: string }) => q.query ?? "").join("; ")}`;
  }
  // Intelligence policy
  if (key === "intelligencePolicy" && typeof val === "object" && val !== null) {
    const p = val as Record<string, unknown>;
    const parts: string[] = [];
    if (p.maxSignalsPerRun) parts.push(`${p.maxSignalsPerRun} signals/run`);
    if (p.liveSearchBudget) parts.push(`${p.liveSearchBudget} live searches`);
    if (p.holdingsAttention) parts.push(`holdings ${Math.round(Number(p.holdingsAttention) * 100)}%`);
    return parts.length > 0 ? parts.join(", ") : "Default policy";
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
  after: AgentConfigData
): { label: string; before: string; after: string }[] {
  const diffs: { label: string; before: string; after: string }[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const bStr = formatValue(key, before[key]);
    const aStr = formatValue(key, after[key as keyof AgentConfigData]);
    if (bStr !== aStr) diffs.push({ label, before: bStr, after: aStr });
  }
  return diffs;
}

// ─── Editor-mode suggest_config render (with diff) ──────────────────────────

export const SuggestConfigEditorRender: ToolCallMessagePartComponent<
  AgentConfigData,
  AgentConfigData
> = ({ args }) => {
  const { currentConfig, onApplyConfig, onConfigSuggested, isApplying, applied } =
    useToolUICallbacks();
  const [showFull, setShowFull] = useState(false);

  // Notify the panel when the AI suggests a new config
  const configSuggestedRef = useRef(onConfigSuggested);
  configSuggestedRef.current = onConfigSuggested;
  useEffect(() => {
    if (args && configSuggestedRef.current) {
      configSuggestedRef.current(args);
    }
  }, [args]);

  if (!args || !currentConfig) return null;

  const diffs = computeDiff(currentConfig, args);

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
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Proposed Changes
          </h4>
          <Badge variant="secondary">
            {diffs.length} {diffs.length === 1 ? "change" : "changes"}
          </Badge>
        </div>
        <div className="px-5 py-4 space-y-3">
          {diffs.map((d) => (
            <div key={d.label} className="text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {d.label}
              </span>
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
        <div className="px-5 pb-4">
          <button
            onClick={() => setShowFull(!showFull)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            {showFull ? "Hide full config" : "Show full config"}
          </button>
        </div>
      </Card>

      {showFull && (
        <AgentConfigCard
          {...args}
          showConfirmButton={false}
          className="border-dashed"
        />
      )}

      {applied ? (
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium">
            <Check className="h-4 w-4" />
            Changes applied successfully
          </div>
        </Card>
      ) : (
        onApplyConfig && (
          <Button
            onClick={() => onApplyConfig(args)}
            disabled={isApplying}
            className="w-full h-10"
            size="default"
          >
            <Check className="h-4 w-4 mr-2" />
            {isApplying ? "Applying…" : "Apply Changes"}
          </Button>
        )
      )}
    </div>
  );
};

SuggestConfigEditorRender.displayName = "SuggestConfigEditorRender";
