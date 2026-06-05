"use client";

import { useState, useEffect } from "react";
import { InfoRow } from "@/components/ui/info-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RESEARCH_MODEL_OPTIONS } from "@/lib/agent/modes";

const MODEL_PREF_KEY = "hindsight_research_model";
const DEFAULT_MODEL = "gpt-4o";

/**
 * Default research model — a single InfoRow rendered inside a Profile
 * SettingsSection. No outer Card; the section supplies it.
 */
export function ModelPreferenceForm({ border = true }: { border?: boolean }) {
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(MODEL_PREF_KEY);
    const valid = RESEARCH_MODEL_OPTIONS.some((o) => o.value === stored);
    setSelectedModel(valid && stored ? stored : DEFAULT_MODEL);
    setMounted(true);
  }, []);

  function handleChange(value: string) {
    setSelectedModel(value);
    localStorage.setItem(MODEL_PREF_KEY, value);
  }

  const current = RESEARCH_MODEL_OPTIONS.find((o) => o.value === selectedModel);

  return (
    <InfoRow
      label="Default research model"
      description="Used when starting a new analyst run. Can be changed per-run in the chat composer."
      border={border}
    >
      <Select value={selectedModel} onValueChange={(v) => v && handleChange(v)} disabled={!mounted}>
        <SelectTrigger size="sm">
          <SelectValue>{current?.label ?? selectedModel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RESEARCH_MODEL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </InfoRow>
  );
}
