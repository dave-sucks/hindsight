/**
 * suggest_podcast_config — the podcast-builder analog of suggest_config.
 *
 * Returns the proposed Podcast + Segments[] for the side panel to
 * preview and confirm. The tool itself does NOT persist anything;
 * persistence happens via lib/actions/podcast.actions.ts when the
 * user clicks Create in the panel.
 *
 * Renders via ui: "podcast-config-preview" which is a thin specialty
 * renderer (mirror of ConfigPreviewRenderer) — it fires
 * onPodcastConfigSuggested via the ToolUICallbacks context so the
 * parent /podcasts/new client opens the side panel with the proposal.
 *
 * See docs/PODCAST_PLAN.md.
 */

import { tool } from "ai";
import { z } from "zod";

const segmentSchema = z.object({
  name: z
    .string()
    .min(2)
    .describe(
      "Short segment name (e.g. 'Top Stories', 'Deep Dive'). Becomes the recurring beat in every episode.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "One-line internal description shown in the segment list. Optional.",
    ),
  segmentPrompt: z
    .string()
    .min(40)
    .describe(
      "2–4 sentence editorial brief for this segment. Specific: what's covered, the angle, what to skip. Adapt to the show's tone.",
    ),
  targetSeconds: z
    .number()
    .int()
    .min(30)
    .max(1800)
    .describe(
      "Approximate spoken length of this segment, in seconds. Sum of all segments should roughly equal episode length.",
    ),
  topics: z
    .array(z.string())
    .min(1)
    .describe(
      "3–6 specific topic tags forming the universe fence (e.g. ['AI', 'venture capital', 'open source']).",
    ),
  sources: z
    .array(z.string())
    .default([])
    .describe(
      "Optional 2–4 preferred domains the segment leans on (e.g. ['techcrunch.com', 'theverge.com']).",
    ),
  excludeTopics: z
    .array(z.string())
    .default([])
    .describe(
      "Topics to skip even if in scope (e.g. ['crypto', 'rumor', 'leak']).",
    ),
});

const podcastConfigSchema = z.object({
  podcast: z.object({
    name: z
      .string()
      .min(2)
      .describe("The show's name — short and clear."),
    description: z
      .string()
      .min(10)
      .describe(
        "1–2 sentence show description. What it covers, who it's for.",
      ),
    hostStyle: z
      .string()
      .optional()
      .describe(
        "One sentence describing the on-mic voice (e.g. 'NPR-style measured with dry wit').",
      ),
    cadence: z
      .enum(["DAILY", "WEEKLY", "ON_DEMAND"])
      .optional()
      .describe(
        "How often new episodes drop. Informational — the user can run on demand regardless.",
      ),
  }),
  segments: z
    .array(segmentSchema)
    .min(1)
    .max(8)
    .describe(
      "3–5 segments is the sweet spot. Each is a recurring beat in every episode.",
    ),
});

export type SuggestedPodcastConfig = z.infer<typeof podcastConfigSchema>;

export const suggestPodcastConfigTool = tool({
  description:
    "Propose a complete podcast configuration: the Podcast (name, description, host style, cadence) plus 3–5 starter Segments with their own prompt, target length, topics, and source hints. Call this exactly once when you have enough information from the interview.",
  inputSchema: podcastConfigSchema,
  execute: async (config) => {
    // Echo back the structured config for the client-side renderer + side panel.
    // No persistence here — the user confirms via createPodcastFromBuilder
    // in the side panel.
    return config;
  },
});
