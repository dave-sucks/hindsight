/**
 * read_knowledge_library — surfaces the curated knowledge library to
 * the Analyst Builder, Editor, and Manager agents.
 *
 * Three topic modes:
 *   - "archetype" → full StrategyArchetype by ID (or index if id omitted)
 *   - "source"    → full SourceEntry by ID (or index if id omitted)
 *   - "signal"    → full SignalType by ID (or index if id omitted)
 *
 * The builder calls this after the user describes what they want, so
 * it can propose an analyst grounded in a real archetype rather than
 * free-form. The editor uses it when a user says "make it more
 * aggressive" — the archetype delta guides what actually to change.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import {
  getArchetype,
  archetypeIndex,
  getSource,
  sourceIndex,
  getSignalType,
  signalIndex,
} from "@/lib/agent/knowledge";

export const readKnowledgeLibrary = defineTool({
  description:
    "Read an entry from the Hindsight knowledge library — curated strategy archetypes, vetted research sources, and the signal-type taxonomy. " +
    "Call with {topic:'archetype'|'source'|'signal'} and optionally an id. Without an id you get the index; with an id you get the full entry. " +
    "Use this BEFORE calling suggest_config so your proposed config is grounded in a real archetype's prompt skeleton, signal set, and source list.",
  schema: z.object({
    topic: z.enum(["archetype", "source", "signal"]).describe(
      "Which catalog to query: 'archetype' for trading styles, 'source' for research sources, 'signal' for signal types.",
    ),
    id: z.string().optional().describe(
      "The entry ID (e.g. 'EARNINGS_DRIFT', 'SEC_EDGAR', 'INSIDER_BUYING'). Leave empty to list the index.",
    ),
  }),
  ui: "generic" as const,
  groupId: "Knowledge",

  execute: async (args) => {
    const { topic, id } = args;

    if (topic === "archetype") {
      if (!id) {
        const index = archetypeIndex();
        return {
          summary: `Archetype index — ${index.length} entries`,
          data: {
            topic: "archetype" as const,
            mode: "index" as const,
            count: index.length,
            index,
          },
          sources: [],
        };
      }
      const entry = getArchetype(id);
      if (!entry) {
        return {
          summary: `Unknown archetype: ${id}`,
          data: {
            topic: "archetype" as const,
            mode: "entry" as const,
            found: false,
            id,
            hint: `Known IDs: ${archetypeIndex().map((a) => a.id).join(", ")}`,
          },
          sources: [],
        };
      }
      return {
        summary: `Archetype: ${entry.name}`,
        data: {
          topic: "archetype" as const,
          mode: "entry" as const,
          found: true,
          entry,
        },
        sources: [],
      };
    }

    if (topic === "source") {
      if (!id) {
        const index = sourceIndex();
        return {
          summary: `Source index — ${index.length} entries`,
          data: {
            topic: "source" as const,
            mode: "index" as const,
            count: index.length,
            index,
          },
          sources: [],
        };
      }
      const entry = getSource(id);
      if (!entry) {
        return {
          summary: `Unknown source: ${id}`,
          data: {
            topic: "source" as const,
            mode: "entry" as const,
            found: false,
            id,
            hint: `Known IDs: ${sourceIndex().slice(0, 15).map((s) => s.id).join(", ")}…`,
          },
          sources: [],
        };
      }
      return {
        summary: `Source: ${entry.name}`,
        data: {
          topic: "source" as const,
          mode: "entry" as const,
          found: true,
          entry,
        },
        sources: [],
      };
    }

    // topic === "signal"
    if (!id) {
      const index = signalIndex();
      return {
        summary: `Signal-type index — ${index.length} entries`,
        data: {
          topic: "signal" as const,
          mode: "index" as const,
          count: index.length,
          index,
        },
        sources: [],
      };
    }
    const entry = getSignalType(id);
    if (!entry) {
      return {
        summary: `Unknown signal type: ${id}`,
        data: {
          topic: "signal" as const,
          mode: "entry" as const,
          found: false,
          id,
          hint: `Known IDs: ${signalIndex().map((s) => s.id).join(", ")}`,
        },
        sources: [],
      };
    }
    return {
      summary: `Signal type: ${entry.name}`,
      data: {
        topic: "signal" as const,
        mode: "entry" as const,
        found: true,
        entry,
      },
      sources: [],
    };
  },
});
