"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AnalystConfigForm,
  type FormChangeHandler,
} from "@/components/analysts/AnalystConfigForm";
import { applyChange, toFormValues } from "@/components/analysts/builder-config";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

const Silk = dynamic(() => import("@/components/Silk"), { ssr: false });

interface AnalystConfigPanelProps {
  config: AgentConfigData;
  /** Called whenever the user edits a field — parent owns the source of truth. */
  onConfigChange?: (next: AgentConfigData) => void;
  onConfirm: () => void;
  isCreating: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
}

// Panel wrapper — used by the analyst Builder/Editor split layout. Adapts the
// AI-proposal-shaped AgentConfigData into FormValues, mutates a local copy on
// each field change, and bubbles the new config up via onConfigChange so the
// confirm flow sees the edited values.
export function AnalystConfigPanel({
  config,
  onConfigChange,
  onConfirm,
  isCreating,
  confirmLabel = "Create Analyst",
  confirmingLabel = "Creating...",
}: AnalystConfigPanelProps) {
  const [silkActive, setSilkActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSilkActive(false), 2000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (isCreating) setSilkActive(true);
  }, [isCreating]);

  const values = toFormValues(config);

  const handleChange: FormChangeHandler = (field, value) => {
    if (!onConfigChange) return;
    const next = applyChange(config, field, value);
    onConfigChange(next);
  };

  return (
    <div className="flex flex-col h-full rounded-xl border bg-background shadow-2xl overflow-hidden relative">
      {/* Silk intro overlay */}
      <div
        className="absolute inset-0 z-[5] transition-opacity duration-1000 ease-out pointer-events-none"
        style={{ opacity: silkActive ? 1 : 0 }}
      >
        <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
      </div>

      {/* Header — silk avatar + editable name */}
      <div className="relative z-[6] shrink-0 p-3">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-full overflow-hidden shrink-0">
            <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
          </div>
          <Input
            defaultValue={config.name ?? ""}
            placeholder="Untitled Analyst"
            className="text-base font-brand font-semibold flex-1 min-w-0 border-transparent shadow-none focus-visible:border-input"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (config.name ?? "")) handleChange("name", next || "Untitled Analyst");
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="relative z-[6] flex-1 min-h-0">
        <AnalystConfigForm
          values={values}
          onChange={handleChange}
          hideName
          defaultTab="brief"
          showWatchlist
        />
      </div>

      {/* Footer — confirm */}
      <div className="relative z-[6] shrink-0 border-t px-4 py-3 flex">
        <Button onClick={onConfirm} disabled={isCreating} className="w-full">
          <Check className="h-4 w-4 mr-2" />
          {isCreating ? confirmingLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
