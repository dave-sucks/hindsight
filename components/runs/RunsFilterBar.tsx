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

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedAnalystId ?? ALL}
        onValueChange={(v) => updateParam("analyst", v ?? ALL)}
      >
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue placeholder="All analysts" />
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
        value={selectedMode ?? ALL}
        onValueChange={(v) => updateParam("mode", v ?? ALL)}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="All types" />
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
