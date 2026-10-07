/**
 * measure-book.ts — what the agents read about the real book, measured
 * (docs/plans/AGENT_ARCHITECTURE.md, 10.8). Read-only: it reads the
 * database and the live prices and writes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/measure-book.ts <userId> [--json <file>]
 *
 * For every enabled analyst of the user, through the real get_theses and its
 * real model-output hook:
 *  - the morning opening read (no arguments, as the Daily Run calls it): its
 *    size as the model reads it, and how many stocks come back full and quiet;
 *  - every live stock read full (detail "book"): the size of each stock's row
 *    as the model reads it, and what puts it on the list;
 *  - every field of those rows: its size summed over the whole book, and on
 *    how many rows it appears (the field table's sizes);
 *  - what a trigger run on each stock would read: the system prompt and the
 *    kickoff with the stock's brief, for the stock's own buy (watched) or
 *    floor (held) trigger.
 */
import { writeFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { stockBrief, type StockRow } from "@/lib/agent/stock-brief";
import { buildTacticalSystemPrompt, tacticalSituation } from "@/lib/agent/system-prompts/intraday-tactical";
import { tacticalKickoff } from "@/lib/agent/system-prompts/tactical-kickoff";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

/** The trigger a measured trigger run fires: the stock's own buy when watched, its floor when held, else its first. */
export function measuredTrigger(row: { status: string; triggers?: unknown[] }): Trigger | null {
  const own = (row.triggers ?? []) as Trigger[];
  return own.find((t) => t.action === (row.status === "HOLDING" ? "EXIT" : "ENTER")) ?? own[0] ?? null;
}

type Tool = {
  execute: (input: unknown, o: { toolCallId: string; messages: unknown[] }) => Promise<{ ok: boolean; data?: Record<string, unknown> }>;
  toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data?: Record<string, unknown> } };
};

/** What puts a full stock on the list, as the model reads it. */
function onTheList(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const na = row.needsAction as { kind?: string; action?: string } | undefined;
  if (na?.kind) out.push(na.action ? `${na.kind}:${na.action}` : na.kind);
  if (row.floorRisk) out.push("FLOOR_TOO_FAR");
  if (row.heldThroughFloor) out.push("HELD_THROUGH_FLOOR");
  for (const f of (row.planSanity as Array<{ kind: string }> | undefined) ?? []) out.push(f.kind);
  if (row.buyBlockedByFull) out.push("BUY_BLOCKED_BY_FULL");
  if (row.nameTheSetup) out.push("NAME_THE_SETUP");
  if (row.researchAge) out.push("RESEARCH_STALE");
  if (row.actionability) out.push(String(row.actionability));
  return out;
}

