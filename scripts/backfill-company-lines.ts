/**
 * backfill-company-lines.ts
 *
 * ONE-OFF. The Writer has opened every research note with a "## Company"
 * section since 2026-11-03 — two plain sentences on what the company does
 * and how it makes money, saved to Thesis.company and shown first on the
 * Overview. A thesis written before then has none, and nothing rewrites a
 * thesis that already exists. This asks a small model for that one section,
 * with the Writer's own instruction, for every live thesis whose column is
 * empty, and saves it the way the Writer does (markers stripped, no audit
 * row: it is a description, not a change of opinion). About 29 short calls
 * on GPT-4o-mini, a few cents in all. A name the small model only guesses
 * at (a recent rename, a spin-off) gets `--grounded`: Perplexity Sonar
 * writes the same section from a web search.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-company-lines.ts --dry-run   # print, save nothing
 *   npx tsx --env-file=.env.local scripts/backfill-company-lines.ts             # write the column
 *   npx tsx --env-file=.env.local scripts/backfill-company-lines.ts --ticker=MU # one stock
 *   ... --ticker=GEV --grounded --force                                         # redo one from a web search
 */

import { generateText } from "ai";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import { getStockInfo } from "@/lib/actions/stock-info";
import { withoutCitationMarkers } from "@/lib/agent/thesis-research/parse-sections";

const LIVE = ["HOLDING", "WATCHING", "PROMOTED"] as const;

// Perplexity speaks the OpenAI chat shape; its answer comes from a live search.
const perplexity = createOpenAI({ apiKey: process.env.PERPLEXITY_API_KEY ?? "", baseURL: "https://api.perplexity.ai" });

// The Writer's instruction for the section, word for word (run-thesis-writer.ts, STEP 1).
const INSTRUCTION = `Two plain sentences: what the company does and how it makes money.
Written once and kept until the business changes. No numbers unless
they define the business ("revenue is subscription, growing about
30% a year").`;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const grounded = args.includes("--grounded");
  const force = args.includes("--force");
  const only = args.find((a) => a.startsWith("--ticker="))?.slice("--ticker=".length).toUpperCase() ?? null;

  const rows = await prisma.thesis.findMany({
    where: { status: { in: [...LIVE] }, ...(only ? { ticker: only } : {}) },
    select: { id: true, ticker: true, company: true },
    orderBy: { ticker: "asc" },
  });
  const todo = rows.filter((r) => force || !r.company?.trim());
  console.log(`${rows.length} live theses, ${todo.length} without a company line${dryRun ? " (dry run)" : ""}`);

  for (const t of todo) {
    const identity = await getStockInfo(t.ticker);
    const { text } = await generateText({
      model: grounded ? perplexity.chat("sonar") : openai("gpt-4o-mini"),
      temperature: 0.2,
      system:
        "You write the opening section of a stock research note for a plain-spoken investor. Answer with the two sentences only: no heading, no bullets, no preamble.",
      prompt: `The company: ${identity.companyName} (${t.ticker}${identity.exchange ? `, ${identity.exchange}` : ""}).\n\n${INSTRUCTION}`,
    });
    // Sonar footnotes its sentences ("[1][2]"); the column is plain prose.
    const company = withoutCitationMarkers(text).replace(/\[\d+\]/g, "").replace(/\s+\./g, ".").replace(/\s+/g, " ").trim();
    console.log(`\n${t.ticker} — ${identity.companyName}\n${company}`);
    if (!company || dryRun) continue;
    await prisma.thesis.update({ where: { id: t.id }, data: { company } });
  }
  console.log(`\n${dryRun ? "would write" : "wrote"} ${todo.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
