"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AgentConfigCard,
  type AgentConfigData,
} from "@/components/domain/agent-config-card";
import { useToolUICallbacks } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import type { ToolResult } from "@/lib/agent/tool-result";
import { cn } from "@/lib/utils";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

// ── Field groupings (four Editor-diff tabs) ─────────────────────────────────
// Each group lists (key, label) pairs in display order. Only changed fields
// surface in the UI — unchanged ones don't render. Tab label shows count of
// changes in that group so the user knows where to look.

type FieldKey = keyof AgentConfigData;

interface FieldSpec {
  key: FieldKey;
  label: string;
}

type GroupId = "trading" | "universe" | "monitors" | "prompt";

const GROUPS: Record<GroupId, { label: string; fields: FieldSpec[] }> = {
  trading: {
    label: "Trading Rules",
    fields: [
      { key: "directionBias", label: "Direction" },
      { key: "holdDurations", label: "Hold Duration" },
      { key: "minConfidence", label: "Min Confidence" },
      { key: "maxPositionSize", label: "Max Position Size" },
      { key: "maxOpenPositions", label: "Max Positions" },
      { key: "minMarketCapTier", label: "Market Cap Tier" },
      { key: "signalTypes", label: "Signal Types" },
    ],
  },
  universe: {
    label: "Universe",
    fields: [
      { key: "sectors", label: "Sectors" },
      { key: "industries", label: "Industries" },
      { key: "themes", label: "Themes" },
      { key: "marketCapMin", label: "Market Cap Min" },
      { key: "marketCapMax", label: "Market Cap Max" },
      { key: "exclusionList", label: "Exclusion List" },
      { key: "watchlist", label: "Watchlist" },
    ],
  },
  monitors: {
    label: "Monitors",
    fields: [
      { key: "domainMonitorProposal", label: "Domain Sources" },
      { key: "intelligenceQueries", label: "Search Queries" },
      { key: "intelligencePolicy", label: "Signal Attention" },
    ],
  },
  prompt: {
    label: "Prompt",
    fields: [
      { key: "name", label: "Name" },
      { key: "description", label: "Description" },
      { key: "analystPrompt", label: "Strategy" },
    ],
  },
};

const UNIVERSE_FIELDS = new Set<FieldKey>([
  "sectors",
  "industries",
  "themes",
]);

// ── Value formatters ────────────────────────────────────────────────────────

function formatValue(key: FieldKey, val: unknown): string {
  if (val == null || val === "") return "—";

  // Specialized array/object cases — MUST come before the generic
  // Array.isArray handler, otherwise arrays of objects render as
  // "[object Object], [object Object], …".
  if (key === "watchlist" && Array.isArray(val)) {
    if (val.length === 0) return "—";
    return val
      .map((t) =>
        typeof t === "string" ? t : (t as { symbol: string }).symbol,
      )
      .join(", ");
  }
  if (key === "intelligenceQueries" && Array.isArray(val)) {
    if (val.length === 0) return "—";
    return val
      .map((q) =>
        typeof q === "string"
          ? q
          : ((q as { query?: string }).query ?? ""),
      )
      .filter(Boolean)
      .join(", ");
  }
  if (key === "domainMonitorProposal" && val && typeof val === "object") {
    const sources = (val as { sources?: Array<Record<string, unknown>> })
      .sources ?? [];
    if (sources.length === 0) return "—";
    return sources
      .map(
        (s) =>
          (s.name as string | undefined) ??
          (s.domain as string | undefined) ??
          "",
      )
      .filter(Boolean)
      .join(", ");
  }
  if (key === "intelligencePolicy" && val && typeof val === "object") {
    const p = val as Record<string, number | undefined>;
    return `H ${Math.round((p.holdingsAttention ?? 0) * 100)}% · W ${Math.round((p.watchlistAttention ?? 0) * 100)}% · D ${Math.round((p.discoveryAttention ?? 0) * 100)}%`;
  }

  // Generic array of primitives (sectors, industries, themes, exclusionList)
  if (Array.isArray(val)) return val.length === 0 ? "—" : val.join(", ");

  if (
    (key === "maxPositionSize" ||
      key === "marketCapMin" ||
      key === "marketCapMax") &&
    typeof val === "number"
  ) {
    return `$${val.toLocaleString()}`;
  }
  if (key === "minConfidence" && typeof val === "number") return `${val}%`;
  if (typeof val === "string" && key === "analystPrompt")
    return val.length > 140 ? val.slice(0, 140) + "…" : val;
  return String(val);
}

