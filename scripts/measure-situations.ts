/**
 * measure-situations.ts — the live book's listing, replayable: for each
 * stock, the fields computeNeedsAction and listsTheStock read, beside main's
 * listing and lead (lib/agent/situations.ts).
 *
 *   npx tsx --env-file=.env.local scripts/measure-situations.ts --main <dump> [--out <file>]
 *
 * `--main` is what get_theses sent the model on main (a dump of each enabled
 * analyst's default read and book read, taken just before, after the same
 * close). Read-only. Writes the listed stocks and five quiet ones, one line
 * each, with only what the functions read: the thesis scalars, the triggers'
 * own fields, the activity back to the newest answer a run wrote, the audit
 * rows back to the last plan change (field names only), the decline, the
 * quote and the equity. No research text, no notes, no one's words.
 */
import { readFileSync, writeFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import { getTheses } from "@/lib/agent/tools/get-theses";
import { createToolContext } from "@/lib/agent/tool-context";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import type { NeedsActionInput } from "@/lib/agent/needs-action";
import { isAgentAnswer } from "@/lib/agent/stock-context";
import { changedTheRow } from "@/lib/agent/fire-streak";
import { situationsFor, situationsTap, type SituationSources } from "@/lib/agent/situations";

const TRIGGER_FIELDS = ["id", "action", "predicate", "cooldownDays", "lastFiredAt", "rearmedAt", "firedFilings", "firedReports", "level"];
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ?? null);
const leadOf = (f: { kind: string; triggerId?: string; action?: string } | null | undefined) =>
  f ? [f.kind, f.action ?? null, f.triggerId ?? null] : null;

type Row = { type: string; timestamp: Date; triggerId?: string | null; runId?: string | null; fieldChanges?: unknown };
/** The rows back to and including the first that matches `stop`, newest first; all of them when none does. */
function upTo(rows: Row[] | undefined, stop: (r: Row) => boolean): Row[] {
  const desc = [...(rows ?? [])].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const i = desc.findIndex(stop);
  return i < 0 ? desc : desc.slice(0, i + 1);
}

/**
 * The work-flag input, cut to what computeNeedsAction reads. Trigger ids are
 * renamed t1, t2 … within the stock (everywhere they appear), and the default
 * level THESIS is left out: the same relations, a third of the bytes.
 */
function cut(n: NeedsActionInput, idOf: (id: string | null | undefined) => string | null) {
  const t = n.thesis;
  return {
    thesis: {
      ...pick(t as unknown as Record<string, unknown>, ["direction", "status", "horizon", "avgCost", "peakPrice", "atr14", "quantity", "structure"]),
      createdAt: iso(t.createdAt),
      lastReviewedAt: iso(t.lastReviewedAt),
      researchUpdatedAt: t.researchUpdatedAt === undefined ? undefined : iso(t.researchUpdatedAt),
      triggers: t.triggers.map((x) => {
        const kept = pick(x as unknown as Record<string, unknown>, TRIGGER_FIELDS);
        if (kept.level === "THESIS") delete kept.level;
        return { ...kept, id: idOf(x.id) };
      }),
    },
    activity: upTo(n.activity as Row[], (r) => isAgentAnswer(r)).map((r) => ({ type: r.type, triggerId: idOf(r.triggerId), timestamp: iso(r.timestamp), runId: r.runId ?? null })),
    recentUpdates: n.recentUpdates
      ? upTo(n.recentUpdates as Row[], (r) => changedTheRow(r)).map((r) => ({
          type: r.type,
          triggerId: idOf(r.triggerId),
          timestamp: iso(r.timestamp),
          fieldChanges: r.fieldChanges && typeof r.fieldChanges === "object" ? Object.fromEntries(Object.keys(r.fieldChanges).map((k) => [k, 1])) : null,
        }))
      : undefined,
    price: n.latestQuote?.price ?? null,
    now: iso(n.now),
    pending: n.hasPendingEntryProposal ?? false,
    declinedSale: n.declinedSale ? { ...n.declinedSale, rejectMessage: n.declinedSale.rejectMessage ? "(not kept)" : null } : null,
    equity: n.equity ?? null,
  };
}

