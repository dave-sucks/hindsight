"use client";

import { createContext, useContext } from "react";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

// ─── Context for passing callbacks into tool UIs ────────────────────────────

export type ToolUICallbacks = {
  /** Builder mode: create from config */
  onConfirmConfig?: (config: AgentConfigData) => void;
  /** Builder mode: notify parent that config was suggested (for panel) */
  onConfigSuggested?: (config: AgentConfigData) => void;
  isCreating?: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
  /** Editor mode: apply diff against existing config */
  currentConfig?: Record<string, unknown>;
  onApplyConfig?: (config: AgentConfigData) => void;
  isApplying?: boolean;
  applied?: boolean;
};

const ToolUICallbacksContext = createContext<ToolUICallbacks>({});

export const ToolUICallbacksProvider = ToolUICallbacksContext.Provider;
export const useToolUICallbacks = () => useContext(ToolUICallbacksContext);

// ─── Source attribution helpers ─────────────────────────────────────────────

export interface SourceData {
  provider: string;
  title: string;
  url?: string;
  excerpt?: string;
}

/** Extract _sources from a tool result, falling back to provider-only strings */
export function extractToolSources(result: Record<string, unknown>): SourceData[] {
  const raw = result._sources;
  if (Array.isArray(raw)) {
    return raw.filter(
      (s): s is SourceData =>
        typeof s === "object" && s !== null && "provider" in s && "title" in s,
    );
  }
  return [];
}
