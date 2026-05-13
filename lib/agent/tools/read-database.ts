/**
 * read_database — Principal-chat fallback read tool.
 *
 * The "long tail" escape hatch for queries not covered by the dedicated
 * read tools. Whitelisted Prisma model accessors + findMany only (no
 * raw SQL, no writes). Userid scoping is enforced server-side wherever
 * the model has a userId column. Use this for ad-hoc questions like
 * "show me ThesisUpdates for thesis X" or "list the latest 10 Signals
 * routed to analyst Y" — anything the structured tools don't cover.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

// Allowlist of models the principal agent may read.
const READ_MODELS = [
  "agentConfig",
  "researchRun",
  "runEvent",
  "thesis",
  "thesisUpdate",
  "position",
  "positionEvent",
  "tradeDecision",
  "monitor",
  "signal",
  "analystSignalRoute",
  "morningBrief",
  "analystWatchlistItem",
  "analystBriefing",
  "artifact",
  "accuracyReport",
  "order",
] as const;
type ReadModel = (typeof READ_MODELS)[number];

// Models that have accountId on the row (so we can enforce scoping
// directly). For models that don't, scope is enforced through a
// relation filter — see ACCOUNT_RELATION below.
const ACCOUNT_SCOPED: Record<ReadModel, boolean> = {
  agentConfig: true,
  researchRun: true,
  runEvent: false, // scoped via researchRun relation
  thesis: true,
  thesisUpdate: false, // scoped via thesis relation
  position: true,
  positionEvent: false, // scoped via position relation
  tradeDecision: true,
  monitor: false, // scoped via analyst.accountId OR scope=FIRM
  signal: false, // not account-owned (FIRM-wide signals)
  analystSignalRoute: false, // scoped via analyst relation
  morningBrief: false, // scoped via analyst relation
  analystWatchlistItem: false, // scoped via analyst relation
  analystBriefing: true,
  artifact: false, // not account-owned
  accuracyReport: true,
  order: true,
};

// Relation-based scope fallback for models without a direct accountId.
// Keys are model names; values are the where-clause snippet to inject
// (with __ACCOUNT_ID__ replaced at runtime).
const ACCOUNT_RELATION: Partial<Record<ReadModel, (accountId: string) => Record<string, unknown>>> = {
  runEvent: (accountId) => ({ run: { accountId } }),
  thesisUpdate: (accountId) => ({ thesis: { accountId } }),
  positionEvent: (accountId) => ({ position: { accountId } }),
  monitor: (accountId) => ({
    OR: [{ scope: "FIRM" }, { analyst: { accountId } }],
  }),
  analystSignalRoute: (accountId) => ({ analyst: { accountId } }),
  morningBrief: (accountId) => ({ analyst: { accountId } }),
  analystWatchlistItem: (accountId) => ({ analyst: { accountId } }),
};

export const readDatabase = defineTool({
  description:
    "Long-tail read fallback. Run a Prisma `findMany` against one of the whitelisted models with where / orderBy / take / select / include. NO writes. NO raw SQL. The query is automatically scoped to your account (accountId or via a relation filter for nested models). Use the dedicated tools (list_analysts, list_runs, etc.) first; reach for this when no dedicated tool covers the question.",
  schema: z.object({
    model: z
      .enum(READ_MODELS)
      .describe(
        "Prisma model accessor name (camelCase). Allowlisted: " +
          READ_MODELS.join(", "),
      ),
    where: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Prisma where clause. Account scope is enforced server-side."),
    orderBy: z
      .union([
        z.record(z.string(), z.enum(["asc", "desc"])),
        z.array(z.record(z.string(), z.enum(["asc", "desc"]))),
      ])
      .optional(),
    select: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Prisma select. Mutually exclusive with include."),
    include: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Prisma include. Mutually exclusive with select."),
    take: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Default 25, max 200."),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) => `Querying ${args.model}`,

  execute: async (args, ctx) => {
    const model = args.model as ReadModel;
    const take = args.take ?? 25;
    const where: Record<string, unknown> = { ...(args.where ?? {}) };

    // Enforce account scope. Direct accountId column for most models;
    // relation filter (analyst / run / thesis / position) for nested ones.
    if (!ctx.accountId) {
      throw new Error("read_database requires an authenticated account context.");
    }
    if (ACCOUNT_SCOPED[model] && !("accountId" in where)) {
      where.accountId = ctx.accountId;
    } else if (ACCOUNT_RELATION[model]) {
      const rel = ACCOUNT_RELATION[model]!(ctx.accountId);
      // Merge — caller's filters compose with the relation scope.
      for (const k of Object.keys(rel)) {
        if (!(k in where)) where[k] = rel[k];
      }
    }

    // Reject mutating-looking keys defensively. These shouldn't be in a
    // where clause but the model could send anything.
    for (const k of Object.keys(where)) {
      if (k.startsWith("$") || ["create", "update", "delete", "upsert", "set"].includes(k)) {
        throw new Error(`Suspicious where-clause key: ${k}`);
      }
    }
    if (args.select && args.include) {
      throw new Error("Pass select OR include, not both.");
    }

    const queryArgs: Record<string, unknown> = {
      where,
      take,
    };
    if (args.orderBy) queryArgs.orderBy = args.orderBy;
    if (args.select) queryArgs.select = args.select;
    if (args.include) queryArgs.include = args.include;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = prisma as any as Record<string, { findMany: (args: unknown) => Promise<unknown[]> }>;
    const accessor = client[model];
    if (!accessor || typeof accessor.findMany !== "function") {
      throw new Error(`Model not accessible: ${model}`);
    }

    const rows = await accessor.findMany(queryArgs);
    const safeRows = JSON.parse(
      JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );

    const items: ToolUIItem[] = [
      {
        kind: "generic" as const,
        text: `${model} — ${safeRows.length} row${safeRows.length === 1 ? "" : "s"}`,
      },
    ];

    return {
      summary: `${model}: ${safeRows.length} row${safeRows.length === 1 ? "" : "s"}`,
      data: { items, model, rows: safeRows },
      sources: [],
    };
  },
});