// Deep equality just-enough for diffing. Arrays by stable-sorted JSON; objects
// by canonical-key JSON. Covers every shape we ship in AgentConfigData.
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map((x) => JSON.stringify(x)).sort();
    const sb = [...b].map((x) => JSON.stringify(x)).sort();
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object" && a && b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

// ── Editor diff shape ───────────────────────────────────────────────────────

interface FieldDiff {
  key: FieldKey;
  label: string;
  before: string;
  after: string;
}

function diffsFor(
  group: GroupId,
  before: Record<string, unknown>,
  after: AgentConfigData,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const spec of GROUPS[group].fields) {
    const bVal = before[spec.key as string];
    const aVal = (after as Record<string, unknown>)[spec.key as string];
    if (deepEq(bVal, aVal)) continue;
    out.push({
      key: spec.key,
      label: spec.label,
      before: formatValue(spec.key, bVal),
      after: formatValue(spec.key, aVal),
    });
  }
  return out;
}

// ── Renderer ────────────────────────────────────────────────────────────────

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

  // Editor mode — tabbed cherry-pick diff.
  if (currentConfig) {
    return (
      <EditorDiff
        currentConfig={currentConfig}
        proposed={config}
        onConfirmConfig={onConfirmConfig}
        isApplying={!!isCreating}
        confirmLabel={confirmLabel}
        confirmingLabel={confirmingLabel}
      />
    );
  }

  // Builder mode: compact card when the panel is taking care of the full config.
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

// ── Editor diff — tabs + cherry-pick checkboxes + fence preview ─────────────