async function main() {
  const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const mainDump = arg("--main");
  if (!mainDump) throw new Error("usage: measure-situations.ts --main <dump> [--out <file>]");
  const out = arg("--out") ?? "lib/agent/__fixtures__/situations-live-book.jsonl";
  const reads = JSON.parse(readFileSync(mainDump, "utf8")) as Record<string, { data?: { theses?: Array<Record<string, unknown>> } }>;

  const analysts = await prisma.agentConfig.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
  const listed: string[] = [];
  const quiet: string[] = [];
  let differ = 0;
  for (const config of analysts) {
    const mainListed = new Set((reads[`${config.name} — default`]?.data?.theses ?? []).map((r) => String(r.id)));
    const mainLead = new Map((reads[`${config.name} — book`]?.data?.theses ?? []).map((r) => [String(r.id), r.needsAction as never]));
    if (mainLead.size === 0) throw new Error(`${config.name}: not in the main dump`);
    const env = (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
    const tool = getTheses(
      createToolContext({
        runId: "measure-situations",
        userId: config.userId,
        accountId: config.accountId,
        analystId: config.id,
        runMode: "MORNING_PLAN",
        alpacaCreds: (await resolveAlpacaCredentials(config.userId, env)) ?? undefined,
        runEnvironment: env,
        maxOpenPositions: config.maxOpenPositions,
        minConfidence: config.minConfidence,
        dryRun: true,
      } as Parameters<typeof createToolContext>[0]),
    ) as unknown as { execute: (a: unknown) => Promise<{ ok: boolean; data?: { theses?: Array<{ id: string }> } }> };

    const taps: Array<{ thesisId: string; ticker: string; needsInput: NeedsActionInput | null; sources: SituationSources }> = [];
    situationsTap.record = (s) => taps.push(s);
    const read = await tool.execute({ limit: 50 });
    situationsTap.record = null;
    const branchListed = new Set((read.data?.theses ?? []).map((r) => r.id));
    for (const tap of taps) {
      if (!tap.needsInput) continue;
      const isListed = mainListed.has(tap.thesisId);
      const lead = leadOf(mainLead.get(tap.thesisId));
      const { needs, triggers, ...rest } = tap.sources;
      void triggers;
      const codes = situationsFor(tap.sources);
      if (isListed !== branchListed.has(tap.thesisId) || JSON.stringify(lead) !== JSON.stringify(leadOf(needs[0]))) {
        differ++;
        console.warn(`[measure] ${tap.ticker}: main listed ${isListed} lead ${JSON.stringify(lead)}; here listed ${branchListed.has(tap.thesisId)} lead ${JSON.stringify(leadOf(needs[0]))}`);
      }
      const ids = new Map<string, string>();
      const idOf = (id: string | null | undefined) => {
        if (id == null) return null;
        if (!ids.has(id)) ids.set(id, `t${ids.size + 1}`);
        return ids.get(id)!;
      };
      const kept = cut(tap.needsInput, idOf);
      const line = JSON.stringify({
        ticker: tap.ticker,
        listed: isListed,
        lead: lead ? [lead[0], lead[1], idOf(lead[2] as string | null)] : null,
        codes,
        in: kept,
        src: { ...rest, planSanity: (rest.planSanity ?? []).map((f) => ({ kind: f.kind })) },
      });
      (isListed ? listed : quiet).push(line);
    }
  }
  // The listed stocks, and five quiet ones, those carrying a situation first.
  const quietFirst = [...quiet].sort((a, b) => Number(JSON.parse(b).codes.length > 0) - Number(JSON.parse(a).codes.length > 0));
  const lines = [...listed, ...quietFirst.slice(0, 5)];
  writeFileSync(out, lines.join("\n") + "\n");
  const bytes = Buffer.byteLength(lines.join("\n") + "\n");
  console.log(`${analysts.length} analysts: ${listed.length} listed, ${quiet.length} quiet; kept ${lines.length} stocks, ${bytes} bytes; ${differ} differ from main`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
