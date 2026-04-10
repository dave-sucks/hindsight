/**
 * defineTool() — factory for the new tool pipeline.
 *
 * Wraps every tool execute function with:
 *   - Timing + structured logging
 *   - try/catch → ToolResult.ok:false on errors
 *   - Consistent ToolResult envelope (ok, ui, groupId, summary, data, sources)
 *
 * Usage:
 *   export const getEarningsData = defineTool({
 *     description: "Get earnings data for a ticker",
 *     schema: z.object({ ticker: z.string() }),
 *     ui: "ticker",
 *     groupId: "research",
 *     execute: async ({ ticker }, ctx) => {
 *       const data = await fetchEarnings(ticker);
 *       return { summary: `Earnings for ${ticker}`, data, sources: [] };
 *     },
 *   });
 *
 *   // In the route:
 *   const tools = { get_earnings_data: getEarningsData(ctx) };
 */

import { tool } from "ai";
import type { z } from "zod";
import type { ToolContext } from "./tool-context";
import type { ToolUI, ToolSource, ToolResult } from "./tool-result";
import type { AgentMode } from "./modes";

interface DefineToolOptions<TSchema extends z.ZodTypeAny, TData = unknown> {
  description: string;
  /** Zod schema for input args */
  schema: TSchema;
  /** Which UI renderer handles this tool's result */
  ui: ToolUI;
  /** Optional phase key — tools with the same groupId collapse in the UI */
  groupId?: string;
  /** If set, this tool is only included when the mode matches */
  modes?: AgentMode[];
  execute: (
    args: z.infer<TSchema>,
    ctx: ToolContext,
  ) => Promise<{
    summary: string;
    data: TData;
    sources?: ToolSource[];
  }>;
}

/** A defineTool call returns a "tool factory" — call it with ctx to get an AI SDK tool. */
export type ToolFactory<TSchema extends z.ZodTypeAny, TData = unknown> = (
  ctx: ToolContext,
) => ReturnType<typeof tool<TSchema, ToolResult<TData>>>;

export function defineTool<TSchema extends z.ZodTypeAny, TData = unknown>(
  options: DefineToolOptions<TSchema, TData>,
): ToolFactory<TSchema, TData> {
  return function makeToolInstance(ctx: ToolContext) {
    return tool<TSchema, ToolResult<TData>>({
      description: options.description,
      inputSchema: options.schema,
      execute: async (args): Promise<ToolResult<TData>> => {
        const t0 = Date.now();
        const resolvedGroupId = options.groupId
          ? ctx.groupId(options.groupId)
          : undefined;
        const label = options.description.slice(0, 40);

        console.log(`[tool] START "${label}" runId=${ctx.runId}`);

        try {
          const result = await options.execute(args, ctx);
          const elapsed = Date.now() - t0;
          console.log(`[tool] END "${label}" ${elapsed}ms runId=${ctx.runId}`);

          return {
            ok: true as const,
            ui: options.ui,
            ...(resolvedGroupId !== undefined ? { groupId: resolvedGroupId } : {}),
            summary: result.summary,
            data: result.data,
            sources: result.sources ?? [],
          };
        } catch (err) {
          const elapsed = Date.now() - t0;
          const msg = err instanceof Error ? err.message : "Tool failed";
          console.error(
            `[tool] FAILED "${label}" ${elapsed}ms runId=${ctx.runId}:`,
            msg,
          );
          return {
            ok: false as const,
            error: msg,
            retryable: false,
            sources: [],
          };
        }
      },
    });
  };
}