function EditorDiff({
  currentConfig,
  proposed,
  onConfirmConfig,
  isApplying,
  confirmLabel,
  confirmingLabel,
}: {
  currentConfig: Record<string, unknown>;
  proposed: AgentConfigData;
  onConfirmConfig: ((config: AgentConfigData) => void) | undefined;
  isApplying: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
}) {
  // Per-tab diff computation (memoized — stable across toggles).
  const groupDiffs = useMemo(
    () => ({
      trading: diffsFor("trading", currentConfig, proposed),
      universe: diffsFor("universe", currentConfig, proposed),
      monitors: diffsFor("monitors", currentConfig, proposed),
      prompt: diffsFor("prompt", currentConfig, proposed),
    }),
    [currentConfig, proposed],
  );

  const totalChanges =
    groupDiffs.trading.length +
    groupDiffs.universe.length +
    groupDiffs.monitors.length +
    groupDiffs.prompt.length;

  // Which fields are approved. Default: everything selected.
  const allKeys = useMemo(
    () =>
      ([] as FieldKey[]).concat(
        ...(["trading", "universe", "monitors", "prompt"] as const).map(
          (g) => groupDiffs[g].map((d) => d.key),
        ),
      ),
    [groupDiffs],
  );

  const [approved, setApproved] = useState<Set<FieldKey>>(
    () => new Set(allKeys),
  );
  // Reset approved set when the set of changed fields changes (new proposal).
  useEffect(() => {
    setApproved(new Set(allKeys));
  }, [allKeys]);

  const toggleField = (key: FieldKey) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (group: GroupId) => {
    const keys = groupDiffs[group].map((d) => d.key);
    const allSelected = keys.every((k) => approved.has(k));
    setApproved((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const approvedCount = approved.size;

  // Post-approval (pre-apply) fence validation — runs whenever the approved
  // universe set changes. Projects the NEW fence (current ∪ approved universe
  // fields), posts to the validate endpoint, surfaces a "would have routed X
  // signals in last 7d" hint so the user knows the change actually does
  // something before committing to it.
  const projectedUniverse = useMemo(() => {
    const pick = (key: FieldKey) =>
      (approved.has(key) ? proposed[key] : currentConfig[key as string]) as
        | string[]
        | undefined;
    return {
      sectors: pick("sectors") ?? [],
      industries: pick("industries") ?? [],
      themes: pick("themes") ?? [],
    };
  }, [approved, proposed, currentConfig]);

  const hasUniverseChange = [...UNIVERSE_FIELDS].some(
    (k) => approved.has(k) && !deepEq(proposed[k], currentConfig[k as string]),
  );

  const [fenceCount, setFenceCount] = useState<number | null>(null);
  const [fenceLoading, setFenceLoading] = useState(false);
  useEffect(() => {
    if (!hasUniverseChange) {
      setFenceCount(null);
      return;
    }
    let cancelled = false;
    setFenceLoading(true);
    const t = setTimeout(() => {
      fetch("/api/universe/validate-fence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...projectedUniverse, lookbackDays: 7 }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled) setFenceCount(data?.count ?? 0);
        })
        .finally(() => {
          if (!cancelled) setFenceLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [projectedUniverse, hasUniverseChange]);

  const handleApply = () => {
    if (!onConfirmConfig) return;
    // Build a partial AgentConfigData: approved fields keep their proposed
    // value, unapproved changed fields roll back to currentConfig values so
    // the update action leaves those columns alone.
    const patched: AgentConfigData = { ...proposed };
    for (const key of allKeys) {
      if (!approved.has(key)) {
        (patched as Record<string, unknown>)[key as string] =
          currentConfig[key as string];
      }
    }
    onConfirmConfig(patched);
  };

  if (totalChanges === 0) {
    return (
      <Card className="p-4 mt-1">
        <p className="text-sm text-muted-foreground">No changes detected.</p>
      </Card>
    );
  }

  return (
    <div className="my-2 space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="p-3 border-b flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Proposed Changes</h4>
          <span className="text-xs text-muted-foreground tabular-nums">
            {approvedCount} of {totalChanges} selected
          </span>
        </div>

        <Tabs defaultValue={firstGroupWithChanges(groupDiffs)} className="p-0">
          <div className="px-3 pt-2">
            <TabsList>
              {(["trading", "universe", "monitors", "prompt"] as const).map(
                (g) => {
                  const n = groupDiffs[g].length;
                  return (
                    <TabsTrigger key={g} value={g} disabled={n === 0}>
                      {GROUPS[g].label}
                      {n > 0 && (
                        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                          {n}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                },
              )}
            </TabsList>
          </div>

          {(["trading", "universe", "monitors", "prompt"] as const).map((g) => (
            <TabsContent key={g} value={g} className="p-3 space-y-3">
              {groupDiffs[g].length === 0 ? (
                <p className="text-xs text-muted-foreground">No changes.</p>
              ) : (
                <>
                  <div className="flex items-center justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroup(g)}
                      className="h-6 text-xs"
                    >
                      {groupDiffs[g].every((d) => approved.has(d.key))
                        ? "Unselect all"
                        : "Select all"}
                    </Button>
                  </div>
                  <div className="space-y-2.5">
                    {groupDiffs[g].map((d) => {
                      const isOn = approved.has(d.key);
                      return (
                        <div
                          key={d.key}
                          className={cn(
                            "flex items-start gap-3 rounded-md border p-2.5 transition-colors",
                            !isOn && "opacity-60",
                          )}
                        >
                          <Checkbox
                            checked={isOn}
                            onCheckedChange={() => toggleField(d.key)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 text-sm">
                            <span className="text-xs text-muted-foreground">
                              {d.label}
                            </span>
                            <div className="flex items-start gap-2 mt-1">
                              <span className="line-through text-red-500 min-w-0 break-words">
                                {d.before}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                              <span className="text-emerald-500 font-medium min-w-0 break-words">
                                {d.after}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </Card>

      {/* Fence preview — shown only when a universe change is approved */}
      {hasUniverseChange && (
        <div className="text-xs text-muted-foreground px-1">
          {fenceLoading ? (
            "Checking fence against recent signals…"
          ) : fenceCount != null ? (
            <>
              Projected fence:{" "}
              <Badge variant="secondary">
                <span className="tabular-nums">{fenceCount}</span>
                <span className="ml-1">signals · last 7d</span>
              </Badge>
            </>
          ) : null}
        </div>
      )}

      {onConfirmConfig && (
        <Button
          onClick={handleApply}
          disabled={isApplying || approvedCount === 0}
          className="w-full h-10"
          size="default"
        >
          <Check className="h-4 w-4 mr-2" />
          {isApplying
            ? confirmingLabel ?? "Applying…"
            : approvedCount === totalChanges
              ? (confirmLabel ?? "Apply Changes")
              : `Apply ${approvedCount} selected change${approvedCount === 1 ? "" : "s"}`}
        </Button>
      )}
    </div>
  );
}

function firstGroupWithChanges(
  diffs: Record<GroupId, FieldDiff[]>,
): GroupId {
  for (const g of ["trading", "universe", "monitors", "prompt"] as const) {
    if (diffs[g].length > 0) return g;
  }
  return "trading";
}
