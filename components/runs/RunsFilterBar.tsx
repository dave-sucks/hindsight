"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RUNS_MODE_OPTIONS } from "@/lib/runs/modes";

export type RunsFilterAnalyst = { id: string; name: string };

const ALL = "all";

interface Props {
  analysts: RunsFilterAnalyst[];
  selectedAnalystId: string | null;
  selectedMode: string | null;
}

export function RunsFilterBar({
  analysts,
  selectedAnalystId,
  selectedMode,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      if (value === ALL) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const qs = next.toString();
      router.push(qs ? `/runs?${qs}` : "/runs");
    },
    [params, router],
  );

  const analystItems = [
    { value: ALL, label: "All analysts" },
    ...analysts.map((a) => ({ value: a.id, label: a.name })),
  ];
  const modeItems = [
    { value: ALL, label: "All types" },
    ...RUNS_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  ];

  return (
    <div className="flex items-center gap-2">
      {/* Dropdown filters start on a real "All …" item; `items` gives the
          closed trigger its label rather than the raw value. */}
      <Select
        items={analystItems}
        value={selectedAnalystId ?? ALL}
        onValueChange={(v) => updateParam("analyst", v ?? ALL)}
      >
        <SelectTrigger size="sm" aria-label="Filter by analyst">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All analysts</SelectItem>
          {analysts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={modeItems}
        value={selectedMode ?? ALL}
        onValueChange={(v) => updateParam("mode", v ?? ALL)}
      >
        <SelectTrigger size="sm" aria-label="Filter by run type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {RUNS_MODE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
