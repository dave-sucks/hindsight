"use client";

import { createContext, useContext } from "react";
import type { SourceChipData } from "@/components/chat/SourceChip";

const SourcesContext = createContext<SourceChipData[]>([]);

export function SourcesProvider({
  sources,
  children,
}: {
  sources: SourceChipData[];
  children: React.ReactNode;
}) {
  return (
    <SourcesContext.Provider value={sources}>
      {children}
    </SourcesContext.Provider>
  );
}

export function useSources(): SourceChipData[] {
  return useContext(SourcesContext);
}

/**
 * Extract _sources from all tool-call results in a message's content parts.
 * Sources are flattened in order of appearance and numbered sequentially.
 */
export function extractSourcesFromParts(
  parts: Array<{ type: string; result?: unknown }>,
): SourceChipData[] {
  const allSources: SourceChipData[] = [];

  for (const part of parts) {
    if (part.type !== "tool-call" || !part.result) continue;

    const result = part.result as Record<string, unknown>;
    const sources = result._sources;
    if (!Array.isArray(sources)) continue;

    for (const s of sources) {
      if (typeof s === "object" && s !== null && "provider" in s && "title" in s) {
        allSources.push({
          provider: String(s.provider),
          title: String(s.title),
          url: typeof s.url === "string" ? s.url : undefined,
          excerpt: typeof s.excerpt === "string" ? s.excerpt : undefined,
        });
      }
    }
  }

  return allSources;
}
