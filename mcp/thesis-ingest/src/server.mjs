#!/usr/bin/env node
// ── Hindsight thesis-ingest MCP server ───────────────────────────────────────
// Exposes ONE tool, `save_thesis`, that mints a WATCHING thesis in Hindsight
// from a JSON object — at ZERO LLM cost. It wraps the deployed HTTP endpoint
// (POST /api/intelligence/thesis-ingest); the server-side record_thesis logic
// does all validation, taxonomy, gating, and trigger generation. This process
// holds no DB connection — just the ingest URL + secret.
//
// The whole point: research a name in a flat-rate Claude/GPT chat, then have
// the assistant call save_thesis directly (no copy-paste into the web UI).
//
// Config (env, or a Claude Desktop `env` block):
//   HINDSIGHT_INGEST_URL   full endpoint URL, e.g.
//                          https://<your-app>.vercel.app/api/intelligence/thesis-ingest
//   THESIS_INGEST_SECRET   must match the value set in Vercel
//
// See docs/plans/EXTERNAL_THESIS_INGEST.md and docs/prompts/INGEST_THESIS.md.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const INGEST_URL = process.env.HINDSIGHT_INGEST_URL;
const INGEST_SECRET = process.env.THESIS_INGEST_SECRET;

/**
 * POST a thesis payload to the Hindsight ingest endpoint. Exported so smoke.mjs
 * can exercise it against a local dev server without stdio. Returns a normalized
 * { ok, ...} — never throws for an HTTP-level rejection (validation errors come
 * back as { ok:false, error }); only throws if the endpoint is unreachable.
 */
export async function postThesis(payload, { url = INGEST_URL, secret = INGEST_SECRET } = {}) {
  if (!url) return { ok: false, error: "HINDSIGHT_INGEST_URL is not set." };
  if (!secret) return { ok: false, error: "THESIS_INGEST_SECRET is not set." };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ingest-secret": secret,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach the ingest endpoint at ${url}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Ingest endpoint returned a non-JSON ${res.status} response.` };
  }

  if (!res.ok || body?.success !== true) {
    return {
      ok: false,
      status: res.status,
      error: body?.error ?? `Ingest rejected the thesis (HTTP ${res.status}).`,
      runId: body?.runId,
    };
  }
  return { ok: true, runId: body.runId, summary: body.summary, thesis: body.thesis };
}

// ── save_thesis input schema (mirrors §A of docs/prompts/INGEST_THESIS.md) ────
// Lean by design — the endpoint's Zod schema is the source of truth and does
// the full validation. The descriptions carry the format-prompt so the calling
// assistant fills the fields correctly. Do NOT add a `triggers` field — the
// endpoint generates and enforces triggers server-side.
const sectionScore = (max) =>
  z.object({
    score: z.number().int().min(0).max(max),
    note: z.string().describe("One sentence citing concrete evidence for the score."),
  });

const saveThesisInput = {
  analyst: z
    .string()
    .describe(
      "Exact analyst name to file this under (case-insensitive). One of: Secular Compounder, Catalyst Event PM, PEAD Specialist, Momentum Breakout.",
    ),
  ticker: z.string().describe("Ticker symbol, e.g. AVGO."),
  direction: z
    .enum(["LONG", "SHORT", "PASS"])
    .describe(
      "LONG/SHORT need the full trade plan below. PASS = researched, decided not to trade (documents the decline); only ticker + reasoning_summary needed.",
    ),
  horizon: z
    .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
    .optional()
    .describe(
      "Required for LONG/SHORT. CATALYST (dated binary event — also send catalyst_date) · TARGET (open-ended swing to a price target) · TRADE (bounded momentum setup — also send max_hold_days) · COMPOUNDER (multi-year hold).",
    ),
  entry_price: z.number().optional().describe("Where you'd initiate. LONG: target>entry>stop. Required for LONG/SHORT."),
  target_price: z.number().optional().describe("Price target. Required for LONG/SHORT. R/R vs entry & stop must be ≥2:1."),
  stop_loss: z.number().optional().describe("Stop level. Required for LONG/SHORT."),
  core_belief: z
    .string()
    .optional()
    .describe("Required for LONG/SHORT. ≤30 words, falsifiable: outcome + timeframe + mechanism."),
  key_assumptions: z
    .array(z.string())
    .optional()
    .describe("Required for LONG/SHORT — ≥2 specific, checkable premises that must stay true."),
  invalidation_conditions: z
    .array(z.string())
    .optional()
    .describe("Required for LONG/SHORT — ≥2 concrete things that would prove the thesis wrong."),
  conviction: z
    .enum(["STRONG", "HIGH", "MEDIUM", "LOW"])
    .optional()
    .describe("Required for LONG/SHORT. Your real view. STRONG/HIGH additionally require variant_view."),
  conviction_rationale: z
    .string()
    .max(400)
    .optional()
    .describe("Required whenever conviction is set. ≤400 chars, plain judgment — not a paraphrase of the scores."),
  variant_view: z
    .string()
    .max(300)
    .optional()
    .describe("Required for STRONG/HIGH. 'Consensus thinks X; I think Y; falsifiable reason.'"),
  target_size_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Required for LONG/SHORT. % of portfolio at full size. Use the analyst's conviction→size tiers."),
  catalyst_date: z
    .string()
    .optional()
    .describe("Required when horizon=CATALYST. ISO 8601, e.g. 2026-08-14T20:30:00Z."),
  max_hold_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Required when horizon=TRADE. Time-exit window in days (typically 5-14)."),
  reasoning_summary: z.string().optional().describe("2-3 sentence current-state framing (plain string)."),
  thesis_bullets: z.array(z.string()).optional().describe("Bull points (plain strings)."),
  risk_flags: z.array(z.string()).optional().describe("Key risks (plain strings)."),
  scoring: z
    .object({
      trendStrength: sectionScore(3),
      relativeStrength: sectionScore(3),
      entryQuality: sectionScore(2),
      catalystFreshness: sectionScore(2),
    })
    .optional()
    .describe("Optional /10 setup grade (caps 3/3/2/2). Composite ≥7 = high-conviction add."),
};

const server = new McpServer({ name: "hindsight-thesis-ingest", version: "0.1.0" });

server.registerTool(
  "save_thesis",
  {
    title: "Save thesis to Hindsight",
    description:
      "Mint a WATCHING thesis in the Hindsight paper-trading platform from a finished research decision. " +
      "The platform validates the input (taxonomy, price shape, conviction gates), generates the triggers, " +
      "and persists it — at zero model cost. Use after you've researched a name for one of the analysts. " +
      "Do NOT pass triggers (the platform generates them). On rejection, the error explains exactly what to fix; " +
      "correct the fields and call again.",
    inputSchema: saveThesisInput,
  },
  async (args) => {
    const result = await postThesis(args);
    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Thesis rejected: ${result.error}` }],
      };
    }
    const id = result.thesis?.thesis_id ?? "(unknown)";
    return {
      content: [
        {
          type: "text",
          text: `${result.summary}\nthesis_id: ${id} · runId: ${result.runId}`,
        },
      ],
    };
  },
);

// Only stand up stdio when run as the entrypoint (smoke.mjs imports postThesis).
const isEntry =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntry) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the JSON-RPC channel.
  console.error("[hindsight-thesis-ingest] MCP server ready on stdio.");
}
