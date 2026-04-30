/**
 * ask_question — structured-interview primitive used by the Analyst
 * Builder, Editor, Podcast Builder/Editor, etc.
 *
 * Two modes, dispatched by which arg the agent provides:
 *
 * 1. **Single question** (`question` + `options`) — a standalone
 *    quick-reply card. No "Step N" label, no progress bar.
 *
 * 2. **Multi-step flow** (`steps[]`) — bundles 2-N related questions
 *    into a SINGLE rendered card with "Step N of M" + progress bar.
 *    The user answers them in sequence inside the same card; on
 *    Complete, all answers come back at once. This is the "real"
 *    QuestionFlow — use it for any session where you need ≥2
 *    pieces of information up front (tone + sources + cadence,
 *    direction + hold duration + sectors, etc.).
 *
 * The server-side execute is a no-op echo — the actual "answer"
 * arrives as the next user message, appended by the client when the
 * user submits. This lets us use Vercel AI SDK streamText out of the
 * box without plumbing addToolResult callbacks.
 *
 * The emitted `data` payload conforms to the Tool-UI Question Flow
 * library's `SerializableProgressiveMode` (single) or
 * `SerializableUpfrontMode` (multi-step) schema:
 *   https://www.tool-ui.com/docs/question-flow
 *
 * Design rules:
 *   - 2-5 options per question. Fewer than 2 is not multiple-choice;
 *     more than 5 overwhelms.
 *   - question / step.title must be a complete, stand-alone sentence
 *     ending in "?".
 *   - Multi-step flows: 2-5 steps. More than 5 is a survey, not a
 *     question flow.
 *   - Only call when the answers would materially change what you
 *     propose. Don't quiz the user for fun.
 *   - The agent's turn TERMINATES on this tool call (route-side stop
 *     condition). Do not narrate after — the user answers via the UI
 *     and the agent picks up from there.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";

/** Slugify an option label into a stable id (a–z, 0–9, dashes). */
function toOptionId(label: string, i: number): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : `opt-${i + 1}`;
}

const optionSchema = z.object({
  label: z
    .string()
    .describe("Short quick-reply label (≤ 40 chars)."),
  description: z
    .string()
    .optional()
    .describe("Optional one-line subtext explaining the choice."),
});

const stepSchema = z.object({
  title: z
    .string()
    .describe(
      "The step's question text. Complete sentence ending in '?'. Self-contained.",
    ),
  description: z
    .string()
    .optional()
    .describe("Optional one-line helper text under the question."),
  options: z
    .array(optionSchema)
    .min(2)
    .max(5)
    .describe("2-5 plausible answers for this step."),
  selectionMode: z
    .enum(["single", "multi"])
    .optional()
    .describe(
      "'single' (default) picks one; 'multi' lets the user pick several.",
    ),
});

export const askQuestion = defineTool({
  description:
    "Ask the user a structured question (or a short flow of related questions) with quick-reply options. Use this WHENEVER you need discrete user input to make a decision — never list options in prose.\n\n" +
    "TWO MODES:\n" +
    "1. Single question — provide `question` + `options`. Renders as a clean card with no step label.\n" +
    "2. Multi-step flow — provide `steps[]` (2-5 questions). Renders as ONE card with progress bar; user answers each step in sequence and the agent gets all answers back at once. Use this for any session needing ≥2 inputs (e.g. tone + sources + cadence, direction + hold + sectors).\n\n" +
    "Prefer the multi-step form for related groups of questions — it's faster for the user, the agent gets a complete answer set, and the UX is one card instead of N separate ones.\n\n" +
    "After this tool call your turn ENDS. Do not narrate further. The user answers via the UI and you pick up from there.",
  schema: z
    .object({
      // Mode 1 fields (single question)
      question: z
        .string()
        .optional()
        .describe(
          "Single-question mode. Complete sentence ending in '?'. Use this OR `steps`, not both — if both are provided, `steps` wins.",
        ),
      description: z
        .string()
        .optional()
        .describe("Optional helper text under a single question."),
      options: z
        .array(optionSchema)
        .min(2)
        .max(5)
        .optional()
        .describe(
          "Single-question mode: 2-5 options. Use this OR `steps`, not both — if both are provided, `steps` wins.",
        ),
      selectionMode: z
        .enum(["single", "multi"])
        .optional()
        .describe(
          "Single-question mode: 'single' (default) picks one; 'multi' picks several.",
        ),
      // Mode 2 field (multi-step flow)
      steps: z
        .array(stepSchema)
        .min(2)
        .max(5)
        .optional()
        .describe(
          "Multi-step flow mode: 2-5 related questions rendered as one card. PREFER this when you have ≥2 related questions for the user — it's a single card with progress bar. When provided, `question`/`options` are ignored.",
        ),
      purpose: z
        .string()
        .optional()
        .describe(
          "Short internal tag for telemetry — e.g. 'direction_bias', 'segment_design'. Not shown to the user.",
        ),
    })
    .refine(
      (v) =>
        Array.isArray(v.steps) ||
        (typeof v.question === "string" && Array.isArray(v.options)),
      {
        message:
          "Provide either `steps[]` for a multi-step flow OR `question` + `options` for a single question.",
      },
    ),
  ui: "ask-question" as const,

  // NOTE: intentionally no groupId and no progressLabel.
  // Questions render as a standalone QuestionFlow panel — no progress row,
  // no ToolProgress wrapper, no group header. The question itself is the UI.

  execute: async (args, ctx) => {
    const baseId = `ask-${ctx.runId}-${Date.now()}`;

    // ── Multi-step (Upfront) mode ────────────────────────────────────────
    if (Array.isArray(args.steps)) {
      const steps = args.steps.map((s, sIdx) => ({
        id: `step-${sIdx + 1}`,
        title: s.title,
        ...(s.description ? { description: s.description } : {}),
        options: s.options.map((opt, oIdx) => ({
          id: toOptionId(opt.label, oIdx),
          label: opt.label,
          ...(opt.description ? { description: opt.description } : {}),
        })),
        selectionMode: s.selectionMode ?? ("single" as const),
      }));
      const summary =
        steps.length === 1
          ? steps[0].title
          : `${steps.length}-step flow: ${steps.map((s) => s.title).join(" → ")}`;
      return {
        summary,
        data: {
          // Question Flow Upfront serializable schema
          id: baseId,
          steps,
          // Internal metadata
          purpose: args.purpose ?? null,
        },
        sources: [],
      };
    }

    // ── Single-question (Progressive) mode ───────────────────────────────
    const options = (args.options ?? []).map((opt, i) => ({
      id: toOptionId(opt.label, i),
      label: opt.label,
      ...(opt.description ? { description: opt.description } : {}),
    }));

    return {
      summary: args.question ?? "",
      data: {
        // Question Flow Progressive serializable schema
        id: baseId,
        step: 1,
        title: args.question ?? "",
        ...(args.description ? { description: args.description } : {}),
        options,
        selectionMode: args.selectionMode ?? "single",
        // Internal metadata
        purpose: args.purpose ?? null,
      },
      sources: [],
    };
  },
});
