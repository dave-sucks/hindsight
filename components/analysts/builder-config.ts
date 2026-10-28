/**
 * The builder and editor proposal on its way to the database: the side
 * panel's view of it, the owner's edits on the panel, and the payload Create
 * and Apply send. One file, so a field the panel shows is a field that saves.
 */

import type { AgentConfigData } from "@/components/domain/agent-config-card";
import type { FormValues } from "@/components/analysts/AnalystConfigForm";
import type { BuilderConfig } from "@/lib/actions/analyst.actions";

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
    directionBias: config.directionBias ?? "LONG",
    holdDurations: config.holdDurations ?? ["SWING"],
    setupIds: config.setupIds ?? [],
    minConfidence: config.minConfidence ?? 65,
    maxOpenPositions: config.maxOpenPositions ?? 5,
    riskPct: config.riskPct,
    minPositionSize: config.minPositionSize ?? 0,
    maxPositionSize: config.maxPositionSize ?? 5000,
    maxPositionTotal: config.maxPositionTotal,
    intelligencePolicy: config.intelligencePolicy ?? null,
    sectors: config.sectors ?? [],
    industries: config.industries ?? [],
    themes: config.themes ?? [],
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
    case "industries":
    case "themes":
    case "marketCapMin":
    case "marketCapMax":
    case "exclusionList":
    case "intelligencePolicy":
      return { ...config, [field]: value } as AgentConfigData;

    case "watchlist":
      return { ...config, watchlist: value as string[] };

    default:
      return config;
  }
}

/**
 * The editor panel's starting point. suggest_config carries no risk per trade
 * or most in one stock, so those start from the analyst's own.
 */
export function editorPanelStart(
  currentConfig: Record<string, unknown>,
  proposed: AgentConfigData,
): AgentConfigData {
  return {
    riskPct: currentConfig.riskPct as number | undefined,
    maxPositionTotal: currentConfig.maxPositionTotal as number | undefined,
    ...proposed,
  };
}

// ─── Create and Apply ───────────────────────────────────────────────────────

/** Create: the builder's proposal as edited on the panel. */
export function toCreateInput(config: AgentConfigData): BuilderConfig {
  return {
    name: config.name ?? "Untitled Analyst",
    analystPrompt: config.analystPrompt ?? "General market research analyst",
    description: config.description,
    directionBias: config.directionBias ?? "LONG",
    holdDurations: (config.holdDurations ?? ["SWING"]) as BuilderConfig["holdDurations"],
    setupIds: config.setupIds,
    sectors: config.sectors ?? [],
    signalTypes: config.signalTypes ?? [],
    minConfidence: config.minConfidence ?? 65,
    riskPct: config.riskPct,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize ?? 5000,
    maxPositionTotal: config.maxPositionTotal,
    maxOpenPositions: config.maxOpenPositions ?? 5,
    minMarketCapTier: (config.minMarketCapTier ?? "LARGE") as BuilderConfig["minMarketCapTier"],
    watchlist: (config.watchlist ?? []) as string[],
    exclusionList: (config.exclusionList ?? []) as string[],
    intelligencePolicy: config.intelligencePolicy,
    universe: {
      sectors: config.sectors,
      industries: config.industries,
      themes: config.themes,
      marketCapMin: config.marketCapMin ?? undefined,
      marketCapMax: config.marketCapMax ?? undefined,
    },
  };
}

const UNIVERSE_KEYS = ["sectors", "industries", "themes", "marketCapMin", "marketCapMax"] as const;

/** Apply: the editor's proposal. A field left undefined leaves the analyst's value alone. */
export function toApplyInput(config: AgentConfigData): Partial<BuilderConfig> {
  const universe = UNIVERSE_KEYS.some((k) => config[k] !== undefined)
    ? {
        sectors: config.sectors,
        industries: config.industries,
        themes: config.themes,
        marketCapMin: config.marketCapMin ?? undefined,
        marketCapMax: config.marketCapMax ?? undefined,
      }
    : undefined;

  return {
    name: config.name,
    description: config.description,
    analystPrompt: config.analystPrompt,
    directionBias: config.directionBias,
    holdDurations: config.holdDurations as BuilderConfig["holdDurations"] | undefined,
    setupIds: config.setupIds,
    sectors: config.sectors,
    signalTypes: config.signalTypes,
    minConfidence: config.minConfidence,
    riskPct: config.riskPct,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize,
    maxPositionTotal: config.maxPositionTotal,
    maxOpenPositions: config.maxOpenPositions,
    minMarketCapTier: config.minMarketCapTier as BuilderConfig["minMarketCapTier"] | undefined,
    watchlist: config.watchlist as string[] | undefined,
    exclusionList: config.exclusionList as string[] | undefined,
    intelligencePolicy: config.intelligencePolicy,
    universe,
  };
}
