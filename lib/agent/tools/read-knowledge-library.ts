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

  progressLabel: (args) => {
    const humanize = (id: string) =>
      id
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    if (args.topic === "archetype") {
      return args.id
        ? `Reading the ${humanize(args.id)} playbook`
        : "Looking at the strategy playbook library";
    }
    if (args.topic === "signal") {
      return args.id
        ? `Reading the ${humanize(args.id)} signal type`
        : "Looking at the signal types we track";
    }
    // topic === "source"
    return args.id
      ? `Reading ${humanize(args.id)}'s source profile`
      : "Looking at trusted research sources";
  },

  execute: async (args) => {
    const { topic, id } = args;

    // Preview N names inline in the summary so the reader can see what's
    // actually in each catalog without expanding the row. Caps at 5 names
    // + "… and N more" so the line stays on-card.
    const previewNames = (names: string[]): string => {
      if (names.length === 0) return "(empty)";
      if (names.length <= 5) return names.join(", ");
      return `${names.slice(0, 5).join(", ")}, and ${names.length - 5} more`;
    };

    if (topic === "archetype") {
      if (!id) {
        const index = archetypeIndex();
        return {
          summary: `${index.length} playbooks: ${previewNames(index.map((a) => a.name))}`,
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
          summary: `Unknown playbook: ${id}`,
          data: {
            topic: "archetype" as const,
            mode: "entry" as const,
            found: false,
            id,
            hint: `Available playbooks: ${archetypeIndex().map((a) => a.name).join(", ")}`,
          },
          sources: [],
        };
      }
      return {
        summary: `Loaded the ${entry.name} playbook`,
        data: {
          topic: "archetype" as const,
          mode: "entry" as const,
          found: true,
          entry,
        },
        // Emit the playbook as a citable source — the Editor/Builder prose
        // references these with [N] markers and the chat turns them into
        // InlineCitationCard chips via extractSourcesFromParts.
        sources: [
          {
            provider: "Strategy Playbook",
            title: entry.name,
          },
        ],
      };
    }

    if (topic === "source") {
      if (!id) {
        const index = sourceIndex();
        return {
          summary: `${index.length} research sources: ${previewNames(index.map((s) => s.name))}`,
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
            hint: `Known sources: ${sourceIndex().slice(0, 15).map((s) => s.name).join(", ")}…`,
          },
          sources: [],
        };
      }
      return {
        summary: `Loaded source profile: ${entry.name}`,
        data: {
          topic: "source" as const,
          mode: "entry" as const,
          found: true,
          entry,
        },
        sources: [
          {
            provider: "Research Source",
            title: entry.name,
            url: entry.domain ? `https://${entry.domain}` : undefined,
          },
        ],
      };
    }

    // topic === "signal"
    if (!id) {
      const index = signalIndex();
      return {
        summary: `${index.length} signal types: ${previewNames(index.map((s) => s.name))}`,
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
          hint: `Known signal types: ${signalIndex().map((s) => s.name).join(", ")}`,
        },
        sources: [],
      };
    }
    return {
      summary: `Loaded signal type: ${entry.name}`,
      data: {
        topic: "signal" as const,
        mode: "entry" as const,
        found: true,
        entry,
      },
      sources: [
        {
          provider: "Signal Type",
          title: entry.name,
        },
      ],
    };
  },
});
