/**
 * suggest_podcast_config — the podcast-builder analog of suggest_config.
 *
 * Returns the proposed Podcast + Segments[] for the side panel to preview
 * and confirm. Each segment carries its own monitor proposals (domain +
 * search) — same shape as suggest_config's domainMonitorProposal +
 * intelligenceQueries. createPodcastFromBuilder persists those as
 * Monitor rows scoped to the segment via podcastSegmentId.
 *
 * Renders via ui: "podcast-config-preview" which fires
 * onPodcastConfigSuggested through ToolUICallbacks so the side panel
 * opens with the proposal.
 *
 * See docs/PODCAST_PLAN.md.
 */

import { tool } from "ai";
import { z } from "zod";

// Domain-monitor proposal — mirror of suggest_config's domainMonitorProposal
// shape, simplified for podcasts (no qualityScore / category enums; we
// default sensibly on the persistence side).
const segmentDomainMonitorSchema = z.object({
  name: z
    .string()
    .min(2)
    .describe("Source name, e.g. 'TechCrunch' or 'The Verge'."),
  domain: z
    .string()
    .min(3)
    .describe(
      "Bare domain — e.g. 'techcrunch.com'. No protocol, no path.",
    ),
  reason: z
    .string()
    .describe("Why this source matters for this segment's editorial brief."),
});

// Search-query proposal — mirror of intelligenceQueries shape.
// Discovery-flavored: surface NEW material, not per-known-thing tracking.
const segmentSearchQuerySchema = z.object({
  query: z
    .string()
    .min(4)
    .describe(
      "A discovery query the pipeline runs daily via Perplexity Sonar to surface new material for this segment. Time-qualified, topic-scoped. Examples: 'indie game launches this week steam', 'AI infrastructure funding rounds Q2 2026'.",
    ),
  reason: z
    .string()
    .describe("Why this query matters for the segment's editorial scope."),
});

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
  excludeTopics: z
    .array(z.string())
    .default([])
    .describe(
      "Topics to skip even if in scope (e.g. ['crypto', 'rumor', 'leak']).",
    ),
  domainMonitors: z
    .array(segmentDomainMonitorSchema)
    .min(2)
    .max(6)
    .describe(
      "2–6 sites the intelligence pipeline crawls daily for this segment. These get persisted as Monitor rows of type=DOMAIN scoped to the segment, exactly like analyst domain monitors.",
    ),
  searchQueries: z
    .array(segmentSearchQuerySchema)
    .min(2)
    .max(5)
    .describe(
      "2–5 daily Sonar queries that find new material for this segment. Persisted as Monitor rows of type=SEARCH scoped to the segment.",
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
      "3–5 segments is the sweet spot. Each is a recurring beat in every episode and ships with its own monitors.",
    ),
});

export type SuggestedPodcastConfig = z.infer<typeof podcastConfigSchema>;

export const suggestPodcastConfigTool = tool({
  description:
    "Propose a complete podcast configuration: the Podcast (name, description, host style, cadence) plus 3–5 starter Segments. Each segment carries its editorial brief, target length, topic fence, and its own monitor set (domain monitors + search queries) — same monitor infrastructure analysts use. Call this exactly once when you have enough information from the interview.",
  inputSchema: podcastConfigSchema,
  execute: async (config) => {
    // Echo back for the client-side renderer + side panel. No persistence
    // here — the user confirms via createPodcastFromBuilder.
    return config;
  },
});
