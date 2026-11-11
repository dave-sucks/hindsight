/**
 * write_market_brief — the Market Reviewer's last step. Saves the market
 * brief every agent reads (MarketDigest.brief) and the digest for the Market
 * tab (MarketDigest.narrative), with the inputs the run was given (they are
 * on the run row, `parameters.facts`, from lib/agent/market-reviewer/run.ts),
 * and the run stops on it. Any run but the Market Reviewer's is refused
 * before anything is written. Check only (`ctx.dryRun`, the no-save run):
 * nothing is read or saved, and the brief and digest come back on `data`.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

export const BRIEF_CHARS = 700;

const source = z.object({ title: z.string().min(1), url: z.string().min(8) });
const section = z.object({
  text: z.string().min(20).describe("A short paragraph."),
  sources: z.array(source).max(6).describe("The pages from this run's searches it rests on: title and URL."),
});

/** The Market tab's sections, in order, with their headings. */
export const DIGEST_SECTIONS = [
  ["market_overview", "Market overview"],
  ["sector_developments", "Sector developments"],
  ["major_developments", "Major developments"],
  ["portfolio_implications", "Implications for your portfolio"],
  ["deserves_attention", "What deserves attention"],
  ["upcoming_events", "Upcoming events"],
] as const;
type SectionKey = (typeof DIGEST_SECTIONS)[number][0];
type Section = z.infer<typeof section>;

/** The digest as the Market tab shows it: each section under its heading, its sources linked. */
export function digestMarkdown(sections: Record<SectionKey, Section>): string {
  return DIGEST_SECTIONS.map(([key, heading]) => {
    const s = sections[key];
    const links = s.sources.map((x) => `[${x.title.replace(/[[\]]/g, "")}](${x.url.trim()})`).join(" · ");
    return [`### ${heading}`, s.text.trim(), links ? `Sources: ${links}` : ""].filter(Boolean).join("\n\n");
  }).join("\n\n");
}

export const writeMarketBrief = defineTool({
  description:
    "Save today's market brief and the Market tab's digest, and end the run. Call it once, last, after your notes. The brief is what every agent reads at the top of its runs today; the digest is what the owner reads on the homepage.",
  schema: z.object({
    brief: z
      .string()
      .min(100)
      .max(BRIEF_CHARS)
      .describe(
        `The market brief, for the agents: 3 to 5 sentences, ${BRIEF_CHARS} characters at most. Why the market moved, what changed, and what that means for this book, in the present tense. The agents read it beside the market numbers code prints, so it never restates the move of an index, the VIX, a yield or a sector, nor a market date. Every claim names its outlet and date, like "(Reuters, Nov 10)". No forecasts ("may", "could", "likely"). It never tells a stock what to do.`,
      ),
    sections: z.object(Object.fromEntries(DIGEST_SECTIONS.map(([k]) => [k, section])) as Record<SectionKey, typeof section>).describe(
      "The digest, one short paragraph per section: market overview, sector developments, major developments, implications for your portfolio, what deserves attention, upcoming events. The Market tab prints the market numbers above it, so the market overview says why the market moved and what changed, never the moves themselves.",
    ),
  }),
  ui: "tool-ui" as const,
  progressLabel: () => "Writing the market brief and digest",

  execute: async (args, ctx) => {
    if (ctx.dryRun) {
      const narrative = digestMarkdown(args.sections as Record<SectionKey, Section>);
      return {
        summary: "Saved the market brief and digest.",
        data: { dry_run: true, brief: args.brief.trim(), narrative, items: [{ kind: "generic" as const, text: `Brief: ${args.brief.trim()}` }] },
        sources: [],
      };
    }
    const run = await prisma.researchRun.findUnique({
      where: { id: ctx.runId },
      select: { id: true, mode: true, accountId: true, environment: true, parameters: true },
    });
    if (!run || run.mode !== "MARKET_REVIEWER") {
      return { summary: "Only the Market Reviewer writes the market brief; nothing saved.", data: { items: [{ kind: "generic" as const, text: "Nothing saved: this run doesn't write the market brief." }] }, sources: [] };
    }
    const p = (run.parameters ?? {}) as { date?: string; facts?: unknown; model?: string };
    const day = typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null;
    if (!day) throw new Error(`Market Reviewer run ${run.id} has no date on its row`);
    const date = new Date(`${day}T00:00:00.000Z`);
    const brief = args.brief.trim();
    const narrative = digestMarkdown(args.sections as Record<SectionKey, Section>);
    const facts = (p.facts ?? {}) as object;
    const model = p.model ?? null;
    const row = await prisma.marketDigest.upsert({
      where: { accountId_environment_date: { accountId: run.accountId, environment: run.environment, date } },
      create: { accountId: run.accountId, environment: run.environment, date, brief, narrative, facts, model, runId: run.id },
      update: { brief, narrative, facts, model, runId: run.id },
      select: { id: true },
    });
    const sourceCount = DIGEST_SECTIONS.reduce((n, [k]) => n + (args.sections as Record<SectionKey, Section>)[k].sources.length, 0);
    return {
      summary: `Saved the market brief and digest for ${day}.`,
      data: {
        digestId: row.id,
        items: [
          { kind: "generic" as const, text: `Brief: ${brief}` },
          { kind: "generic" as const, text: `Digest: ${DIGEST_SECTIONS.length} sections, ${sourceCount} sources linked.` },
        ],
      },
      sources: [],
    };
  },
});