async function main() {
  const [userId, flag, file] = process.argv.slice(2);
  if (!userId) throw new Error("usage: measure-book.ts <userId> [--json <file>]");
  const analysts = await prisma.agentConfig.findMany({
    where: { userId, enabled: true },
    orderBy: { name: "asc" },
  });
  const report: Array<Record<string, unknown>> = [];
  const fields = new Map<string, { chars: number; rows: number }>();
  for (const a of analysts) {
    const env = ((a as { tradingEnvironment?: string }).tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
    const tools = createResearchTools({
      runId: "measure-book",
      userId: a.userId,
      accountId: a.accountId,
      analystId: a.id,
      runMode: "MORNING_PLAN",
      runEnvironment: env,
      alpacaCreds: (await resolveAlpacaCredentials(a.userId, env)) ?? undefined,
      maxOpenPositions: a.maxOpenPositions,
      minConfidence: a.minConfidence,
    } as never) as unknown as Record<string, Tool>;
    const getTheses = tools.get_theses;
    const read = async (input: Record<string, unknown>) => {
      const output = await getTheses.execute(input, { toolCallId: "measure", messages: [] });
      const model = getTheses.toModelOutput({ toolCallId: "measure", input, output }).value;
      return { output, model };
    };

    const morning = await read({});
    const book = await read({ detail: "book", limit: 50 });
    const full = (morning.model.data?.theses as unknown[] | undefined) ?? [];
    const quiet = (morning.model.data?.quiet_theses as unknown[] | undefined) ?? [];
    const bookRows = (book.model.data?.theses as Array<Record<string, unknown>> | undefined) ?? [];
    for (const r of bookRows) {
      for (const [k, v] of Object.entries(r)) {
        const f = fields.get(k) ?? { chars: 0, rows: 0 };
        f.chars += JSON.stringify({ [k]: v }).length - 2;
        f.rows += 1;
        fields.set(k, f);
      }
    }
    const system = buildTacticalSystemPrompt({ analyst: { name: a.name, mandate: a.analystPrompt } }).length;
    const rawRows = (book.output.data?.theses as StockRow[] | undefined) ?? [];
    const rows = bookRows.map((r, i) => {
      const raw = rawRows[i];
      const trigger = raw ? measuredTrigger(raw) : null;
      const kickoff = raw && trigger
        ? tacticalKickoff({
            ticker: raw.ticker,
            fireSentence: sentenceOf(trigger),
            situation: tacticalSituation({
              thesis: { ticker: raw.ticker, direction: raw.direction, researchAge: (raw.researchAge ?? { freshness: "fresh", daysOld: 0 }) as never },
              trigger,
              position: raw.position ? { peakPrice: raw.position.peakPrice } : null,
              fired: { price: null, coFired: [] },
            }),
            stock: stockBrief({ ...raw, nameTheSetup: null }, { named: true, inherited: true }),
          }).length
        : null;
      return {
        ticker: r.ticker,
        status: r.status,
        chars: JSON.stringify(r).length,
        onTheList: onTheList(r),
        triggerRun: kickoff != null ? { trigger: trigger!.id, system, kickoff, total: system + kickoff } : null,
      };
    });
    const entry = {
      analyst: a.name,
      morningReadChars: JSON.stringify(morning.model).length,
      morningScreenChars: JSON.stringify(morning.output).length,
      fullRows: full.length,
      quietRows: quiet.length,
      fullRowChars: JSON.stringify(full).length,
      quietRowChars: JSON.stringify(quiet).length,
      liveStocks: rows.length,
      briefChars: rows.reduce((s, r) => s + r.chars, 0),
      rows,
    };
    report.push(entry);
    console.log(
      `\n${a.name}: morning read ${entry.morningReadChars.toLocaleString("en-US")} characters as the model reads it ` +
        `(${entry.fullRows} full, ${entry.fullRowChars.toLocaleString("en-US")}; ${entry.quietRows} quiet, ${entry.quietRowChars.toLocaleString("en-US")}); ` +
        `${entry.liveStocks} live stocks, every brief together ${entry.briefChars.toLocaleString("en-US")}`,
    );
    for (const r of rows) console.log(`  ${String(r.ticker).padEnd(6)} ${String(r.status).padEnd(9)} ${String(r.chars).padStart(6)}  trigger run ${r.triggerRun ? String(r.triggerRun.total).padStart(6) : "     —"}  ${r.onTheList.join(", ") || "—"}`);
  }
  const total = [...fields.values()].reduce((s, f) => s + f.chars, 0);
  console.log(`\nEvery field over the whole book (${total.toLocaleString("en-US")} characters):`);
  for (const [k, f] of [...fields.entries()].sort((a, b) => b[1].chars - a[1].chars)) {
    console.log(`  ${k.padEnd(20)} ${String(f.chars).padStart(8)}  ${((f.chars / total) * 100).toFixed(1).padStart(5)}%  on ${f.rows} rows`);
  }
  if (flag === "--json" && file) writeFileSync(file, JSON.stringify({ analysts: report, fields: Object.fromEntries(fields) }, null, 1));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
