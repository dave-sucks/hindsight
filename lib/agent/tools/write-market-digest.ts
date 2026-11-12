/**
 * write_market_digest — the Market Reviewer's last step: saves the market
 * digest (MarketDigest, one per book per day) and the run stops on it. Any
 * run but the Market Reviewer's is refused before anything is written. A
 * source must be a page a web_search returned in this run: any other link is
 * dropped, and the summary says which. Past DIGEST_MAX_CHARS of paragraphs it
 * is refused. Check only (`ctx.dryRun`): nothing is saved, and the digest
 * comes back on `data`.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { pageKey, pagesFound } from "./web-search";

/** The six paragraphs together, sources not counted: about DIGEST_CHARS, refused past DIGEST_MAX_CHARS. */
export const DIGEST_CHARS = 3_000;
export const DIGEST_MAX_CHARS = 5_000;

const section = z.object({
  text: z
    .string()
    .min(20)
    .describe('A short paragraph: the facts, each with its source, then "My interpretation is…" for what they mean. Data from a tool is named in words ("Alpaca market data"), never linked.'),
  sources: z
    .array(z.object({ title: z.string().min(1), url: z.string().min(8) }))
    .max(6)
    .describe("Pages a web_search returned in this run: outlet and headline, and the link. Any other link is dropped."),
});

/** The digest's sections, in order, with their headings. */
export const DIGEST_SECTIONS = [
  ["market_overview", "Market overview"],
  ["sector_developments", "Sector developments"],
  ["major_developments", "Major developments"],
  ["portfolio_implications", "Implications for your portfolio"],
  ["deserves_attention", "What deserves attention"],
  ["upcoming_events", "Upcoming events"],
] as const;
type Sections = Record<(typeof DIGEST_SECTIONS)[number][0], z.infer<typeof section>>;

/** The digest as it is saved and read: each section under its heading, its sources linked. */
export function digestMarkdown(sections: Sections): string {
  return DIGEST_SECTIONS.map(([key, heading]) => {
    const s = sections[key];
    const links = s.sources.map((x) => `[${x.title.replace(/[[\]]/g, "")}](${x.url.trim()})`).join(" · ");
    return [`### ${heading}`, s.text.trim(), links ? `Sources: ${links}` : ""].filter(Boolean).join("\n\n");
  }).join("\n\n");
}

export const writeMarketDigest = defineTool({
  description: `Save today's market digest and end the run. Call it once, last. Each section is a short paragraph with the pages it rests on; about ${DIGEST_CHARS.toLocaleString("en-US")} characters in all, sources not counted. Past ${DIGEST_MAX_CHARS.toLocaleString("en-US")} it is refused.`,
  schema: z.object({
    sections: z.object(Object.fromEntries(DIGEST_SECTIONS.map(([k]) => [k, section])) as Record<keyof Sections, typeof section>),
  }),
  ui: "tool-ui" as const,
  progressLabel: () => "Writing the market digest",

  execute: async (args, ctx) => {
    const given = args.sections as Sections;
    const length = DIGEST_SECTIONS.reduce((n, [key]) => n + given[key].text.trim().length, 0);
    if (length > DIGEST_MAX_CHARS) {
      const summary = `Nothing saved: the six paragraphs are ${length.toLocaleString("en-US")} characters, ${DIGEST_MAX_CHARS.toLocaleString("en-US")} at most (cut ${(length - DIGEST_MAX_CHARS).toLocaleString("en-US")}). Aim for about ${DIGEST_CHARS.toLocaleString("en-US")}, and send it again.`;
      return { summary, data: { items: [{ kind: "generic" as const, text: summary }] }, sources: [] };
    }
    // A source is a page this run's searches returned; anything else is dropped and named.
    const found = pagesFound(ctx.runId);
    const dropped: string[] = [];
    const sections = Object.fromEntries(
      DIGEST_SECTIONS.map(([key]) => [key, { ...given[key], sources: given[key].sources.filter((s) => found.has(pageKey(s.url)) || (dropped.push(s.url.trim()), false)) }]),
    ) as Sections;
    const digest = digestMarkdown(sections);
    const items = DIGEST_SECTIONS.map(([key, heading]) => ({ kind: "generic" as const, text: `${heading}: ${sections[key].text.trim()}` }));
    const unique = [...new Set(dropped)];
    const droppedLine = unique.length ? ` Dropped ${unique.length} link${unique.length === 1 ? "" : "s"} no search in this run returned: ${unique.join(", ")}.` : "";
    if (ctx.dryRun) return { summary: `Saved the market digest.${droppedLine}`, data: { dry_run: true, digest, dropped: unique, items }, sources: [] };
    const run = await prisma.researchRun.findUnique({ where: { id: ctx.runId }, select: { mode: true, accountId: true, environment: true, startedAt: true, parameters: true } });
    if (!run || run.mode !== "MARKET_REVIEWER") {
      return { summary: "Only the Market Reviewer writes the market digest; nothing saved.", data: { items: [{ kind: "generic" as const, text: "Nothing saved: this run doesn't write the market digest." }] }, sources: [] };
    }
    // The run's day, as the job named it; else the day it started, in New York.
    const p = (run.parameters ?? {}) as { date?: string; model?: string };
    const day = typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : etDateOf(run.startedAt ?? new Date());
    const date = new Date(`${day}T00:00:00.000Z`);
    const model = p.model ?? null;
    const row = await prisma.marketDigest.upsert({
      where: { accountId_environment_date: { accountId: run.accountId, environment: run.environment, date } },
      create: { accountId: run.accountId, environment: run.environment, date, digest, model, runId: ctx.runId },
      update: { digest, model, runId: ctx.runId, createdAt: new Date() },
      select: { id: true },
    });
    return { summary: `Saved the market digest for ${day}.${droppedLine}`, data: { digestId: row.id, dropped: unique, items }, sources: [] };
  },
});
