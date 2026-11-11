/**
 * market-reviewer-dry-run.ts — one real Market Reviewer run that saves nothing.
 *
 *   npx tsx --env-file=.env.local scripts/market-reviewer-dry-run.ts --out <file.md> [--date YYYY-MM-DD] [--inputs-only]
 *
 * It reads the real inputs from production, runs the real model with the
 * real prompt and tools (the cron's own call, `callReviewer` in
 * lib/agent/market-reviewer/run.ts), and writes to --out: the inputs
 * message, every tool call (each search's query and what came back), the
 * brief, the digest, and each note with its level for each stock.
 *
 * Nothing is saved. The two saving tools run check only (`dryRun`), so no
 * note and no MarketDigest row is written; no ResearchRun is opened; no
 * urgent run is started (the file lists the stocks one would start on).
 * Every database write anything else tries (a cache row, say) is blocked
 * and listed, and the account's row counts are read before and after.
 *
 * It costs one model run (about $0.50) and up to ten web searches. Its
 * output is the account's book: never commit it (the repo is public).
 * --date defaults to today in New York. --inputs-only reads the inputs and
 * checks the write block, with no model call and no search.
 *
 * After the run it prints what the others would read: the Market and
 * portfolio block a morning run gets, with this run's brief in it, and the
 * chips (#948's promptBlocks) of a trigger run's prompt on a stock its notes
 * name, as if the urgent-note rule had fired there. Reads of the notes see
 * this run's notes, held in memory. --portfolio-brief-file <path> puts a
 * Portfolio Reviewer brief in the block (production holds none yet).
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ── Every write blocked, before anything else loads the database client ─────
const WRITES = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const blocked: string[] = [];
// SharedNote.levels, the MarketDigest table and PortfolioDigest.brief reach
// production when these PRs deploy. Until then a notes read fails on the
// missing column; while production holds no notes at all (checked at the
// start), it is answered with this run's own notes, held in memory. A
// PortfolioDigest read is asked again without its brief.
const answeredNone: string[] = [];
let noNotesInProduction = false;
const memoryNotes: Array<Record<string, unknown>> = [];
const fromMemory = (operation: string) =>
  operation === "count" ? memoryNotes.length : operation === "findMany" ? [...memoryNotes] : operation === "findFirst" || operation === "findUnique" ? (memoryNotes[0] ?? null) : undefined;
const withoutBrief = (a: Record<string, unknown>) => {
  const { brief: _w, ...where } = (a.where ?? {}) as Record<string, unknown>;
  const { brief: _s, ...select } = (a.select ?? {}) as Record<string, unknown>;
  return { ...a, where, ...(a.select ? { select } : {}) };
};
const readOnly = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) }).$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      if (WRITES.has(operation) || operation.startsWith("$executeRaw")) {
        blocked.push(`${model ?? "raw"}.${operation}`);
        throw new Error(`no-save run: ${model ?? "raw"}.${operation} blocked`);
      }
      try {
        return await query(args);
      } catch (err) {
        const missingColumn = (err as { code?: string }).code === "P2022";
        if (noNotesInProduction && model === "SharedNote" && missingColumn && fromMemory(operation) !== undefined) {
          answeredNone.push(`SharedNote.${operation}`);
          return fromMemory(operation);
        }
        if (model === "PortfolioDigest" && missingColumn && (operation === "findFirst" || operation === "findMany")) {
          answeredNone.push(`PortfolioDigest.${operation} (no brief column yet)`);
          const rows = await query(withoutBrief(args as Record<string, unknown>));
          return Array.isArray(rows) ? rows.map((r) => ({ ...r, brief: null })) : rows && { ...(rows as object), brief: null };
        }
        throw err;
      }
    },
  },
});
// lib/prisma.ts takes the client already on globalThis.
(globalThis as unknown as { prisma: unknown }).prisma = readOnly;

/** The run's notes, held in memory as they are written, so a later read sees them as it would after a save. */
function holdNotes<T extends Record<string, unknown>>(tools: T, now: Date): T {
  const note = tools.write_market_note as { execute: (...a: unknown[]) => Promise<{ data?: { note?: Record<string, unknown> } }> } | undefined;
  if (!note) return tools;
  const execute = note.execute.bind(note);
  return {
    ...tools,
    write_market_note: {
      ...note,
      execute: async (...a: unknown[]) => {
        const out = await execute(...a);
        const n = out?.data?.note;
        if (n) memoryNotes.push({ ...n, id: `not-saved-${memoryNotes.length + 1}`, pinnedUntil: null, createdAt: new Date(now.getTime() + memoryNotes.length * 1000) });
        return out;
      },
    },
  };
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const out = arg("--out");
  if (!out) throw new Error("--out <file.md> is required");
  // Its output is the account's book: never inside the repo, which is public.
  const { resolve, relative, isAbsolute } = await import("path");
  const repo = resolve(__dirname, "..");
  const inside = relative(repo, resolve(out));
  if (!inside.startsWith("..") && !isAbsolute(inside)) throw new Error(`--out ${out} is inside the repo; write it outside (the output is the account's book)`);
  // The vendors' keys are the trigger check's during the session.
  const { isMarketOpen } = await import("@/lib/market-hours");
  if (isMarketOpen(new Date())) throw new Error("The market is open: run this outside the session, when the trigger check isn't using the vendors' keys.");
  const { prisma } = await import("@/lib/prisma");
  if ((prisma as unknown) !== readOnly) throw new Error("the read-only client did not take: stopping before anything runs");
  // The block, proved before anything runs: a delete that matches no row is refused.
  const probe = await prisma.sharedNote.deleteMany({ where: { id: "__no_such_note__" } }).then(() => "ran", () => "blocked");
  if (probe !== "blocked") throw new Error("a write got through the block: stopping");
  blocked.length = 0;
  const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "SharedNote"`);
  noNotesInProduction = n === 0;
  const { openai } = await import("@ai-sdk/openai");
  const { MODES } = await import("@/lib/agent/modes");
  const { etToday } = await import("@/lib/market-data/market-calendar");
  const { tradedBooks } = await import("@/lib/inngest/functions/market-reviewer");
  const { bookOwner, callReviewer, loadInputsForBook, reviewerTools } = await import("@/lib/agent/market-reviewer/run");
  const { renderInputs } = await import("@/lib/agent/market-reviewer/inputs");
  const { buildMarketReviewerPrompt } = await import("@/lib/agent/market-reviewer/prompt");
  const { addTokenUsage, emptyTokenUsage } = await import("@/lib/agent/token-usage");
  const { loadMarketAndPortfolio } = await import("@/lib/agent/load-market-and-portfolio");
  const { marketAndPortfolioBlock } = await import("@/lib/agent/market-and-portfolio");
  const { promptBlocks } = await import("@/lib/agent/prompt-blocks");
  const { buildTacticalSystemPrompt, stockFromRead } = await import("@/lib/agent/system-prompts/intraday-tactical");
  const { createResearchTools } = await import("@/lib/agent/tools");
  const { loadSetupOverrides } = await import("@/lib/agent/knowledge/load-setup-overrides");
  const { urgentNoteStandingTriggers } = await import("@/lib/agent/triggers/seed-account");
  const { readFileSync } = await import("fs");
  const portfolioBriefFile = arg("--portfolio-brief-file");
  const portfolioBrief = portfolioBriefFile ? readFileSync(portfolioBriefFile, "utf8").trim() : null;

  const now = new Date();
  const date = arg("--date") ?? etToday(now);
  const MODE = MODES["market-reviewer"];

  const [analysts, open] = await Promise.all([
    prisma.agentConfig.findMany({ where: { enabled: true }, select: { accountId: true, tradingEnvironment: true }, distinct: ["accountId", "tradingEnvironment"] }),
    prisma.position.findMany({ where: { status: "OPEN" }, select: { accountId: true, environment: true }, distinct: ["accountId", "environment"] }),
  ]);
  const books = tradedBooks([...analysts.map((a) => ({ accountId: a.accountId, environment: a.tradingEnvironment })), ...open]);
  const lines: string[] = [`# Market Reviewer, no-save run for ${date}`, "", `Run at ${now.toISOString()} on ${MODE.model}. Nothing was saved.`, ""];

  for (const book of books) {
    const { userId, creds } = await bookOwner(book.accountId, book.environment);
    if (!userId) {
      lines.push(`## ${book.environment} book ${book.accountId}: no owner, skipped`, "");
      continue;
    }
    const counts = async () => ({
      researchRuns: await prisma.researchRun.count({ where: { accountId: book.accountId } }),
      sharedNotes: await prisma.sharedNote.count({ where: { userId } }),
      marketDigests: await prisma.marketDigest.count({ where: { accountId: book.accountId } }).catch(() => "no table yet"),
      thesisUpdates: await prisma.thesisUpdate.count({ where: { thesis: { userId } } }),
    });
    const before = await counts();
    console.log(`[dry-run] ${book.environment} ${book.accountId}: reading inputs for ${date}`);
    const facts = await loadInputsForBook({ ...book, date, now });
    if (!facts) continue;
    const opening = renderInputs(facts);
    if (process.argv.includes("--inputs-only")) {
      lines.push(`## ${book.environment} book: inputs only`, "", `Writes blocked: ${blocked.length ? blocked.join(", ") : "none tried"}. Notes reads answered with none: ${answeredNone.length}.`, "", "```", opening, "```", "");
      continue;
    }
    const runId = `no-save-${now.getTime()}`;
    const usage = emptyTokenUsage();
    const t0 = Date.now();
    console.log(`[dry-run] calling ${MODE.model} (${opening.length} characters of inputs)`);
    const { steps } = await callReviewer({
      model: openai(MODE.model),
      tools: holdNotes(reviewerTools({ runId, userId, accountId: book.accountId, environment: book.environment, creds, dryRun: true }), now),
      opening,
      cacheKey: runId,
      onUsage: (u) => addTokenUsage(usage, u),
    });
    const after = await counts();

    type Out = { ok?: boolean; summary?: string; error?: string; data?: Record<string, unknown> };
    const calls = steps.flatMap((s, i) =>
      s.toolCalls.map((c) => ({ step: i + 1, name: c.toolName, input: c.input as Record<string, unknown>, output: s.toolResults.find((r) => r.toolCallId === c.toolCallId)?.output as Out | undefined })),
    );
    const notes = calls.filter((c) => c.name === "write_market_note");
    const brief = calls.filter((c) => c.name === "write_market_brief" && c.output?.ok).pop();
    const searches = calls.filter((c) => c.name === "web_search").length;

    lines.push(
      `## ${book.environment} book`,
      "",
      `- ${steps.length} steps, ${calls.length} tool calls (${searches} searches), ${Math.round((Date.now() - t0) / 1000)}s.`,
      `- Tokens: ${usage.input.toLocaleString()} in (${usage.cachedInput.toLocaleString()} of them cached), ${usage.output.toLocaleString()} out, over ${usage.requests} requests.`,
      `- Writes blocked: ${blocked.length ? blocked.join(", ") : "none tried"}.`,
      `- Notes reads answered with none (production has no notes, and no levels column until this PR deploys): ${answeredNone.length ? answeredNone.join(", ") : "none"}.`,
      `- Row counts before → after: ${Object.entries(before).map(([k, v]) => `${k} ${v} → ${(after as Record<string, unknown>)[k]}`).join(", ")}.`,
      "",
      "### The brief",
      "",
      brief ? String(brief.output?.data?.brief) : "(no brief was written)",
      "",
      `### Notes (${notes.length})`,
      "",
    );
    for (const n of notes) {
      const note = n.output?.data?.note as { levels?: Record<string, string>; audience?: string; body?: string } | undefined;
      lines.push(`#### Step ${n.step}: ${String(n.input.title)}`, "");
      if (note) {
        lines.push(`To ${note.audience}${note.levels && Object.keys(note.levels).length ? `, levels: ${Object.entries(note.levels).map(([t, l]) => `${t} ${l}`).join(", ")}` : ""}.`);
        const urgent = Object.entries(note.levels ?? {}).filter(([, l]) => l === "URGENT").map(([t]) => t);
        if (urgent.length) lines.push(`Would start a run on: ${urgent.join(", ")} (not started).`);
        lines.push("", "```", String(note.body), "```");
      }
      lines.push("", `The tool said: ${n.output?.summary ?? n.output?.error ?? "(no answer)"}`, "", "What the model sent:", "", "```json", JSON.stringify(n.input, null, 2), "```", "");
    }
    // ── What the others read: the morning run's block, and a trigger run's chips ──
    const held = await prisma.position.findMany({ where: { accountId: book.accountId, environment: book.environment, status: "OPEN" }, select: { symbol: true, analystId: true, peakPrice: true, quantity: true, avgCost: true } });
    // The stock: one this run's notes send for a look (urgent or review), else one a note puts on its waiting sale, else the biggest holding.
    const levelled = memoryNotes.flatMap((n) => Object.entries((n.levels ?? {}) as Record<string, string>));
    const noted = levelled.find(([, l]) => l === "URGENT" || l === "REVIEW")?.[0] ?? levelled.find(([, l]) => l === "PROPOSAL")?.[0];
    const ticker = noted ?? [...held].sort((a, b) => Number(b.quantity) * Number(b.avgCost) - Number(a.quantity) * Number(a.avgCost))[0]?.symbol;
    const theses = ticker
      ? await prisma.thesis.findMany({
          where: { userId, ticker, status: { in: ["HOLDING", "WATCHING"] }, researchRun: { agentConfig: { accountId: book.accountId, tradingEnvironment: book.environment } } },
          orderBy: [{ researchUpdatedAt: "desc" }, { id: "asc" }],
          select: { id: true, ticker: true, direction: true, status: true, researchRun: { select: { agentConfigId: true } } },
        })
      : [];
    const thesis = theses.find((t) => t.status === "HOLDING") ?? theses[0];
    const position = held.find((p) => p.symbol === thesis?.ticker);
    const analystId = position?.analystId ?? thesis?.researchRun.agentConfigId;
    if (thesis && analystId) {
      const block = await loadMarketAndPortfolio({ accountId: book.accountId, environment: book.environment, userId, analystId, creds }, now);
      // This run's brief, as the slot reads it once saved: production has no MarketDigest table yet, so the read above came back unread.
      const injected = new Set<string>([...(brief ? ["marketBrief"] : []), ...(!block.portfolioBrief && portfolioBrief ? ["portfolioBrief"] : [])]);
      const withBriefs = {
        ...block,
        marketBrief: brief ? { date, brief: String(brief.output?.data?.brief), writtenAt: now.toISOString() } : block.marketBrief,
        portfolioBrief: block.portfolioBrief ?? (portfolioBrief ? { date: "2026-11-10", brief: portfolioBrief, writtenAt: "2026-11-11T01:00:00.000Z" } : null),
        unread: block.unread.filter((id) => !injected.has(id)),
      };
      const rendered = marketAndPortfolioBlock(withBriefs, now);
      const analyst = await prisma.agentConfig.findUnique({ where: { id: analystId } });
      lines.push(
        `### The Market and portfolio block a morning run gets (${analyst?.name ?? analystId})`,
        "",
        `This run's brief is in it, as the slot would read it once saved.${portfolioBrief && !block.portfolioBrief ? " The portfolio brief is the one from #947's no-save run of Nov 10 (production holds none yet)." : ""}`,
        "",
        "```",
        rendered,
        "```",
        "",
      );

      // A trigger run on that stock, as if the urgent-note rule had fired there: the prompt tactical-run.ts builds, split as the chips split it.
      if (analyst) {
        const tools = createResearchTools({ runId, userId, accountId: book.accountId, analystId: analyst.id, runMode: "INTRADAY_TACTICAL", runEnvironment: book.environment, alpacaCreds: creds });
        const read = (await tools.get_theses.execute!({ tickers: [thesis.ticker] } as never, { toolCallId: "read-the-stock", messages: [] })) as { ok?: boolean; data?: unknown };
        const stock = stockFromRead(read, thesis.id);
        const trigger = { ...urgentNoteStandingTriggers()[0], id: "urgent-note" };
        const prompt = buildTacticalSystemPrompt({
          analyst: { ...analyst, setupOverrides: await loadSetupOverrides(book.accountId) } as never,
          stock: { ticker: thesis.ticker, direction: thesis.direction, row: stock?.row ?? null },
          trigger: trigger as never,
          position: position ? { peakPrice: position.peakPrice != null ? Number(position.peakPrice) : null } : null,
          fired: { price: null },
          situations: stock?.situations ?? null,
          marketAndPortfolio: rendered,
        });
        const blocks = promptBlocks(prompt);
        lines.push(
          `### A trigger run's prompt on $${thesis.ticker}, split as the chips split it`,
          "",
          `As if the urgent-note rule had fired on $${thesis.ticker} (${analyst.name}); ${prompt.length.toLocaleString()} characters in all.`,
          "",
          "| Chip | Characters |",
          "|---|---|",
          ...blocks.map((b) => `| ${b.label} | ${b.chars.toLocaleString()} |`),
          "",
        );
        for (const b of blocks.filter((x) => x.label.startsWith("Notes on") || x.label === "Market brief")) {
          lines.push(`**${b.label}**`, "", "```", b.text, "```", "");
        }
      }
    }

    lines.push("### The digest", "", brief ? String(brief.output?.data?.narrative) : "(none)", "", "### Every tool call, in order", "");
    for (const c of calls) {
      lines.push(`**Step ${c.step} · ${c.name}** ${JSON.stringify(c.input).slice(0, 400)}`, "", `→ ${c.output?.summary ?? c.output?.error ?? "(no answer)"}`);
      if (c.name === "web_search") {
        for (const r of (c.output?.data?.results as Array<{ headline: string; summary: string; sources: Array<{ name?: string; url?: string }> }> | undefined) ?? []) {
          lines.push(`  - ${r.headline}: ${r.summary.slice(0, 280)}${r.sources?.[0]?.url ? ` (${r.sources[0].url})` : ""}`);
        }
      }
      lines.push("");
    }
    const said = steps.map((s, i) => [i + 1, s.text.trim()] as const).filter(([, t]) => t);
    if (said.length) lines.push("### What the model wrote between calls", "", ...said.map(([i, t]) => `Step ${i}: ${t}`), "");
    lines.push("### The inputs message", "", "```", opening, "```", "", "### The instructions", "", "```", buildMarketReviewerPrompt(), "```", "");
  }

  writeFileSync(out, lines.join("\n"));
  console.log(`[dry-run] wrote ${out}; writes blocked: ${blocked.length}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
