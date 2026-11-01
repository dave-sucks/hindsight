/**
 * The builder and editor proposal on its way to the database: the side
 * panel's view of it, the owner's edits on the panel, and the payload Create
 * and Apply send. One file, so a field the panel shows is a field that saves.
 */

import type { AgentConfigData } from "@/components/domain/agent-config-card";
import type { FormValues } from "@/components/analysts/AnalystConfigForm";
import type { BuilderConfig } from "@/lib/actions/analyst.actions";
import { NEW_ANALYST_DEFAULTS as D } from "@/lib/analyst-settings";

// ─── The panel: AgentConfigData ↔ FormValues ────────────────────────────────

export function toFormValues(config: AgentConfigData): FormValues {
  const watchlist = (config.watchlist ?? []).map((w) =>
    typeof w === "string" ? w : w.symbol,
  );

  return {
    name: config.name ?? "",
    description: config.description ?? null,
    analystPrompt: config.analystPrompt ?? null,
    watchlist,
    directionBias: config.directionBias ?? D.directionBias,
    holdDurations: config.holdDurations ?? D.holdDurations,
    setupIds: config.setupIds ?? [],
    minConfidence: config.minConfidence ?? D.minConfidence,
    maxOpenPositions: config.maxOpenPositions ?? D.maxOpenPositions,
    riskPct: config.riskPct ?? D.riskPct,
    minPositionSize: config.minPositionSize ?? D.minPositionSize,
    maxPositionSize: config.maxPositionSize ?? D.maxPositionSize,
    maxPositionTotal: config.maxPositionTotal ?? D.maxPositionTotal,
    sectors: config.sectors ?? [],
    marketCapMin: config.marketCapMin ?? null,
    marketCapMax: config.marketCapMax ?? null,
    exclusionList: config.exclusionList ?? [],
  };
}

export function applyChange<K extends keyof FormValues>(
  config: AgentConfigData,
  field: K,
  value: FormValues[K],
): AgentConfigData {
  // Pass-through fields where AgentConfigData and FormValues align 1:1.
  switch (field) {
    case "name":
    case "description":
    case "analystPrompt":
    case "directionBias":
    case "holdDurations":
    case "setupIds":
    case "minConfidence":
    case "maxOpenPositions":
    case "riskPct":
    case "minPositionSize":
    case "maxPositionSize":
    case "maxPositionTotal":
    case "sectors":
    case "marketCapMin":
    case "marketCapMax":
    case "exclusionList":
      return { ...config, [field]: value } as AgentConfigData;

    case "watchlist":
      return { ...config, watchlist: value as string[] };

    default:
      return config;
  }
}

/**
 * The editor panel's starting point: the analyst as it is, with the proposal
 * on top. A field the proposal leaves out (the money, unless the owner named
 * an amount; risk per trade; most in one stock; the direction) starts from
 * the analyst's own, never from a new analyst's default.
 */
export function editorPanelStart(
  currentConfig: Record<string, unknown>,
  proposed: AgentConfigData,
): AgentConfigData {
  const named = Object.fromEntries(Object.entries(proposed).filter(([, v]) => v !== undefined));
  return { ...(currentConfig as AgentConfigData), ...named };
}

// ─── Create and Apply ───────────────────────────────────────────────────────

/** Create: the builder's proposal as edited on the panel. */
export function toCreateInput(config: AgentConfigData): BuilderConfig {
  return {
    name: config.name ?? "Untitled Analyst",
    analystPrompt: config.analystPrompt ?? "General market research analyst",
    description: config.description,
    directionBias: config.directionBias ?? D.directionBias,
    holdDurations: (config.holdDurations ?? D.holdDurations) as BuilderConfig["holdDurations"],
    setupIds: config.setupIds,
    sectors: config.sectors ?? [],
    minConfidence: config.minConfidence ?? D.minConfidence,
    riskPct: config.riskPct,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize ?? D.maxPositionSize,
    maxPositionTotal: config.maxPositionTotal,
    maxOpenPositions: config.maxOpenPositions ?? D.maxOpenPositions,
    watchlist: (config.watchlist ?? []) as string[],
    exclusionList: (config.exclusionList ?? []) as string[],
    marketCapMin: config.marketCapMin ?? undefined,
    marketCapMax: config.marketCapMax ?? undefined,
  };
}

/** Apply: the editor's proposal. A field left undefined leaves the analyst's value alone. */
export function toApplyInput(config: AgentConfigData): Partial<BuilderConfig> {
  return {
    name: config.name,
    description: config.description,
    analystPrompt: config.analystPrompt,
    directionBias: config.directionBias,
    holdDurations: config.holdDurations as BuilderConfig["holdDurations"] | undefined,
    setupIds: config.setupIds,
    sectors: config.sectors,
    minConfidence: config.minConfidence,
    riskPct: config.riskPct,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize,
    maxPositionTotal: config.maxPositionTotal,
    maxOpenPositions: config.maxOpenPositions,
    watchlist: config.watchlist as string[] | undefined,
    exclusionList: config.exclusionList as string[] | undefined,
    // null removes a bound; undefined keeps it.
    marketCapMin: config.marketCapMin,
    marketCapMax: config.marketCapMax,
  };
}
