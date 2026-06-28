// ── Shared thesis-ingest core ────────────────────────────────────────────────
// Mints a Thesis from external-chat JSON by pushing it through the SAME
// `record_thesis` logic the agent uses (taxonomy + trigger generation + gates),
// at ZERO LLM cost. Two entry points share this:
//   - app/api/intelligence/thesis-ingest/route.ts  (secret-auth, for Postman/MCP)
//   - lib/actions/thesis-ingest.actions.ts          (app-auth, for the paste UI)
// See docs/plans/EXTERNAL_THESIS_INGEST.md.

import { prisma } from "@/lib/prisma";
import { recordThesis } from "@/lib/agent/tools/record-thesis";
import { createToolContext } from "@/lib/agent/tool-context";

export type IngestResult =
  | { ok: true; runId: string; summary: string; thesis: unknown }
  | { ok: false; status: number; error: string; runId?: string };

/**
 * `payload` is the `record_thesis` args as a plain object, plus an `analyst`
 * (name) or `analyst_id` envelope field. Never persists `triggers` from the
 * caller — record_thesis generates them from horizon + prices.
 */
export async function ingestThesis(
  payload: Record<string, unknown>,
): Promise<IngestResult> {
  const { analyst, analyst_id, ...thesisArgs } = payload as {
    analyst?: string;
    analyst_id?: string;
    [k: string]: unknown;
  };

  if (typeof thesisArgs.ticker !== "string" || thesisArgs.ticker.length === 0) {
    return { ok: false, status: 400, error: "ticker is required" };
  }

  const config = analyst_id
    ? await prisma.agentConfig.findUnique({ where: { id: analyst_id } })
    : analyst
      ? await prisma.agentConfig.findFirst({
          where: { name: { equals: analyst, mode: "insensitive" } },
        })
      : null;

  if (!config) {
    return {
      ok: false,
      status: 404,
      error: `analyst not found: ${analyst_id ?? analyst ?? "(none provided — pass 'analyst' or 'analyst_id')"}`,
    };
  }

  const runEnvironment =
    (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";

  // Container run — record_thesis links Thesis → ResearchRun via runId.
  const run = await prisma.researchRun.create({
    data: {
      userId: config.userId,
      accountId: config.accountId,
      agentConfigId: config.id,
      source: "MANUAL",
      status: "COMPLETE",
      mode: "EXTERNAL_INGEST",
      environment: runEnvironment,
      parameters: {
        source: "external-chat-ingest",
        ticker: thesisArgs.ticker.toUpperCase(),
        analystName: config.name,
      },
      completedAt: new Date(),
    },
  });

  // calledTickers left undefined → the "get_stock_data was called this run"
  // provenance gate is skipped (record-thesis.ts:581, the older-path exception).
  // The research happened in the external chat, not via in-run tool calls.
  const ctx = createToolContext({
    runId: run.id,
    userId: config.userId,
    accountId: config.accountId,
    analystId: config.id,
    runMode: "EXTERNAL_INGEST",
    runEnvironment,
    forceWatchingMint: true, // an ingested mint is exploratory → WATCHING
  });

  // Default provenance so the chat JSON can stay focused on research + decision.
  const args = {
    source_kind: "WEB_SEARCH",
    source_rationale: "External chat research, operator-curated via thesis-ingest.",
    ...thesisArgs,
  };

  const tool = recordThesis(ctx);
  // defineTool's wrapped execute takes args only and returns a ToolResult
  // envelope; the AI SDK Tool type wants (input, options), so cast at the call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await (tool.execute as any)(args, {
    toolCallId: "thesis-ingest",
    messages: [],
  });

  if (!result || result.ok !== true) {
    await prisma.researchRun.update({
      where: { id: run.id },
      data: { status: "FAILED" },
    });
    return {
      ok: false,
      status: 422,
      error: result?.error ?? "record_thesis rejected the input",
      runId: run.id,
    };
  }

  return {
    ok: true,
    runId: run.id,
    summary: result.summary,
    thesis: result.data,
  };
}
